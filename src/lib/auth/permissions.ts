/**
 * ตารางสิทธิ์ 3 ระดับ ตามสเปกหัวข้อ 5.7
 * -------------------------------------------------------------------------
 * เขียนเป็นตารางกลางที่เดียว ไม่กระจายเงื่อนไข if ตามไฟล์ต่าง ๆ
 * เวลาสิทธิ์เปลี่ยน จะได้แก้ที่นี่ที่เดียวแล้วมีผลทั้งระบบ
 *
 *                        | เจ้าของ | แอดมิน      | ผู้ดู
 *  ตอบแชท                |   ✅   |   ✅        |  ❌
 *  สร้าง/แก้ออเดอร์       |   ✅   |   ✅        |  ❌
 *  ลบออเดอร์             |   ✅   |   ❌        |  ❌
 *  จัดการชุดคำตอบ/คีย์เวิร์ด|   ✅   | ดูอย่างเดียว |  ❌
 *  เชื่อมเพจ / เห็น token  |   ✅   |   ❌        |  ❌
 *  สร้าง/ลบแอดมิน         |   ✅   |   ❌        |  ❌
 *  Dashboard ยอดขาย       |   ✅   | เฉพาะของตัวเอง|  ✅
 */
import type { AdminRole } from '@/types/db';

export type Permission =
  | 'chat.reply'            // ตอบแชท
  | 'order.create'          // สร้าง/แก้ออเดอร์
  | 'order.delete'          // ลบออเดอร์
  | 'content.view'          // ดูชุดคำตอบ / กฎคีย์เวิร์ด
  | 'content.manage'        // แก้ชุดคำตอบ / กฎคีย์เวิร์ด
  | 'page.manage'           // เชื่อมเพจ / เห็น access token
  | 'admin.manage'          // สร้าง/ลบแอดมิน + เตะออกทุกเครื่อง
  | 'dashboard.view.all'    // เห็นยอดขายทั้งร้าน
  | 'dashboard.view.self'   // เห็นเฉพาะยอดของตัวเอง
  | 'activity.view';        // ดู activity log

const MATRIX: Record<AdminRole, Permission[]> = {
  owner: [
    'chat.reply', 'order.create', 'order.delete',
    'content.view', 'content.manage',
    'page.manage', 'admin.manage',
    'dashboard.view.all', 'dashboard.view.self',
    'activity.view',
  ],
  admin: [
    'chat.reply', 'order.create',
    'content.view',
    'dashboard.view.self',
  ],
  viewer: [
    // ผู้ดู : ดู Dashboard ได้อย่างเดียว ตอบแชทไม่ได้ แตะออเดอร์ไม่ได้
    'dashboard.view.all',
  ],
};

/** ถามว่าสิทธิ์ระดับนี้ทำสิ่งนี้ได้ไหม */
export function can(role: AdminRole, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

/** ชื่อสิทธิ์ภาษาไทย ใช้แสดงในหน้าจัดการแอดมิน */
export const ROLE_LABEL_TH: Record<AdminRole, string> = {
  owner: 'เจ้าของ',
  admin: 'แอดมิน',
  viewer: 'ผู้ดู',
};

export const ROLE_DESCRIPTION_TH: Record<AdminRole, string> = {
  owner: 'ทำได้ทุกอย่าง รวมถึงเชื่อมเพจ จัดการแอดมิน และลบออเดอร์',
  admin: 'ตอบแชทและสร้างออเดอร์ได้ ดูชุดคำตอบได้แต่แก้ไม่ได้ เห็นยอดขายเฉพาะของตัวเอง',
  viewer: 'ดูอย่างเดียว ตอบแชทไม่ได้ สร้างออเดอร์ไม่ได้',
};

/**
 * แอดมินคนนี้เห็นเพจนี้ไหม
 * เจ้าของเห็นทุกเพจเสมอ / คนอื่นดูจาก allowed_page_ids
 */
export function canSeePage(role: AdminRole, allowedPageIds: string[], pageId: string): boolean {
  if (role === 'owner') return true;
  return allowedPageIds.includes(pageId);
}
