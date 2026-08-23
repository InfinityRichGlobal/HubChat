import PlaceholderPage from '@/components/placeholder-page';

/** ฟีดคอมเมนต์ — สเปกหัวข้อ 5.5 */
export default function CommentsPage() {
  return (
    <PlaceholderPage
      title="คอมเมนต์"
      round="รอบ 6"
      description="ไม่ตอบอัตโนมัติ แอดมินกดเองทั้งหมด"
      items={['ฟีดสด', 'ตอบใต้โพสต์ / ทักส่วนตัว', 'ตัวกรองคำ', 'ตัวนับที่ยังไม่จัดการ']}
    />
  );
}
