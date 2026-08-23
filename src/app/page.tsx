import { redirect } from 'next/navigation';

/** หน้าแรก — ส่งต่อไปอินบ็อกซ์ (middleware จะพาไปหน้า login เองถ้ายังไม่ได้เข้าสู่ระบบ) */
export default function HomePage() {
  redirect('/inbox');
}
