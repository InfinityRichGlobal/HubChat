import PlaceholderPage from '@/components/placeholder-page';

/** Dashboard — สเปกหัวข้อ 5.4 */
export default function DashboardPage() {
  return (
    <PlaceholderPage
      title="สรุปยอด"
      round="รอบ 6"
      description="ตัวเลขจะมาจากตาราง orders / conversations ที่สร้างไว้แล้ว"
      items={['ยอดขาย / อัตราปิดการขาย', 'ตารางแยกตามแอด', 'แยกตามเพจ / แอดมิน', 'กราฟรายวัน']}
    />
  );
}
