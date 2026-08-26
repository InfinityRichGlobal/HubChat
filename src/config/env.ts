/**
 * อ่านค่าตั้งระบบจาก environment variable "เท่านั้น"
 * -------------------------------------------------------------------------
 * กฎเหล็กของไฟล์นี้ :
 *   1. ห้ามมีค่าจริง (url / key / รหัสผ่าน) เขียนตายอยู่ในโค้ดเด็ดขาด
 *   2. ถ้า env ขาด ให้ระบบล้มทันทีพร้อมบอกเป็นภาษาไทยว่าขาดตัวไหน
 *      ดีกว่าปล่อยให้รันไปแล้วพังตอนดึก ๆ ที่ลูกค้ากำลังทัก
 *   3. ค่าฝั่งเซิร์ฟเวอร์ห้ามหลุดไปฝั่งเบราว์เซอร์ (มีตัวกันไว้ด้านล่าง)
 */
import { z } from 'zod';


/* -------------------------------------------------------------------------
 * ฝั่งเบราว์เซอร์ — ต้องขึ้นต้นด้วย NEXT_PUBLIC_ เท่านั้น
 * Next.js แทนค่าตอน build จึงต้องเขียน process.env.NEXT_PUBLIC_X แบบเต็ม ๆ
 * ----------------------------------------------------------------------- */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL ต้องเป็น URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, 'NEXT_PUBLIC_SUPABASE_ANON_KEY สั้นเกินไป'),
  NEXT_PUBLIC_APP_NAME: z.string().default('HubChat'),
});

/* -------------------------------------------------------------------------
 * ฝั่งเซิร์ฟเวอร์ — ความลับทั้งหมดอยู่ตรงนี้ ห้าม import จาก client component
 * ----------------------------------------------------------------------- */
const serverSchema = z.object({
  /* --- ฐานข้อมูล --------------------------------------------------------- */
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(20, 'SUPABASE_SERVICE_ROLE_KEY สั้นเกินไป — คัดลอกมาไม่ครบหรือเปล่า'),

  /* --- ระบบ login -------------------------------------------------------- */
  // ใช้เซ็นชื่อ session cookie ยาวอย่างน้อย 32 ตัว
  // สร้างด้วย : openssl rand -base64 48
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร (สร้างด้วย openssl rand -base64 48)'),
  // อายุ session เป็นชั่วโมง — แอดมินใช้มือถือ ไม่ควรบังคับ login บ่อย
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(720),
  // rate limit หน้า login ตามเช็คลิสต์ข้อ 9
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),

  /* --- เข้ารหัส access token ของเพจก่อนเก็บลง DB (เช็คลิสต์ข้อ 9) -------- */
  // คีย์ AES-256 ขนาด 32 ไบต์ เข้ารหัสเป็น base64
  // สร้างด้วย : openssl rand -base64 32
  ENCRYPTION_KEY: z
    .string()
    .min(32, 'ENCRYPTION_KEY ต้องเป็น base64 ของ 32 ไบต์ (สร้างด้วย openssl rand -base64 32)'),

  /* --- ทั่วไป ------------------------------------------------------------ */
  APP_URL: z.string().url().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TZ_DISPLAY: z.string().default('Asia/Bangkok'),
});

/* -------------------------------------------------------------------------
 * ค่าที่ยังไม่ใช้ในรอบนี้ แต่จองที่ไว้ให้รอบถัด ๆ ไป
 * ทั้งหมดเป็น optional — ยังไม่ใส่ก็รันได้ ไม่พัง
 * ----------------------------------------------------------------------- */
const futureSchema = z.object({
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_VERIFY_TOKEN: z.string().optional(),
  META_GRAPH_VERSION: z.string().default('v21.0'),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  // PWA Push (รอบ 10) — สร้างคู่กุญแจด้วย `npm run vapid`
  // ⚠️ VAPID_PRIVATE_KEY ห้ามหลุดไปฝั่งเบราว์เซอร์เด็ดขาด
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),

  // ที่อยู่ของแอปสำหรับประกอบลิงก์ในแจ้งเตือน (ต้องเป็น https ตอนใช้จริง)
  APP_BASE_URL: z.string().url().optional(),

  // หมายเหตุ : ค่าตั้งของ Message Policy Engine (กรอบเวลา / เปิด-ปิด transport)
  // ไม่ได้อยู่ที่นี่โดยตั้งใจ — อยู่ที่ src/server/policy/config.ts ที่เดียว
  // เพราะเป็น "กฎของ Meta" ไม่ใช่ค่าตั้งทั่วไปของแอป และต้องหาเจอง่ายเวลากฎเปลี่ยน
});

type PublicEnv = z.infer<typeof publicSchema>;
type ServerEnv = z.infer<typeof serverSchema> & z.infer<typeof futureSchema>;

/** แปลง error ของ zod ให้เป็นข้อความไทยที่อ่านแล้วรู้ว่าต้องไปแก้ตรงไหน */
function explain(prefix: string, error: z.ZodError): never {
  const lines = error.issues.map((i) => `  • ${i.path.join('.')} — ${i.message}`);
  throw new Error(
    `\n[${prefix}] ตั้งค่า environment ไม่ครบ / ไม่ถูกต้อง :\n${lines.join('\n')}\n` +
      `ดูตัวอย่างทั้งหมดได้ที่ไฟล์ .env.example\n`,
  );
}

let _publicEnv: PublicEnv | null = null;
let _serverEnv: ServerEnv | null = null;

/** ค่าที่ปลอดภัยพอจะส่งไปฝั่งเบราว์เซอร์ */
export function publicEnv(): PublicEnv {
  if (_publicEnv) return _publicEnv;
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  });
  if (!parsed.success) explain('env สาธารณะ', parsed.error);
  _publicEnv = parsed.data;
  return _publicEnv;
}

/**
 * ค่าฝั่งเซิร์ฟเวอร์ — ตรวจแบบขี้เกียจ (lazy) คือตรวจตอนเรียกใช้ครั้งแรก
 * เพื่อไม่ให้ `next build` ล้มเพราะเครื่อง build ไม่มี secret
 */
export function serverEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv() ถูกเรียกจากฝั่งเบราว์เซอร์ — ห้ามเด็ดขาด ความลับจะรั่ว');
  }
  if (_serverEnv) return _serverEnv;
  const merged = serverSchema.merge(futureSchema);
  const parsed = merged.safeParse(process.env);
  if (!parsed.success) explain('env เซิร์ฟเวอร์', parsed.error);
  _serverEnv = parsed.data;
  return _serverEnv;
}

/**
 * ตรวจ env ทั้งหมดทีเดียว ใช้ตอนสตาร์ตเซิร์ฟเวอร์หรือในสคริปต์
 * รวมถึงกฎของ Message Policy Engine ด้วย
 * (บนเครื่องจริงถ้าเปิด allow_unverified ไว้ ตัวนี้จะโยน error ทันที)
 */
export async function assertEnv(): Promise<void> {
  publicEnv();
  serverEnv();
  const { loadPolicyConfig } = await import('@/server/policy/config');
  loadPolicyConfig();
}
