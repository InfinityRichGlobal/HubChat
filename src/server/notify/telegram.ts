import 'server-only';
/**
 * แจ้งเตือนผ่าน Telegram (รอบ 10 — สเปกหัวข้อ 6.7 ข.)
 * ===========================================================================
 * ⚠️ ทำไมไม่ใช้ LINE :
 *    LINE Notify ปิดบริการไปแล้วตั้งแต่ 31 มี.ค. 2025
 *    ส่วน LINE Messaging API push กินโควตาที่ต้องจ่ายเงิน
 *    Telegram ฟรีและไม่จำกัดจำนวน จึงเหมาะกับ "ตาข่ายกันพลาด"
 *
 * 🔴 ข้อจำกัดที่พลาดไม่ได้ : ~20 ข้อความ/นาที ต่อกลุ่ม
 *    → ต้อง **รวบข้อความส่งเป็นก้อน** ห้ามส่งทีละข้อความเด็ดขาด
 *    ถ้าส่งทีละข้อความ วันที่ลูกค้าทักพร้อมกัน 30 คน บอทจะโดนจำกัด
 *    แล้วแจ้งเตือนจะหายทั้งหมด ซึ่งแย่กว่าไม่มีระบบแจ้งเตือนเสียอีก
 */
import { getRuntimeSetting } from '@/server/settings/service';

const TELEGRAM_HOST = 'https://api.telegram.org';

/** เพดานความยาวข้อความของ Telegram */
const MAX_MESSAGE_LENGTH = 4000;

/** ตัวยิงจริง — แยกออกมาให้ชุดทดสอบสวมของปลอมเข้าไปได้ */
export type Fetcher = typeof fetch;
let _fetcher: Fetcher | null = null;

export function __setTelegramFetcherForTests(f: Fetcher | null): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('__setTelegramFetcherForTests() ใช้บนเครื่องจริงไม่ได้');
  }
  _fetcher = f;
}

function fetcher(): Fetcher {
  return _fetcher ?? fetch;
}

export type TelegramConfig = { bot_token: string; chat_id: string };

export async function telegramConfig(chatIdOverride?: string | null): Promise<TelegramConfig | null> {
  const [token, savedChatId] = await Promise.all([
    getRuntimeSetting('TELEGRAM_BOT_TOKEN'), getRuntimeSetting('TELEGRAM_CHAT_ID'),
  ]);
  const chatId = chatIdOverride?.trim() || savedChatId;
  if (!token || !chatId) return null;
  return { bot_token: token, chat_id: chatId };
}

export async function isTelegramConfigured(chatIdOverride?: string | null): Promise<boolean> {
  return (await telegramConfig(chatIdOverride)) !== null;
}

/* ------------------------------------------------------------------------ */
/* ประกอบข้อความ (ฟังก์ชันบริสุทธิ์ — ทดสอบแยกได้)                               */
/* ------------------------------------------------------------------------ */

export type TelegramItem = {
  title: string;
  body: string;
  link?: string | null;
};

/** อักขระที่ต้อง escape ใน HTML ของ Telegram */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * รวบหลายเรื่องเป็นข้อความเดียว
 *
 * ⭐ นี่คือหัวใจของการไม่ชนโควตา — 30 เหตุการณ์ = 1 ข้อความ ไม่ใช่ 30 ข้อความ
 * ⚠️ ตัดที่เพดานความยาวเสมอ ไม่งั้น Telegram จะปฏิเสธทั้งก้อน
 *    แล้วแจ้งเตือนจะหายหมด แทนที่จะหายแค่ส่วนเกิน
 */
export function buildBatchMessage(items: TelegramItem[]): string {
  return buildBatch(items).text;
}

/**
 * 🔴 รุ่นที่บอกด้วยว่า "ใส่ไปได้กี่รายการจริง ๆ"
 *
 *    ของที่ล้นเพดานไม่ได้ถูกส่งออกไป แต่ถูกหยิบออกจากคิวไปแล้ว
 *    ถ้าไม่รู้จำนวนที่ใส่ได้จริง ผู้เรียกจะตีว่า "ส่งครบแล้ว" ทั้งที่ไม่มีใครเห็น
 *    แล้วเหตุการณ์นั้นจะหายไปตลอดกาล เพราะกุญแจกันซ้ำบล็อกการเข้าคิวใหม่
 */
export function buildBatch(items: TelegramItem[]): { text: string; used: number } {
  if (items.length === 0) return { text: '', used: 0 };

  const header =
    items.length === 1
      ? `🔔 ${escapeHtml(items[0].title)}`
      : `🔔 แจ้งเตือน ${items.length} รายการ`;

  const lines: string[] = [header, ''];
  let used = header.length + 2;
  let shown = 0;

  for (const item of items) {
    const link = item.link ? `\n  <a href="${escapeHtml(item.link)}">เปิดในแอป</a>` : '';
    const line =
      items.length === 1
        ? `${escapeHtml(item.body)}${link}`
        : `• <b>${escapeHtml(item.title)}</b>\n  ${escapeHtml(item.body)}${link}`;

    // เผื่อที่ไว้ให้บรรทัดสรุปท้ายข้อความเสมอ
    if (used + line.length + 60 > MAX_MESSAGE_LENGTH) break;

    lines.push(line);
    used += line.length + 1;
    shown += 1;
  }

  if (shown < items.length) {
    lines.push('', `<i>…และอีก ${items.length - shown} รายการ (จะตามมาในรอบถัดไป)</i>`);
  }

  return { text: lines.join('\n'), used: shown };
}

/* ------------------------------------------------------------------------ */
/* ยิงจริง                                                                    */
/* ------------------------------------------------------------------------ */

export type TelegramResult =
  | { ok: true }
  | { ok: false; error_th: string; retryable: boolean };

async function callTelegram(
  cfg: TelegramConfig,
  method: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error_th: string; retryable: boolean }> {
  let res: Response;
  try {
    res = await fetcher()(`${TELEGRAM_HOST}/bot${cfg.bot_token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return {
      ok: false,
      error_th: `ติดต่อ Telegram ไม่ได้: ${(err as Error).message}`,
      retryable: true,
    };
  }

  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; description?: string; result?: Record<string, unknown>; error_code?: number }
    | null;

  if (!res.ok || body?.ok !== true) {
    return { ok: false, ...explainTelegramError(body?.error_code ?? res.status, body?.description) };
  }

  return { ok: true, data: (body.result as Record<string, unknown>) ?? {} };
}

/** เหมือน callTelegram แต่คืน result ดิบ (ใช้กับ endpoint ที่คืนอาเรย์) */
async function callTelegramRaw(
  cfg: TelegramConfig,
  method: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true; result: unknown } | { ok: false; error_th: string }> {
  let res: Response;
  try {
    res = await fetcher()(`${TELEGRAM_HOST}/bot${cfg.bot_token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { ok: false, error_th: `ติดต่อ Telegram ไม่ได้: ${(err as Error).message}` };
  }

  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; description?: string; result?: unknown; error_code?: number }
    | null;

  if (!res.ok || body?.ok !== true) {
    return { ok: false, error_th: explainTelegramError(body?.error_code ?? res.status, body?.description).error_th };
  }
  return { ok: true, result: body.result };
}

export function explainTelegramError(
  code: number,
  description?: string,
): { error_th: string; retryable: boolean } {
  if (code === 401) {
    return { error_th: 'bot token ไม่ถูกต้อง — สร้างใหม่จาก @BotFather แล้วใส่ในไฟล์ตั้งค่า', retryable: false };
  }
  if (code === 400 && (description ?? '').includes('chat not found')) {
    return {
      error_th: 'หา Chat ID ไม่เจอ — ต้องดึงบอทเข้ากลุ่มก่อน แล้วพิมพ์อะไรสักอย่างในกลุ่ม',
      retryable: false,
    };
  }
  if (code === 403) {
    return { error_th: 'บอทถูกเตะออกจากกลุ่มแล้ว — ดึงบอทเข้ากลุ่มใหม่', retryable: false };
  }
  if (code === 429) {
    return { error_th: 'ส่ง Telegram ถี่เกินโควตา — ระบบจะรวบส่งรอบถัดไปให้เอง', retryable: true };
  }
  return { error_th: description ? `Telegram: ${description}` : `Telegram ตอบกลับผิดพลาด (${code})`, retryable: true };
}

/**
 * ส่งข้อความหนึ่งก้อน
 *
 * ⭐ คืน `used` มาด้วยเสมอ = จำนวนรายการที่ "ใส่ลงในข้อความนี้ได้จริง"
 *    ผู้เรียกต้องเอาส่วนที่เหลือกลับเข้าคิว ไม่ใช่ตีว่าส่งครบแล้ว
 */
export async function sendTelegramBatch(
  items: TelegramItem[],
  chatIdOverride?: string | null,
): Promise<TelegramResult & { used: number }> {
  const cfg = await telegramConfig(chatIdOverride);
  if (!cfg) {
    return { ok: false, error_th: 'ยังไม่ได้ตั้งค่า Telegram', retryable: false, used: 0 };
  }
  if (items.length === 0) return { ok: true, used: 0 };

  const { text, used } = buildBatch(items);
  const result = await callTelegram(cfg, 'sendMessage', {
    chat_id: cfg.chat_id,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });

  if (result.ok) return { ok: true, used };
  return { ok: false, error_th: result.error_th, retryable: result.retryable, used: 0 };
}

/** ปุ่ม "ทดสอบส่ง" ในหน้าตั้งค่า */
export async function sendTelegramTest(chatIdOverride?: string | null): Promise<TelegramResult> {
  return sendTelegramBatch(
    [{ title: 'ทดสอบการแจ้งเตือน', body: 'ถ้าเห็นข้อความนี้ แปลว่าตั้งค่า Telegram ถูกต้องแล้ว ✅' }],
    chatIdOverride,
  );
}

/**
 * ปุ่ม "ตรวจหา Chat ID อัตโนมัติ" (สเปก 6.7)
 * ⚠️ getUpdates เห็นเฉพาะข้อความที่เกิด "หลังจาก" ดึงบอทเข้ากลุ่ม
 *    ต้องบอกผู้ใช้ให้พิมพ์อะไรสักอย่างในกลุ่มก่อน ไม่งั้นจะได้ค่าว่างแล้วงง
 */
export async function discoverChatIds(): Promise<
  { ok: true; chats: Array<{ id: string; title: string }> } | { ok: false; error_th: string }
> {
  const cfg = await telegramConfig();
  if (!cfg) return { ok: false, error_th: 'ยังไม่ได้ใส่ bot token ในไฟล์ตั้งค่า (.env.local)' };

  /**
   * ⚠️ getUpdates คืน result เป็น "อาเรย์" ไม่ใช่ object
   *    callTelegram พิมพ์ไว้เป็น Record จึงต้องแปลงอย่างระวังตรงนี้
   *    (เขียนผิดตรงนี้จะได้รายการว่างเปล่าเงียบ ๆ แล้วผู้ใช้จะงงว่าทำไมหาไม่เจอ)
   */
  const raw = await callTelegramRaw(cfg, 'getUpdates', { limit: 50 });
  if (!raw.ok) return { ok: false, error_th: raw.error_th };

  const updates = Array.isArray(raw.result) ? (raw.result as Array<Record<string, unknown>>) : [];

  const seen = new Map<string, string>();
  for (const u of updates) {
    const msg = (u.message ?? u.channel_post ?? u.my_chat_member) as Record<string, unknown> | undefined;
    const chat = msg?.chat as Record<string, unknown> | undefined;
    if (!chat?.id) continue;
    const id = String(chat.id);
    const title = String(chat.title ?? chat.username ?? chat.first_name ?? 'ไม่ทราบชื่อ');
    if (!seen.has(id)) seen.set(id, title);
  }

  return { ok: true, chats: [...seen.entries()].map(([id, title]) => ({ id, title })) };
}
