/**
 * แกะ JSON ดิบจาก webhook ของ Meta → เหตุการณ์กลาง
 * ===========================================================================
 * ⚠️ ไฟล์นี้เป็น "ฟังก์ชันบริสุทธิ์" ล้วน ๆ
 *    ห้ามต่อฐานข้อมูล ห้ามยิงเน็ต ห้ามอ่านเวลาปัจจุบัน
 *    เพราะแบบนี้เราถึงจะเอา payload จริงมาทดสอบได้ทุกกรณีโดยไม่ต้องมี Meta
 *
 * กฎการแกะที่ยึดไว้ :
 *   1. ไม่รู้จัก = ข้าม แล้วจดเหตุผล  (ห้ามเดา ห้ามโยน error ทิ้งทั้งก้อน)
 *      เพราะ payload ก้อนหนึ่งมีได้หลายเหตุการณ์ อันหนึ่งพังต้องไม่ทำให้อันอื่นหาย
 *   2. ห้ามสมมติว่า Messenger กับ Instagram เหมือนกัน — แยกทางกันชัดเจน
 *   3. ข้อความที่ไม่มี mid = บันทึกไม่ได้ เพราะกันซ้ำไม่ได้ → ข้าม
 */
import type { Platform, ReferralSource } from '@/types/db';
import {
  EMPTY_REFERRAL,
  type EchoMessageEvent,
  type IngestAttachment,
  type IngestEvent,
  type IngestReferral,
  type InboundMessageEvent,
} from './types';

/* ------------------------------------------------------------------------ */
/* ตัวช่วยอ่านค่าจาก JSON ที่เราไม่ได้เป็นคนกำหนดรูปแบบ                          */
/* ------------------------------------------------------------------------ */

type Json = Record<string, unknown>;

function obj(v: unknown): Json | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : null;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * แปลง timestamp ของ Meta (มิลลิวินาที) เป็นเวลาแบบ ISO
 * ถ้าไม่มีหรือเพี้ยน ให้คืน null แล้วให้ชั้นบนตัดสินใจ (จะได้ไม่แอบเดาเวลาเอง)
 */
function metaTime(v: unknown): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/* ------------------------------------------------------------------------ */
/* ที่มาของแชท                                                                */
/* ------------------------------------------------------------------------ */

/**
 * แปลงค่า source ของ Meta ให้ตรงกับ 4 ค่าที่ฐานข้อมูลเรารับ
 *
 * ⚠️ Meta มีค่ามากกว่านี้ (MESSENGER_CODE / DISCOVER_TAB / CUSTOMER_CHAT_PLUGIN …)
 *    และเพิ่มค่าใหม่ได้ตลอด — ค่าที่ไม่รู้จักให้ตกเป็น ORGANIC
 *    ดีกว่าทำให้ทั้งข้อความหายเพราะ enum ไม่ตรง
 */
function mapReferralSource(raw: string | null, hasAdId: boolean, hasPostId: boolean): ReferralSource | null {
  if (hasAdId) return 'ADS';
  switch (raw) {
    case 'ADS':
      return 'ADS';
    case 'SHORTLINK':
      return 'SHORTLINK';
    case 'POST':
      return 'POST';
    case null:
      return hasPostId ? 'POST' : null;
    default:
      return 'ORGANIC';
  }
}

function parseReferral(raw: unknown): IngestReferral {
  const r = obj(raw);
  if (!r) return EMPTY_REFERRAL;
  const ad_id = str(r.ad_id);
  const post_id = str(r.post_id);
  return {
    source: mapReferralSource(str(r.source), Boolean(ad_id), Boolean(post_id)),
    ad_id,
    post_id,
    ref: str(r.ref),
  };
}

/* ------------------------------------------------------------------------ */
/* ไฟล์แนบ                                                                    */
/* ------------------------------------------------------------------------ */

function parseAttachments(raw: unknown): IngestAttachment[] {
  const out: IngestAttachment[] = [];
  for (const item of arr(raw)) {
    const a = obj(item);
    if (!a) continue;
    const payload = obj(a.payload);
    const type = str(a.type) ?? 'unknown';
    // template / fallback ไม่ใช่ไฟล์ ข้ามไป
    if (type === 'template' || type === 'fallback') continue;
    out.push({
      type,
      url: str(payload?.url) ?? undefined,
      meta_attachment_id: str(payload?.attachment_id) ?? undefined,
    });
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* ตัวแกะหลัก                                                                 */
/* ------------------------------------------------------------------------ */

/** object ของ webhook → แพลตฟอร์มของเรา */
function platformOf(objectType: string | null): Platform | null {
  if (objectType === 'page') return 'facebook';
  if (objectType === 'instagram') return 'instagram';
  return null;
}

/**
 * แกะ payload ทั้งก้อน
 * @returns รายการเหตุการณ์ตามลำดับที่เจอ (รวมรายการที่ตั้งใจข้ามด้วย)
 */
export function parseWebhookPayload(payload: unknown): IngestEvent[] {
  const root = obj(payload);
  if (!root) {
    return [{ kind: 'ignored', reason: 'payload ไม่ใช่ object', platform: null, page_meta_id: null }];
  }

  const platform = platformOf(str(root.object));
  if (!platform) {
    return [
      {
        kind: 'ignored',
        reason: `ไม่รู้จัก object "${str(root.object) ?? '(ว่าง)'}" — รับเฉพาะ page (Messenger) กับ instagram`,
        platform: null,
        page_meta_id: null,
      },
    ];
  }

  const events: IngestEvent[] = [];

  for (const entryRaw of arr(root.entry)) {
    const entry = obj(entryRaw);
    if (!entry) continue;

    const pageMetaId = str(entry.id);
    if (!pageMetaId) {
      events.push({ kind: 'ignored', reason: 'entry ไม่มี id ของเพจ', platform, page_meta_id: null });
      continue;
    }

    // เหตุการณ์ที่ไม่ใช่ข้อความ (คอมเมนต์ / ฟีด) มาใน `changes` — เป็นงานของรอบคอมเมนต์
    if (arr(entry.changes).length > 0 && arr(entry.messaging).length === 0) {
      events.push({
        kind: 'ignored',
        reason: 'เหตุการณ์แบบ changes (คอมเมนต์/ฟีด) ยังไม่รองรับในรอบนี้',
        platform,
        page_meta_id: pageMetaId,
      });
      continue;
    }

    // `standby` = แชทที่แอปอื่นถือสิทธิ์ตอบอยู่ (handover protocol) — ไม่ยุ่ง
    if (arr(entry.standby).length > 0) {
      events.push({
        kind: 'ignored',
        reason: 'เหตุการณ์แบบ standby (แอปอื่นถือสิทธิ์ตอบอยู่)',
        platform,
        page_meta_id: pageMetaId,
      });
    }

    for (const msgRaw of arr(entry.messaging)) {
      events.push(...parseMessagingEvent(msgRaw, platform, pageMetaId));
    }
  }

  if (events.length === 0) {
    events.push({ kind: 'ignored', reason: 'ไม่มีเหตุการณ์ในก้อนนี้', platform, page_meta_id: null });
  }
  return events;
}

function parseMessagingEvent(raw: unknown, platform: Platform, pageMetaId: string): IngestEvent[] {
  const ev = obj(raw);
  if (!ev) return [];

  const senderId = str(obj(ev.sender)?.id);
  const recipientId = str(obj(ev.recipient)?.id);
  const timestamp = metaTime(ev.timestamp);

  const ignore = (reason: string): IngestEvent[] => [
    { kind: 'ignored', reason, platform, page_meta_id: pageMetaId },
  ];

  if (!senderId || !recipientId) return ignore('เหตุการณ์ไม่มี sender หรือ recipient');
  if (!timestamp) return ignore('เหตุการณ์ไม่มีเวลา (timestamp) ที่ใช้ได้');

  const message = obj(ev.message);

  /* --- ไม่ใช่ข้อความ : อ่านแล้ว / ส่งถึงแล้ว / รีแอค / postback ----------- */
  if (!message) {
    if (obj(ev.read)) return ignore('เหตุการณ์ "ลูกค้าอ่านแล้ว" — ยังไม่ใช้ในรอบนี้');
    if (obj(ev.delivery)) return ignore('เหตุการณ์ "ส่งถึงแล้ว" — ยังไม่ใช้ในรอบนี้');
    if (obj(ev.reaction)) return ignore('เหตุการณ์ "กดรีแอค" — ยังไม่ใช้ในรอบนี้');
    if (obj(ev.postback)) return ignore('เหตุการณ์ postback (กดปุ่ม) — เป็นงานของรอบคีย์เวิร์ด');
    if (obj(ev.referral)) return ignore('เหตุการณ์ referral เปล่า ๆ ที่ยังไม่มีข้อความตามมา');
    if (obj(ev.optin)) return ignore('เหตุการณ์ optin — ยังไม่ใช้ในรอบนี้');
    return ignore('เหตุการณ์ที่ยังไม่รองรับ');
  }

  const mid = str(message.mid);
  if (!mid) {
    // ไม่มี mid = กันข้อความซ้ำไม่ได้ → ยอมทิ้งดีกว่าเสี่ยงบันทึกซ้ำหลายแถว
    return ignore('ข้อความไม่มี mid จึงกันซ้ำไม่ได้');
  }

  if (message.is_deleted === true) return ignore('ข้อความถูกลบที่ต้นทาง');

  const text = str(message.text);
  const attachments = parseAttachments(message.attachments);

  /* --- echo : เพจเป็นคนส่ง (sender = เพจ, recipient = ลูกค้า) ------------ */
  if (message.is_echo === true) {
    const echo: EchoMessageEvent = {
      kind: 'echo_message',
      platform,
      page_meta_id: pageMetaId,
      psid: recipientId,
      meta_message_id: mid,
      text,
      attachments,
      sent_at: timestamp,
    };
    return [echo];
  }

  /* --- ข้อความขาเข้าปกติ --------------------------------------------------- */
  if (senderId === pageMetaId) {
    // sender เป็นเพจเองแต่ไม่ได้ตั้ง is_echo — ผิดปกติ ไม่เดาว่าเป็นของใคร
    return ignore('ผู้ส่งเป็นเพจเองแต่ไม่มี is_echo — ข้ามเพื่อความปลอดภัย');
  }

  if (text === null && attachments.length === 0) {
    return ignore('ข้อความไม่มีทั้งข้อความและไฟล์แนบ (อาจเป็นชนิดที่ยังไม่รองรับ)');
  }

  // ที่มาของแชทอยู่ได้ 2 ที่ — ในข้อความเอง หรือระดับเหตุการณ์
  const referralRaw = obj(message.referral) ?? obj(ev.referral);

  const inbound: InboundMessageEvent = {
    kind: 'inbound_message',
    platform,
    page_meta_id: pageMetaId,
    psid: senderId,
    meta_message_id: mid,
    text,
    attachments,
    sent_at: timestamp,
    referral: parseReferral(referralRaw),
  };
  return [inbound];
}
