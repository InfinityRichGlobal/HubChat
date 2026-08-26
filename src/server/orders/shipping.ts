import 'server-only';
/**
 * วิธีจัดส่ง + เก็บเงินปลายทาง (รอบ 6)
 * ===========================================================================
 * 🔴 ทำไมต้องเป็นตาราง ไม่ใช่แค่พิมพ์ชื่อขนส่งลงไปในออเดอร์ :
 *
 *    "รับเก็บเงินปลายทางได้ไหม" เป็นกฎที่ต้องบังคับฝั่งเซิร์ฟเวอร์
 *    ถ้าเก็บเป็นแค่ตัวหนังสือ ระบบจะไม่มีทางรู้ว่าคู่ที่แอดมินเลือกเป็นไปได้จริงไหม
 *    แล้ววันหนึ่งจะมีออเดอร์ COD ที่ขนส่งไม่รับ — ของถูกส่งออกไปแล้วค่อยรู้
 *
 * ⭐ กฎถูกบังคับสองชั้น : ที่นี่ (อ่านง่าย บอกเหตุผลได้) และในฐานข้อมูล (กันจริง)
 */
import { db } from '@/lib/supabase/admin';

export class ShippingError extends Error {}

const COLUMNS = 'id,name,fee,cod_supported,note,is_active,archived_at,sort_order,created_at,updated_at';

export type ShippingMethod = {
  id: string;
  name: string;
  fee: number;
  cod_supported: boolean;
  note: string | null;
  is_active: boolean;
  archived_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

function normalise(rows: ShippingMethod[]): ShippingMethod[] {
  return rows.map((m) => ({ ...m, fee: Number(m.fee) }));
}

/**
 * @param activeOnly true = เอาเฉพาะที่เลือกได้จริงตอนนี้ (ใช้ตอนสร้างออเดอร์)
 *                   false = เอาทั้งหมดที่ยังไม่เก็บเข้ากรุ (ใช้ในหน้าตั้งค่า)
 */
export async function listShippingMethods(activeOnly = false): Promise<ShippingMethod[]> {
  let q = db().from('shipping_methods').select(COLUMNS).is('archived_at', null).order('sort_order').limit(100);
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw new Error(`อ่านวิธีจัดส่งไม่สำเร็จ: ${error.message}`);
  return normalise((data ?? []) as ShippingMethod[]);
}

export async function getShippingMethod(id: string): Promise<ShippingMethod | null> {
  const { data } = await db().from('shipping_methods').select(COLUMNS).eq('id', id).maybeSingle();
  return data ? normalise([data as ShippingMethod])[0] : null;
}

export type ShippingInput = {
  name: string;
  fee: number;
  cod_supported?: boolean;
  note?: string | null;
  is_active?: boolean;
  sort_order?: number;
};

export function validateShipping(input: Partial<ShippingInput>): string | null {
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length === 0) return 'ต้องกรอกชื่อวิธีจัดส่ง';
    if (name.length > 80) return 'ชื่อวิธีจัดส่งยาวเกินไป (สูงสุด 80 ตัวอักษร)';
  }
  if (input.fee !== undefined) {
    if (!Number.isFinite(input.fee) || input.fee < 0) return 'ค่าจัดส่งต้องเป็นตัวเลขไม่ติดลบ';
    if (input.fee > 100000) return 'ค่าจัดส่งสูงผิดปกติ';
  }
  return null;
}

export async function createShippingMethod(input: ShippingInput): Promise<ShippingMethod> {
  const problem = validateShipping(input);
  if (problem) throw new ShippingError(problem);

  const { data, error } = await db()
    .from('shipping_methods')
    .insert({
      name: input.name.trim(),
      fee: input.fee,
      cod_supported: input.cod_supported ?? true,
      note: input.note?.trim() || null,
      is_active: input.is_active ?? true,
      sort_order: input.sort_order ?? 0,
    })
    .select(COLUMNS)
    .single();

  // 23505 = ชื่อซ้ำ (unique index บน lower(name) เฉพาะที่ยังไม่เก็บเข้ากรุ)
  if (error) {
    if (error.code === '23505') throw new ShippingError('มีวิธีจัดส่งชื่อนี้อยู่แล้ว');
    throw new Error(`บันทึกวิธีจัดส่งไม่สำเร็จ: ${error.message}`);
  }
  return normalise([data as ShippingMethod])[0];
}

export async function updateShippingMethod(
  id: string,
  input: Partial<ShippingInput> & { archive?: boolean },
): Promise<ShippingMethod | null> {
  const problem = validateShipping(input);
  if (problem) throw new ShippingError(problem);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.fee !== undefined) patch.fee = input.fee;
  if (input.cod_supported !== undefined) patch.cod_supported = input.cod_supported;
  if (input.note !== undefined) patch.note = input.note?.trim() || null;
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;

  // ⭐ เก็บเข้ากรุ = ปิดใช้ด้วยเสมอ ไม่งั้นจะยังโผล่ในบางจอ
  if (input.archive) {
    patch.archived_at = new Date().toISOString();
    patch.is_active = false;
  }

  const { data, error } = await db()
    .from('shipping_methods')
    .update(patch)
    .eq('id', id)
    .select(COLUMNS)
    .maybeSingle();
  if (error) {
    if (error.code === '23505') throw new ShippingError('มีวิธีจัดส่งชื่อนี้อยู่แล้ว');
    throw new Error(`แก้ไขวิธีจัดส่งไม่สำเร็จ: ${error.message}`);
  }
  return data ? normalise([data as ShippingMethod])[0] : null;
}

/* ------------------------------------------------------------------------ */
/* กฎ COD                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * ตรวจว่าคู่ "วิธีจ่ายเงิน + วิธีจัดส่ง" เป็นไปได้จริงไหม
 *
 * ⚠️ ฟังก์ชันนี้เป็นตัวช่วยให้ข้อความผิดพลาดอ่านรู้เรื่อง
 *    ตัวที่กันจริงคือ create_order/update_order ในฐานข้อมูล
 *    (ถ้ากันแค่ที่นี่ ใครยิง rpc ตรงก็ข้ามได้)
 */
export function codCombinationProblem(
  paymentMethod: string | null | undefined,
  method: Pick<ShippingMethod, 'name' | 'cod_supported'> | null,
): string | null {
  if (paymentMethod !== 'cod') return null;
  if (!method) return null; // ไม่ได้เลือกวิธีจัดส่ง — ปล่อยผ่าน ให้ไปเลือกทีหลังได้
  if (!method.cod_supported) {
    return `วิธีจัดส่ง "${method.name}" ไม่รองรับเก็บเงินปลายทาง — เลือกวิธีอื่น หรือเปลี่ยนเป็นโอนเงิน`;
  }
  return null;
}
