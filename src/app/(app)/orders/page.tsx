import PlaceholderPage from '@/components/placeholder-page';

/** ออเดอร์ — สเปกหัวข้อ 5.3 */
export default function OrdersPage() {
  return (
    <PlaceholderPage
      title="ออเดอร์"
      round="รอบ 5"
      description="ตารางฐานข้อมูลพร้อมแล้ว หน้าจอจะทำหลังหน้าแชท"
      items={['ลิสต์ + ฟิลเตอร์', 'รายละเอียด + ประวัติแก้ไข', 'ปุ่มคัดลอกที่อยู่', 'นำเข้าเลขพัสดุ']}
    />
  );
}
