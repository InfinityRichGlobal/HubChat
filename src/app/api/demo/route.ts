import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/current-admin';
import { ok, fail, toErrorResponse } from '@/lib/api';
import { db } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE = 'd0000000-0000-4000-8000-000000000001';
const CUSTOMERS = [
  'd0000000-0000-4000-8000-000000000011',
  'd0000000-0000-4000-8000-000000000012',
  'd0000000-0000-4000-8000-000000000013',
];
const CONVERSATIONS = [
  'd0000000-0000-4000-8000-000000000021',
  'd0000000-0000-4000-8000-000000000022',
  'd0000000-0000-4000-8000-000000000023',
];
const PRODUCTS = [
  'd0000000-0000-4000-8000-000000000031',
  'd0000000-0000-4000-8000-000000000032',
  'd0000000-0000-4000-8000-000000000033',
];
const PROMOTIONS = [
  'd0000000-0000-4000-8000-000000000041',
  'd0000000-0000-4000-8000-000000000042',
];
const ORDERS = [
  'd0000000-0000-4000-8000-000000000051',
  'd0000000-0000-4000-8000-000000000052',
  'd0000000-0000-4000-8000-000000000053',
];
const CANNED = 'd0000000-0000-4000-8000-000000000061';

const schema = z.object({ action: z.enum(['seed', 'reset']) });

async function resetDemo() {
  await db().from('orders').delete().in('id', ORDERS);
  await db().from('canned_responses').delete().eq('id', CANNED);
  await db().from('promotions').delete().in('id', PROMOTIONS);
  await db().from('products').delete().in('id', PRODUCTS);
  await db().from('pages').delete().eq('id', PAGE);
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    if (admin.role !== 'owner') return fail('forbidden', 'เฉพาะเจ้าของระบบที่จัดการข้อมูลทดลองได้', 403);
    const { action } = schema.parse(await req.json());
    await resetDemo();
    if (action === 'reset') return ok({ reset: true });

    const now = Date.now();
    const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
    const step = async (table: string, rows: unknown) => {
      const { error } = await db().from(table).upsert(rows as never);
      if (error) throw new Error(`สร้างข้อมูลทดลอง ${table} ไม่สำเร็จ: ${error.message}`);
    };

    await step('pages', { id: PAGE, platform: 'facebook', page_id: 'hubchat-demo-page', page_name: 'HubChat Demo Shop', display_name: 'ร้านทดลอง', tag_color: '#ec4899', is_active: true });
    await step('products', [
      { id: PRODUCTS[0], name: 'ลิปสติก', variant: 'เขียว', sku: 'DEMO-GREEN', price: 359, image_url: '#22c55e', sort_order: 1 },
      { id: PRODUCTS[1], name: 'ลิปสติก', variant: 'ชมพู', sku: 'DEMO-PINK', price: 359, image_url: '#ec4899', sort_order: 2 },
      { id: PRODUCTS[2], name: 'ลิปสติก', variant: 'แดงอิฐ', sku: 'DEMO-BRICK', price: 359, image_url: '#b45309', sort_order: 3 },
    ]);
    await step('promotions', [
      { id: PROMOTIONS[0], name: 'แพ็ก 2 ชิ้น', type: 'bundle', config: { pick: 2 }, price: 579, sort_order: 1 },
      { id: PROMOTIONS[1], name: 'ซื้อ 3 แถม 1', type: 'buy_x_get_y', config: { pick: 4, pay: 3 }, price: 1059, sort_order: 2 },
    ]);
    await step('customers', [
      { id: CUSTOMERS[0], page_id: PAGE, psid: 'demo-customer-1', platform: 'facebook', name: 'คุณออร่า', recipient_name: 'ออร่า สุทธิประภา', phone: '081-234-5678', address: '99 ถนนสุขุมวิท แขวงคลองตัน กรุงเทพฯ', postcode: '10110', total_orders: 2, total_spent: 1638, first_contact_at: iso(240), last_customer_message_at: iso(8) },
      { id: CUSTOMERS[1], page_id: PAGE, psid: 'demo-customer-2', platform: 'facebook', name: 'คุณมิน', recipient_name: 'มินตรา ใจดี', phone: '089-555-1212', address: '12 ถนนนิมมานเหมินท์ เชียงใหม่', postcode: '50200', total_orders: 1, total_spent: 359, first_contact_at: iso(1440), last_customer_message_at: iso(35) },
      { id: CUSTOMERS[2], page_id: PAGE, psid: 'demo-customer-3', platform: 'facebook', name: 'คุณแพรว', total_orders: 0, total_spent: 0, first_contact_at: iso(4320), last_customer_message_at: iso(90) },
    ]);
    await step('conversations', [
      { id: CONVERSATIONS[0], customer_id: CUSTOMERS[0], page_id: PAGE, last_message_at: iso(8), last_message_preview: 'ขอสีเขียว 2 ชิ้นค่ะ', last_customer_message_at: iso(8), is_read: false, referral_source: 'ADS' },
      { id: CONVERSATIONS[1], customer_id: CUSTOMERS[1], page_id: PAGE, last_message_at: iso(35), last_message_preview: 'โอนแล้วนะคะ', last_customer_message_at: iso(35), is_read: true, referral_source: 'ORGANIC' },
      { id: CONVERSATIONS[2], customer_id: CUSTOMERS[2], page_id: PAGE, last_message_at: iso(90), last_message_preview: 'มีโปรอะไรบ้างคะ', last_customer_message_at: iso(90), is_read: false, referral_source: 'POST' },
    ]);
    await step('messages', [
      { id: 'd0000000-0000-4000-8000-000000000071', conversation_id: CONVERSATIONS[0], direction: 'in', sender_type: 'customer', text: 'ขอสีเขียว 2 ชิ้นค่ะ', created_at: iso(8) },
      { id: 'd0000000-0000-4000-8000-000000000072', conversation_id: CONVERSATIONS[1], direction: 'in', sender_type: 'customer', text: 'โอนแล้วนะคะ', created_at: iso(35) },
      { id: 'd0000000-0000-4000-8000-000000000073', conversation_id: CONVERSATIONS[2], direction: 'in', sender_type: 'customer', text: 'มีโปรอะไรบ้างคะ', created_at: iso(90) },
    ]);
    await step('orders', [
      { id: ORDERS[0], order_no: 'DEMO-001', conversation_id: CONVERSATIONS[0], customer_id: CUSTOMERS[0], page_id: PAGE, recipient_name: 'ออร่า สุทธิประภา', phone: '081-234-5678', items: [{ product_id: PRODUCTS[0], name: 'ลิปสติก', variant: 'เขียว', qty: 2, unit_price: 359, total: 718 }], subtotal: 718, total: 718, payment_method: 'transfer', payment_status: 'paid', status: 'paid', created_by_admin_id: admin.id },
      { id: ORDERS[1], order_no: 'DEMO-002', conversation_id: CONVERSATIONS[0], customer_id: CUSTOMERS[0], page_id: PAGE, recipient_name: 'ออร่า สุทธิประภา', phone: '081-234-5678', items: [{ product_id: PRODUCTS[1], name: 'ลิปสติก', variant: 'ชมพู', qty: 2, unit_price: 290, total: 580 }], subtotal: 580, shipping_fee: 40, total: 620, payment_method: 'cod', payment_status: 'unpaid', status: 'draft', created_by_admin_id: admin.id },
      { id: ORDERS[2], order_no: 'DEMO-003', conversation_id: CONVERSATIONS[1], customer_id: CUSTOMERS[1], page_id: PAGE, recipient_name: 'มินตรา ใจดี', phone: '089-555-1212', items: [{ product_id: PRODUCTS[2], name: 'ลิปสติก', variant: 'แดงอิฐ', qty: 1, unit_price: 359, total: 359 }], subtotal: 359, total: 359, payment_method: 'transfer', payment_status: 'paid', status: 'packed', created_by_admin_id: admin.id },
    ]);
    await step('canned_responses', {
      id: CANNED,
      title: 'แนะนำโปรลิปสติก', shortcut: 'promo', category: 'ขาย',
      text: 'โปรวันนี้ เลือกสีที่ชอบได้เลยค่ะ 💄',
      images: [{ url: 'https://images.unsplash.com/photo-1586495777744-4413f21062fa?auto=format&fit=crop&w=900&q=80', name: 'ลิปสติกตัวอย่าง', mime: 'image/jpeg' }],
    });

    return ok({ seeded: true, conversations: CONVERSATIONS.length, orders: ORDERS.length });
  } catch (err) {
    return toErrorResponse(err);
  }
}
