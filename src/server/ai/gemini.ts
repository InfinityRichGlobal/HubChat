import 'server-only';
import { getRuntimeSetting } from '@/server/settings/service';

export async function getGeminiApiKey(): Promise<string | null> {
  return await getRuntimeSetting('GEMINI_API_KEY');
}

export type CommentReplyContext = {
  fromName?: string | null;
  postTitle?: string | null;
  mode?: 'public' | 'private';
};

/**
 * ให้ Google Gemini ช่วยคิดข้อความตอบกลับคอมเมนต์ลูกค้า
 * - mode = 'public': ตอบใต้โพสต์ สุภาพ กระชับ แนะนำให้เช็คอินบ็อกซ์
 * - mode = 'private': ข้อความทักอินบ็อกซ์ต้อนรับอย่างเป็นกันเองและมืออาชีพ
 */
export async function generateCommentReply(
  commentText: string,
  context: CommentReplyContext = {},
): Promise<string> {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    throw new Error('ยังไม่ได้ตั้งค่า GEMINI_API_KEY — ไปที่ ตั้งค่า → ระบบ + ความลับ เพื่อใส่คีย์');
  }

  const { fromName, postTitle, mode = 'public' } = context;

  const systemInstruction = mode === 'public'
    ? `คุณคือแอดมินเพจร้านค้าออนไลน์ของไทยที่สุภาพ เป็นมิตร และมืออาชีพ
หน้าที่ของคุณคือเขียนคำตอบสำหรับคอมเมนต์ใต้โพสต์ Facebook ของลูกค้า
กฎสำคัญ:
1. ตอบด้วยภาษาไทยที่สุภาพ น่ารัก ใช้หางเสียง "ค่ะ" หรือ "นะคะ" อย่างเป็นธรรมชาติ
2. ห้ามเปิดเผยข้อมูลส่วนตัว หรือราคาละเอียดถ้าเป็นสินค้าที่ต้องทักอินบ็อกซ์
3. แนะนำให้ลูกค้าเช็คข้อความในกล่องข้อความ (Inbox) อย่างสุภาพ
4. ตอบให้สั้น กระชับ 1-2 ประโยค ไม่เยิ่นเย้อ
5. หากระบุชื่อลูกค้า (${fromName || 'ลูกค้า'}) ให้ทักทายด้วยความสุภาพ เช่น "สวัสดีค่ะคุณ${fromName || ''}"`
    : `คุณคือแอดมินเพจร้านค้าออนไลน์ของไทยที่สุภาพ เป็นมิตร และพร้อมบริการ
หน้าที่ของคุณคือเขียนข้อความเริ่มต้นทักทายลูกค้าทางอินบ็อกซ์ (Messenger) จากการที่ลูกค้าคอมเมนต์ใต้โพสต์
กฎสำคัญ:
1. ทักทายสุภาพ เป็นกันเอง ภาษาไทยธรรมชาติ
2. ขอบคุณที่ลูกค้าให้ความสนใจในโพสต์/สินค้า
3. แจ้งว่าแอดมินพร้อมให้ข้อมูลโปรโมชั่นหรือรายละเอียดสินค้าที่ลูกค้าสอบถาม
4. ไม่ยาวเกินไป ประมาณ 2-3 ประโยค กระชับ ชัดเจน`;

  const userPrompt = `คอมเมนต์ของลูกค้า: "${commentText}"
ชื่อลูกค้า: ${fromName || 'ไม่ระบุ'}
โพสต์ต้นทาง: ${postTitle || 'โพสต์ของเพจ'}
เขียนข้อความตอบกลับ:`;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: `${systemInstruction}\n\n${userPrompt}` },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 256,
    },
  };

  const models = ['gemini-2.5-flash', 'gemini-1.5-flash'];
  let lastError: Error | null = null;

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          cache: 'no-store',
        },
      );

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const errMsg = errJson?.error?.message || `HTTP ${res.status}`;
        throw new Error(`Gemini API (${model}) ผิดพลาด: ${errMsg}`);
      }

      const data = await res.json();
      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (reply) {
        return reply.replace(/^["'「」]+|["'「」]+$/g, '').trim();
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError || new Error('ไม่สามารถสร้างข้อความตอบกลับจาก AI ได้');
}
