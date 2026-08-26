import 'server-only';
/**
 * นำเข้าเลขพัสดุ — ชั้นที่คุยกับฐานข้อมูล (รอบ 8)
 * ===========================================================================
 * ⚠️ ตรรกะที่ "ผิดแล้วแก้ไม่ได้" ไม่ได้อยู่ในไฟล์นี้ แต่อยู่ใน migration 0011
 *    (apply_tracking_row / apply_tracking_import / unique index ต่าง ๆ)
 *    ไฟล์นี้มีหน้าที่ : แกะไฟล์ → หาผู้สมัคร → บันทึกผลการจับคู่ → สั่งลง
 *
 * 🔴 ห้ามยิง Meta จากไฟล์นี้เด็ดขาด — การแจ้งลูกค้าอยู่ที่ notify.ts
 *    และตัวนั้นก็ส่งผ่าน sendMessage() เท่านั้น
 */
import { createHash } from 'node:crypto';
import { db } from '@/lib/supabase/admin';
import type { PublicAdmin } from '@/types/db';
import { canSeePage } from '@/lib/auth/permissions';
import { parseCsv, CsvError, MAX_CSV_BYTES } from './csv';
import { guessCourier, guessMapping, mappingProblem, type ColumnMapping, type Courier } from './columns';
import { validateRows, type ParsedRow } from './validate';
import { matchRow, summarise, type CandidateOrder, type MatchOutcome, type MatchSummary } from './match';

export class TrackingError extends Error {
  constructor(public message_th: string) {
    super(message_th);
    this.name = 'TrackingError';
  }
}

/** ไฟล์เดิมที่เคยนำเข้าไปแล้ว — ไม่ใช่ความผิดพลาด แต่ต้องบอกให้ชัด */
export class DuplicateFileError extends Error {
  constructor(public import_id: string, public message_th: string) {
    super(message_th);
    this.name = 'DuplicateFileError';
  }
}

export type ImportRowView = {
  id: string;
  row_index: number;
  tracking_no: string | null;
  order_ref_raw: string | null;
  phone_raw: string | null;
  phone_normalized: string | null;
  postcode: string | null;
  recipient_name: string | null;
  carrier_raw: string | null;
  match_status: string;
  match_method: string | null;
  matched_order_id: string | null;
  candidate_order_ids: string[];
  problems: Array<{ level: string; code: string; message_th: string }>;
  apply_status: string;
  prev_tracking_no: string | null;
  note_th: string | null;
  error_th: string | null;
  duplicate_of_row_id: string | null;
};

export type ImportView = {
  id: string;
  filename: string;
  courier: Courier | null;
  courier_label: string | null;
  status: string;
  total_rows: number;
  headers: string[];
  column_mapping: ColumnMapping;
  notify_mode: string;
  matched_auto: number;
  matched_manual: number;
  unmatched: number;
  applied_count: number;
  noop_count: number;
  skipped_count: number;
  failed_count: number;
  queued_count: number;
  notified_count: number;
  blocked_count: number;
  uploaded_by: string | null;
  created_at: string;
  applied_at: string | null;
  error_th: string | null;
};

/* ------------------------------------------------------------------------ */
/* 1) รับไฟล์ → แกะ → จับคู่ → เก็บลงฐานข้อมูล                                 */
/* ------------------------------------------------------------------------ */

/** ออเดอร์ที่ยังมีสิทธิ์รับเลขพัสดุ — ตัดที่จบไปนานแล้วออกเพื่อไม่ให้กองใหญ่เกิน */
const CANDIDATE_COLUMNS =
  'id,order_no,phone_normalized,postcode,recipient_name,status,tracking_no,created_at,page_id';

type RawCandidate = CandidateOrder & { page_id: string | null; recipient_name: string | null };

/**
 * ดึง "ออเดอร์ที่อาจเกี่ยวข้อง" มาทีเดียวทั้งไฟล์
 *
 * ⭐ ทำเป็นชุดโดยตั้งใจ ไม่ยิงทีละแถว
 *    ไฟล์ 300 แถว = 3 คำสั่ง ไม่ใช่ 900 คำสั่ง
 *    และทำให้ตัวจับคู่เป็นฟังก์ชันบริสุทธิ์ ทดสอบได้เต็มที่
 *
 * 🔴 ห้ามกรองสิทธิ์รายเพจ "ก่อน" จับคู่เด็ดขาด
 *    เคยเขียนแบบนั้นแล้วเกิดบั๊กที่อันตรายที่สุดของทั้งรอบ :
 *    ลูกค้าเบอร์เดียวมีออเดอร์สองใบคนละเพจ แอดมินที่เห็นเพจเดียว
 *    จะเหลือผู้สมัครใบเดียว → ตัวจับคู่บอก "แน่ใจ" ทั้งที่จริงกำกวม
 *    → เลขพัสดุของอีกเพจไปลงผิดใบ แล้วส่งข้อความหาลูกค้าผิดคน
 *
 *    ความกำกวมต้องถูกตัดสินจาก "ความจริงทั้งหมด"
 *    ส่วนสิทธิ์เป็นด่านที่มาทีหลัง (ดูใน createImport)
 */
async function loadCandidates(rows: ParsedRow[]): Promise<RawCandidate[]> {
  const orderRefs = [...new Set(rows.map((r) => r.order_ref).filter((v): v is string => Boolean(v)))];
  const phones = [...new Set(rows.map((r) => r.phone_normalized).filter((v): v is string => Boolean(v)))];
  const postcodes = [...new Set(rows.map((r) => r.postcode).filter((v): v is string => Boolean(v)))];

  const found = new Map<string, RawCandidate>();

  const absorb = (data: unknown) => {
    for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
      const id = String(raw.id);
      if (found.has(id)) continue;
      const pageId = raw.page_id === null || raw.page_id === undefined ? null : String(raw.page_id);
      found.set(id, {
        id,
        order_no: String(raw.order_no ?? ''),
        phone_normalized: (raw.phone_normalized as string) ?? null,
        postcode: (raw.postcode as string) ?? null,
        recipient_name: (raw.recipient_name as string) ?? null,
        name_normalized: null, // เติมทีหลัง (ต้องใช้ normalizeName ตัวเดียวกับฝั่งไฟล์)
        status: String(raw.status ?? ''),
        tracking_no: (raw.tracking_no as string) ?? null,
        created_at: String(raw.created_at ?? ''),
        page_id: pageId,
      });
    }
  };

  // แบ่งเป็นก้อนละ 200 กัน URL ยาวเกินที่ PostgREST รับได้
  const CHUNK = 200;
  const chunk = <T,>(list: T[]): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
    return out;
  };

  /**
   * ⚠️ ต้องใส่เพดานเองเสมอ และต้องรู้ตัวเมื่อชนเพดาน
   *    ถ้าปล่อยให้ PostgREST ตัดผลเงียบ ๆ ผู้สมัครบางใบจะหายไปจากกอง
   *    แล้วตัวจับคู่จะเข้าใจว่า "เจอใบเดียว" ทั้งที่จริงมีหลายใบ — อันตรายแบบเดียวกับการกรองสิทธิ์ก่อน
   */
  const HARD_LIMIT = 2000;
  let truncated = false;

  for (const part of chunk(orderRefs)) {
    const { data } = await db()
      .from('orders').select(CANDIDATE_COLUMNS)
      .in('order_no', part)
      .order('created_at', { ascending: false })
      .limit(HARD_LIMIT);
    if ((data ?? []).length >= HARD_LIMIT) truncated = true;
    absorb(data);
  }
  for (const part of chunk(phones)) {
    const { data } = await db()
      .from('orders').select(CANDIDATE_COLUMNS)
      .in('phone_normalized', part)
      .order('created_at', { ascending: false })
      .limit(HARD_LIMIT);
    if ((data ?? []).length >= HARD_LIMIT) truncated = true;
    absorb(data);
  }
  // รหัสไปรษณีย์ใช้เฉพาะตอน "เสนอจากชื่อ" ซึ่งเป็นวิธีที่อ่อนที่สุด
  // จึงดึงมาแค่พอเสนอได้ ไม่ต้องดึงทั้งจังหวัด
  // ⚠️ ต้องมี order by เสมอ ไม่งั้นชุดที่เสนอจะไม่เหมือนเดิมในแต่ละรอบ
  for (const part of chunk(postcodes)) {
    const { data } = await db()
      .from('orders')
      .select(CANDIDATE_COLUMNS)
      .in('postcode', part)
      .is('tracking_no', null)
      .order('created_at', { ascending: false })
      .limit(500);
    absorb(data);
  }

  if (truncated) {
    throw new TrackingError(
      'ไฟล์นี้ตรงกับออเดอร์จำนวนมากเกินกว่าที่ระบบจะตรวจความกำกวมได้อย่างมั่นใจ — ' +
        'แบ่งไฟล์ให้เล็กลงแล้วนำเข้าทีละส่วน',
    );
  }

  return [...found.values()];
}

/** บันทึกแถวของไฟล์ลงฐานข้อมูล — ใช้ร่วมกันทั้งตอนอัปโหลดและตอนแก้การจับคู่คอลัมน์ */
async function insertRows(
  importId: string,
  matched: Array<{ row: ParsedRow; outcome: MatchOutcome }>,
  courier: Courier,
): Promise<void> {
  const payload = matched.map(({ row, outcome }) => ({
    import_id: importId,
    row_index: row.row_index,
    row_hash: row.row_hash,
    raw_row: row.raw,
    tracking_no: row.tracking_no,
    order_ref_raw: row.order_ref,
    phone_raw: row.phone_raw,
    phone_normalized: row.phone_normalized,
    postcode: row.postcode,
    recipient_name: row.recipient_name,
    carrier_raw: row.carrier_raw ?? courier,
    problems: row.problems,
    matched_order_id: outcome.order_id,
    match_method: outcome.method,
    match_status: outcome.status,
    candidate_order_ids: outcome.candidate_order_ids,
    note_th: outcome.note_th,
  }));

  // แบ่งใส่ทีละก้อน กัน payload ใหญ่เกิน
  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await db().from('tracking_import_rows').insert(payload.slice(i, i + 200));
    if (error) throw new TrackingError(`บันทึกแถวของไฟล์ไม่สำเร็จ: ${error.message}`);
  }
}

/**
 * จับคู่ทุกแถวของไฟล์กับออเดอร์ แล้วบังคับกฎสิทธิ์ "หลัง" จับคู่เสร็จ
 *
 * ⭐ ลำดับสำคัญมาก :
 *    1. จับคู่จากออเดอร์ "ทั้งหมด" เพื่อให้ตัดสินความกำกวมได้ถูก
 *    2. ค่อยเช็คว่าใบที่เลือกได้อยู่ในเพจที่แอดมินคนนี้มีสิทธิ์ไหม
 *    ถ้าสลับลำดับ ความกำกวมจะกลายเป็น "แน่ใจ" แบบผิด ๆ (ดูคอมเมนต์ใน loadCandidates)
 */
async function matchAllRows(
  admin: PublicAdmin,
  parsed: ParsedRow[],
): Promise<Array<{ row: ParsedRow; outcome: MatchOutcome }>> {
  const rawCandidates = await loadCandidates(parsed);

  // เติมชื่อที่ normalize แล้วด้วยฟังก์ชันตัวเดียวกับฝั่งไฟล์ (สำคัญ — ต้องคิดเหมือนกัน)
  const { normalizeName } = await import('./normalize');
  const candidates: CandidateOrder[] = rawCandidates.map((c) => ({
    ...c,
    name_normalized: normalizeName(c.recipient_name),
  }));
  const pageOf = new Map(rawCandidates.map((c) => [c.id, c.page_id]));

  const skip = (row: ParsedRow, note: string): { row: ParsedRow; outcome: MatchOutcome } => ({
    row,
    outcome: { status: 'skipped', method: null, order_id: null, candidate_order_ids: [], note_th: note },
  });

  /** ออเดอร์ที่ชี้ไปหาแล้วซ้ำกันในไฟล์เดียวกัน — เก็บไว้เตือนตอน preview */
  const orderSeenAt = new Map<string, number>();

  const out = parsed.map((row) => {
    if (row.duplicate_of !== null) {
      return skip(row, `ซ้ำกับแถวที่ ${row.duplicate_of} ในไฟล์เดียวกัน`);
    }
    if (row.problems.some((p) => p.level === 'error')) {
      return skip(row, row.problems.find((p) => p.level === 'error')?.message_th ?? 'แถวนี้มีปัญหา');
    }

    const outcome = matchRow(row, candidates);

    /**
     * 🔴 ด่านสิทธิ์ — มาทีหลังการจับคู่เสมอ
     *    ถ้าใบที่จับคู่ได้อยู่นอกเพจที่มีสิทธิ์ ต้องข้าม ไม่ใช่ไปหยิบใบอื่นมาแทน
     */
    if (outcome.order_id) {
      const pageId = pageOf.get(outcome.order_id) ?? null;
      if (pageId !== null && !canSeePage(admin.role, admin.allowed_page_ids, pageId)) {
        return skip(row, 'แถวนี้ตรงกับออเดอร์ของเพจที่คุณไม่มีสิทธิ์เข้าถึง');
      }
    }
    // ผู้สมัครที่เสนอให้เลือก ก็ต้องกรองเพจที่ไม่มีสิทธิ์ออกเช่นกัน
    const allowedCandidates = outcome.candidate_order_ids.filter((id) => {
      const pageId = pageOf.get(id) ?? null;
      return pageId === null || canSeePage(admin.role, admin.allowed_page_ids, pageId);
    });

    return { row, outcome: { ...outcome, candidate_order_ids: allowedCandidates } };
  });

  /**
   * ⚠️ สองแถวชี้ไปที่ออเดอร์ใบเดียวกัน = ของหลายกล่องต่อหนึ่งออเดอร์
   *    ระบบรองรับได้ (ใบหลังทับใบแรกพร้อมจดร่องรอย) แต่ต้องเตือนให้เห็นก่อน
   *    เพราะลูกค้าจะได้แจ้งเลขเดียว ซึ่งอาจไม่ใช่ที่เจ้าของร้านตั้งใจ
   */
  for (const m of out) {
    const id = m.outcome.order_id;
    if (!id || m.outcome.status === 'skipped') continue;
    const first = orderSeenAt.get(id);
    if (first === undefined) {
      orderSeenAt.set(id, m.row.row_index);
      continue;
    }
    m.row.problems.push({
      level: 'warning',
      code: 'same_order_twice',
      message_th:
        `ชี้ไปที่ออเดอร์ใบเดียวกับแถวที่ ${first} — ` +
        'ถ้าลงทั้งคู่ เลขพัสดุใบหลังจะทับใบแรก และลูกค้าจะได้แจ้งเลขเดียว',
    });
  }

  return out;
}

export type CreateImportInput = {
  filename: string;
  content: string;
  /** ถ้าแอดมินเลือกคอลัมน์เอง ให้ส่งมาทับค่าที่ระบบเดา */
  mapping?: ColumnMapping;
  courier?: Courier;
};

export type CreateImportResult = {
  import_id: string;
  summary: MatchSummary;
  view: ImportView;
};

export async function createImport(
  admin: PublicAdmin,
  input: CreateImportInput,
): Promise<CreateImportResult> {
  if (Buffer.byteLength(input.content, 'utf8') > MAX_CSV_BYTES) {
    throw new TrackingError(`ไฟล์ใหญ่เกิน ${Math.floor(MAX_CSV_BYTES / 1024 / 1024)} MB`);
  }

  /**
   * ⭐ ลายนิ้วมือของไฟล์ — คิดจาก "เนื้อไฟล์" ไม่ใช่ชื่อไฟล์
   *    เปลี่ยนชื่อไฟล์แล้วอัปโหลดใหม่ จึงยังจับได้ว่าเป็นไฟล์เดิม
   */
  const fileHash = createHash('sha256').update(input.content, 'utf8').digest('hex');

  // ไฟล์เดิมที่ยังไม่ถูกยกเลิก = เคยนำเข้าไปแล้ว ห้ามสร้างรอบใหม่ซ้ำ
  const { data: existing } = await db()
    .from('tracking_imports')
    .select('id,status')
    .eq('file_hash', fileHash)
    .neq('status', 'cancelled')
    .maybeSingle();

  if (existing) {
    const row = existing as { id: string; status: string };
    throw new DuplicateFileError(
      row.id,
      row.status === 'applied'
        ? 'ไฟล์นี้เคยนำเข้าและลงเลขพัสดุไปแล้ว — เปิดดูรอบเดิมได้เลย ไม่ต้องทำซ้ำ'
        : 'ไฟล์นี้อัปโหลดไว้แล้วและยังรอตรวจอยู่ — เปิดรอบเดิมขึ้นมาทำต่อได้',
    );
  }

  let table;
  try {
    table = parseCsv(input.content);
  } catch (err) {
    if (err instanceof CsvError) throw new TrackingError(err.message_th);
    throw new TrackingError('อ่านไฟล์ไม่สำเร็จ — ตรวจว่าเป็นไฟล์ CSV จริงหรือไม่');
  }

  const mapping: ColumnMapping = { ...guessMapping(table.headers), ...(input.mapping ?? {}) };
  const problem = mappingProblem(mapping);
  if (problem) throw new TrackingError(problem);

  const courier = input.courier ?? guessCourier(table.headers, input.filename);
  const parsed = validateRows(table, mapping);
  if (parsed.length === 0) throw new TrackingError('ไฟล์มีแต่หัวตาราง ไม่มีข้อมูลสักแถว');

  const matched = await matchAllRows(admin, parsed);

  const summary = summarise(
    matched.map((m) => ({
      match_status: m.outcome.status,
      problems: m.row.problems,
      duplicate_of: m.row.duplicate_of,
    })),
  );

  /* ---- บันทึกรอบนำเข้า ---- */
  const { data: importRow, error: importErr } = await db()
    .from('tracking_imports')
    .insert({
      filename: input.filename.slice(0, 300),
      courier,
      file_hash: fileHash,
      total_rows: parsed.length,
      matched_auto: summary.auto,
      matched_manual: summary.manual,
      unmatched: summary.unmatched + summary.ambiguous,
      status: 'review',
      headers: table.headers,
      column_mapping: mapping,
      raw_csv: input.content,
      uploaded_by: admin.id,
    })
    .select('id')
    .single();

  if (importErr || !importRow) {
    // ชนกับ unique index = มีคนอัปโหลดไฟล์เดียวกันพร้อมกัน
    if (importErr?.code === '23505') {
      const { data: other } = await db()
        .from('tracking_imports')
        .select('id')
        .eq('file_hash', fileHash)
        .neq('status', 'cancelled')
        .maybeSingle();
      throw new DuplicateFileError(
        (other as { id: string } | null)?.id ?? '',
        'ไฟล์นี้เพิ่งถูกอัปโหลดไปพร้อมกัน — เปิดรอบเดิมขึ้นมาทำต่อได้',
      );
    }
    throw new TrackingError(`บันทึกรอบนำเข้าไม่สำเร็จ: ${importErr?.message ?? 'ไม่ทราบสาเหตุ'}`);
  }

  const importId = (importRow as { id: string }).id;

  /* ---- บันทึกทุกแถว ---- */
  await insertRows(importId, matched, courier);

  const view = await getImport(admin, importId);
  return { import_id: importId, summary, view };
}

/* ------------------------------------------------------------------------ */
/* 2) อ่านรอบนำเข้า                                                           */
/* ------------------------------------------------------------------------ */

const IMPORT_COLUMNS =
  'id,filename,courier,courier_label,status,total_rows,headers,column_mapping,notify_mode,' +
  'matched_auto,matched_manual,unmatched,applied_count,noop_count,skipped_count,failed_count,' +
  'queued_count,notified_count,blocked_count,uploaded_by,created_at,applied_at,error_th';

/**
 * 🔴 ด่านสิทธิ์ของ "รอบนำเข้า"
 *
 *    รอบนำเข้าไม่ได้ผูกกับเพจใดเพจหนึ่ง (ไฟล์เดียวอาจมีของหลายเพจ)
 *    จึงใช้กฎที่ตรงไปตรงมาและอธิบายได้ :
 *      • เจ้าของร้าน เห็นและจัดการได้ทุกรอบ
 *      • แอดมินคนอื่น จัดการได้เฉพาะรอบที่ตัวเองอัปโหลด
 *
 *    เดิมไม่มีด่านนี้เลย แปลว่าแอดมินที่เห็นเพจเดียว
 *    สามารถกด "ลงเลขพัสดุ" ของไฟล์ที่คนอื่นอัปโหลดไว้ได้ทั้งไฟล์
 */
function assertImportAccess(admin: PublicAdmin, row: { uploaded_by: string | null }): void {
  if (admin.role === 'owner') return;
  if (row.uploaded_by === admin.id) return;
  throw new TrackingError('รอบนำเข้านี้เป็นของแอดมินคนอื่น — เปิดดูหรือแก้ไขไม่ได้');
}

export async function getImport(admin: PublicAdmin, id: string): Promise<ImportView> {
  const { data } = await db().from('tracking_imports').select(IMPORT_COLUMNS).eq('id', id).maybeSingle()
    .overrideTypes<ImportView | null, { merge: false }>();
  if (!data) throw new TrackingError('ไม่พบรอบนำเข้านี้');
  const view = data;
  assertImportAccess(admin, view);
  return view;
}

export async function listImports(admin: PublicAdmin, limit = 30): Promise<ImportView[]> {
  let query = db()
    .from('tracking_imports')
    .select(IMPORT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));

  // แอดมินทั่วไปเห็นเฉพาะรอบของตัวเอง
  if (admin.role !== 'owner') query = query.eq('uploaded_by', admin.id);

  const { data } = await query.overrideTypes<ImportView[], { merge: false }>();
  return data ?? [];
}

const ROW_COLUMNS =
  'id,row_index,tracking_no,order_ref_raw,phone_raw,phone_normalized,postcode,recipient_name,' +
  'carrier_raw,match_status,match_method,matched_order_id,candidate_order_ids,problems,' +
  'apply_status,prev_tracking_no,note_th,error_th,duplicate_of_row_id';

export async function listImportRows(importId: string, limit = 1000): Promise<ImportRowView[]> {
  // ⚠️ ผู้เรียกทุกรายต้องผ่าน getImport() มาก่อนเสมอ (ด่านสิทธิ์อยู่ที่นั่น)
  const { data } = await db()
    .from('tracking_import_rows')
    .select(ROW_COLUMNS)
    .eq('import_id', importId)
    .order('row_index', { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 5000))
    .overrideTypes<ImportRowView[], { merge: false }>();
  return (data ?? []).map((r) => ({
    ...r,
    candidate_order_ids: Array.isArray(r.candidate_order_ids) ? r.candidate_order_ids : [],
    problems: Array.isArray(r.problems) ? r.problems : [],
  }));
}

/* ------------------------------------------------------------------------ */
/* 2.5) แก้การจับคู่คอลัมน์แล้วแกะไฟล์ใหม่                                       */
/* ------------------------------------------------------------------------ */

/**
 * แก้ว่า "คอลัมน์ไหนคืออะไร" แล้วแกะไฟล์เดิมใหม่ทั้งรอบ
 *
 * 🔴 ทำไมต้องมี :
 *    ระบบเดาคอลัมน์ให้ ซึ่งเดาผิดได้ (ไฟล์ขนส่งบางเจ้ามีทั้งผู้ส่งและผู้รับ)
 *    ถ้าแก้ไม่ได้ เจ้าของร้านจะติดตาย เพราะลายนิ้วมือไฟล์กันไม่ให้อัปโหลดซ้ำ
 *
 * ⭐ ใช้เนื้อไฟล์ที่เก็บไว้ตอนอัปโหลด จึงไม่ต้องให้ไปหาไฟล์เดิมมาใหม่
 * ⚠️ ทำได้เฉพาะตอนยังไม่ลงเลขพัสดุ — ลงแล้วแก้ย้อนหลังไม่ได้
 */
export async function remapImport(
  admin: PublicAdmin,
  importId: string,
  mapping: ColumnMapping,
): Promise<{ summary: MatchSummary; view: ImportView }> {
  const view = await getImport(admin, importId); // ด่านสิทธิ์
  if (view.status !== 'review') {
    throw new TrackingError('รอบนี้ลงเลขพัสดุหรือถูกยกเลิกไปแล้ว แก้การจับคู่คอลัมน์ไม่ได้');
  }

  const { data } = await db()
    .from('tracking_imports')
    .select('raw_csv')
    .eq('id', importId)
    .maybeSingle();

  const content = (data as { raw_csv: string | null } | null)?.raw_csv;
  if (!content) {
    throw new TrackingError(
      'รอบนี้ไม่ได้เก็บเนื้อไฟล์ไว้ (นำเข้าก่อนระบบรองรับ) — ยกเลิกรอบนี้แล้วอัปโหลดใหม่',
    );
  }

  let table;
  try {
    table = parseCsv(content);
  } catch (err) {
    throw new TrackingError(err instanceof CsvError ? err.message_th : 'อ่านไฟล์เดิมไม่สำเร็จ');
  }

  // รับเฉพาะคอลัมน์ที่มีอยู่จริงในไฟล์ — กันค่าที่ยัดมาจากเบราว์เซอร์
  const clean: ColumnMapping = {};
  for (const [field, column] of Object.entries(mapping) as Array<[keyof ColumnMapping, string]>) {
    if (typeof column === 'string' && table.headers.includes(column)) clean[field] = column;
  }

  const problem = mappingProblem(clean);
  if (problem) throw new TrackingError(problem);

  const parsed = validateRows(table, clean);
  if (parsed.length === 0) throw new TrackingError('ไฟล์มีแต่หัวตาราง ไม่มีข้อมูลสักแถว');

  const matched = await matchAllRows(admin, parsed);
  const summary = summarise(
    matched.map((m) => ({
      match_status: m.outcome.status,
      problems: m.row.problems,
      duplicate_of: m.row.duplicate_of,
    })),
  );

  /**
   * ⚠️ ลบแถวเดิมทิ้งก่อนใส่ชุดใหม่
   *    ทำได้เพราะยังไม่มีแถวไหนถูกลงจริง (เช็ค status = 'review' ไว้แล้ว)
   *    และ unique (import_id,row_index) จะกันไม่ให้แถวบานเป็นสองเท่าถ้ามีอะไรพลาด
   */
  const { error: delErr } = await db().from('tracking_import_rows').delete().eq('import_id', importId);
  if (delErr) throw new TrackingError(`ล้างแถวเดิมไม่สำเร็จ: ${delErr.message}`);

  await insertRows(importId, matched, view.courier ?? 'custom');

  const { error: upErr } = await db()
    .from('tracking_imports')
    .update({
      column_mapping: clean,
      total_rows: parsed.length,
      matched_auto: summary.auto,
      matched_manual: summary.manual,
      unmatched: summary.unmatched + summary.ambiguous,
    })
    .eq('id', importId);
  if (upErr) throw new TrackingError(`บันทึกการจับคู่คอลัมน์ใหม่ไม่สำเร็จ: ${upErr.message}`);

  return { summary, view: await getImport(admin, importId) };
}

/* ------------------------------------------------------------------------ */
/* 3) แอดมินแก้การจับคู่เอง                                                    */
/* ------------------------------------------------------------------------ */

export type ResolveRowInput =
  | { action: 'choose'; order_id: string }
  | { action: 'skip' }
  | { action: 'reset' };

export async function resolveRow(
  admin: PublicAdmin,
  importId: string,
  rowId: string,
  input: ResolveRowInput,
): Promise<ImportRowView> {
  const { data: row } = await db()
    .from('tracking_import_rows')
    .select('id,import_id,apply_status,candidate_order_ids')
    .eq('id', rowId)
    .maybeSingle();

  if (!row || (row as { import_id: string }).import_id !== importId) {
    throw new TrackingError('ไม่พบแถวนี้ในรอบนำเข้า');
  }
  // 🔴 ลงไปแล้วห้ามแก้การจับคู่ — ไม่งั้นตัวเลขสรุปกับของจริงจะไม่ตรงกัน
  if ((row as { apply_status: string }).apply_status !== 'pending') {
    throw new TrackingError('แถวนี้ลงเลขพัสดุไปแล้ว แก้การจับคู่ย้อนหลังไม่ได้');
  }

  let patch: Record<string, unknown>;

  if (input.action === 'choose') {
    // ⚠️ ต้องตรวจสิทธิ์เพจของออเดอร์ที่แอดมินเลือกเสมอ
    //    ไม่งั้นจะยัด id ของออเดอร์เพจอื่นเข้ามาจากเบราว์เซอร์ได้
    const { data: order } = await db()
      .from('orders')
      .select('id,page_id,status')
      .eq('id', input.order_id)
      .maybeSingle();
    if (!order) throw new TrackingError('ไม่พบออเดอร์ที่เลือก');
    const o = order as { id: string; page_id: string | null; status: string };
    if (o.page_id && !canSeePage(admin.role, admin.allowed_page_ids, o.page_id)) {
      throw new TrackingError('คุณไม่มีสิทธิ์เข้าถึงเพจของออเดอร์ใบนี้');
    }
    patch = {
      matched_order_id: o.id,
      match_method: 'manual',
      match_status: 'manual',
      note_th: 'แอดมินเลือกออเดอร์ให้เอง',
    };
  } else if (input.action === 'skip') {
    patch = { match_status: 'skipped', note_th: 'แอดมินสั่งข้ามแถวนี้' };
  } else {
    patch = {
      matched_order_id: null,
      match_method: null,
      match_status: 'unmatched',
      note_th: null,
    };
  }

  const { error } = await db().from('tracking_import_rows').update(patch).eq('id', rowId);
  if (error) throw new TrackingError(`แก้การจับคู่ไม่สำเร็จ: ${error.message}`);

  const rows = await listImportRows(importId);
  const updated = rows.find((r) => r.id === rowId);
  if (!updated) throw new TrackingError('อ่านแถวหลังแก้ไม่สำเร็จ');
  return updated;
}

/* ------------------------------------------------------------------------ */
/* 4) ลงเลขพัสดุจริง                                                          */
/* ------------------------------------------------------------------------ */

export type ApplyResult = {
  applied_count: number;
  noop_count: number;
  skipped_count: number;
  failed_count: number;
  queued_count: number;
};

export type ApplyOptions = {
  /** none = ลงอย่างเดียว / prepare = ลง + เข้าคิวแจ้ง (ยังไม่ส่ง) / send = ลง + เข้าคิว + ส่งเลย */
  notify_mode: 'none' | 'prepare' | 'send';
};

export async function applyImport(
  admin: PublicAdmin,
  importId: string,
  options: ApplyOptions,
): Promise<ApplyResult> {
  // 🔴 ตรวจสิทธิ์ก่อนแตะอะไรทั้งสิ้น (โยน TrackingError ถ้าไม่ใช่ของตัวเอง)
  await getImport(admin, importId);

  /**
   * ⭐ ด่านกันกดซ้ำอยู่ที่ฐานข้อมูล ไม่ใช่ที่ตัวแปรในหน่วยความจำ
   *    กดสองครั้งรัว ๆ / เปิดสองแท็บ / สองเซิร์ฟเวอร์ = มีแค่คนเดียวที่ได้ทำ
   */
  const { data: claimData, error: claimErr } = await db().rpc('claim_tracking_import_apply', {
    p_import_id: importId,
    p_admin_id: admin.id,
  });
  if (claimErr) throw new TrackingError(`จองสิทธิ์ลงเลขพัสดุไม่สำเร็จ: ${claimErr.message}`);

  const claim = (Array.isArray(claimData) ? claimData[0] : claimData) as
    | { won: boolean; current_status: string }
    | undefined;

  if (!claim) throw new TrackingError('ฐานข้อมูลไม่ได้คืนผลการจองสิทธิ์กลับมา');

  if (!claim.won) {
    if (claim.current_status === 'applied') {
      throw new TrackingError('รอบนี้ลงเลขพัสดุไปแล้ว — กดซ้ำไม่ทำให้เปลี่ยนอะไรอีก');
    }
    if (claim.current_status === 'cancelled') {
      throw new TrackingError('รอบนี้ถูกยกเลิกไปแล้ว');
    }
    throw new TrackingError('มีคนกำลังลงเลขพัสดุของรอบนี้อยู่ — รอสักครู่แล้วรีเฟรชดูผล');
  }

  await db().from('tracking_imports').update({ notify_mode: options.notify_mode }).eq('id', importId);

  const { data, error } = await db().rpc('apply_tracking_import', {
    p_import_id: importId,
    p_admin_id: admin.id,
    p_notify: options.notify_mode !== 'none',
  });

  if (error) {
    // ปลดล็อกให้กดใหม่ได้ แล้วจดเหตุผลไว้บนรอบนำเข้า
    await db()
      .from('tracking_imports')
      .update({ apply_started_at: null, error_th: error.message.slice(0, 500) })
      .eq('id', importId);
    throw new TrackingError(`ลงเลขพัสดุไม่สำเร็จ: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as ApplyResult | undefined;
  return (
    row ?? { applied_count: 0, noop_count: 0, skipped_count: 0, failed_count: 0, queued_count: 0 }
  );
}

export async function cancelImport(admin: PublicAdmin, importId: string): Promise<void> {
  const view = await getImport(admin, importId);
  if (view.status === 'applied') {
    throw new TrackingError('รอบที่ลงเลขพัสดุไปแล้ว ยกเลิกย้อนหลังไม่ได้ — แก้ที่ออเดอร์ทีละใบแทน');
  }
  const { error } = await db()
    .from('tracking_imports')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', importId)
    .neq('status', 'applied');
  if (error) throw new TrackingError(`ยกเลิกรอบนำเข้าไม่สำเร็จ: ${error.message}`);
}
