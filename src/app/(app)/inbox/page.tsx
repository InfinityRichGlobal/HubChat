import PlaceholderPage from '@/components/placeholder-page';

/** อินบ็อกซ์ — สเปกหัวข้อ 5.1 (ยังไม่ทำในรอบนี้ตามที่ตกลง) */
export default function InboxPage() {
  return (
    <PlaceholderPage
      title="อินบ็อกซ์"
      round="รอบ 3"
      description="หน้าแชทจะมาหลังจากทำ Message Policy Engine เสร็จ (สเปกกำหนดว่าต้องทำ engine ก่อนหน้าแชทเสมอ)"
      items={[
        'ลิสต์แชท + กรองรายเพจ + ค้นหา',
        'ห้องแชท + ปุ่มส่งปุ่มเดียว (backend เลือก transport เอง)',
        'Realtime + ล็อกกันแอดมินชน',
        'แตะข้อความ → เมนู / ปัดขวา → ยกมาอ้างอิง',
      ]}
    />
  );
}
