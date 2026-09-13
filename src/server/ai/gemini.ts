import 'server-only';
import { getRuntimeSetting } from '@/server/settings/service';
import { listProducts, listPromotions } from '@/server/orders/service';

export const DEFAULT_CHAT_AI_INSTRUCTION = `คุณคือนักขายมืออาชีพอัจฉริยะ (AI Top Sales Closer) ประจำกล่องแชทของร้านค้าออนไลน์ในไทย
บุคลิกภาพ: สุภาพ อ่อนหวาน กระตือรือร้น ใช้คำลงท้าย "ค่ะ/นะคะ" ตอบคำถามอย่างมั่นใจและเป็นมิตร

หน้าที่และหลักการตอบลูกค้า:
1. ทักทายต้อนรับอย่างอบอุ่น ขอบคุณที่ลูกค้าทักแชทเข้ามา และแสดงความยินดีพร้อมให้บริการ
2. ยืนยันสินค้าพร้อมส่ง: เมื่อลูกค้าถามว่าสินค้ามีพร้อมส่งไหม ให้ยืนยันอย่างมั่นใจว่า "มีสินค้าพร้อมส่งเลยค่า"
3. นำเสนอโปรโมชั่นเด็ดทันที: นำข้อมูลโปรโมชั่นพิเศษและสินค้าขายดีจริงของร้านมาเชียร์ลูกค้าทันที เพื่อให้ลูกค้ารู้สึกคุ้มค่าที่สุด
4. เทคนิคปิดการขาย: ทุกคำตอบต้องมีประโยคชวนตัดสินใจหรือคำถามปิดการขายเสมอ เช่น "ลูกค้าสนใจรับเป็นเซตไหนดีคะ เดี๋ยวแอดมินช่วยคำนวณยอดส่วนลดพิเศษให้เลยค่า 🥰" หรือ "แจ้งจำนวนที่ต้องการได้เลยนะคะ เดี๋ยวแอดมินจัดส่งให้รอบวันนี้เลยค่า ✨"
5. กฎเหล็ก: ห้ามตอบห้วนๆ ห้ามตอบเพียงแค่ว่า "มีพร้อมส่งค่ะ" แล้วจบประโยคเด็ดขาด ต้องให้ข้อมูลโปรโมชั่นและเชียร์ขายเสมอ`;

export async function getGeminiApiKey(): Promise<string | null> {
  return await getRuntimeSetting('GEMINI_API_KEY');
}

export async function getAiSettings() {
  const [
    apiKey,
    systemPrompt,
    knowledge,
    model,
    temp,
    autoReply,
    commentSuggest,
    chatAssist,
    defaultChatBot,
    chatInstruction,
    chatPersona,
  ] = await Promise.all([
    getRuntimeSetting('GEMINI_API_KEY'),
    getRuntimeSetting('AI_SYSTEM_PROMPT'),
    getRuntimeSetting('AI_STORE_KNOWLEDGE'),
    getRuntimeSetting('AI_MODEL'),
    getRuntimeSetting('AI_TEMPERATURE'),
    getRuntimeSetting('AI_AUTO_REPLY_COMMENTS'),
    getRuntimeSetting('AI_ENABLE_COMMENT_SUGGEST'),
    getRuntimeSetting('AI_ENABLE_CHAT_ASSIST'),
    getRuntimeSetting('AI_DEFAULT_CHAT_BOT'),
    getRuntimeSetting('AI_CHAT_INSTRUCTION'),
    getRuntimeSetting('AI_CHAT_PERSONA'),
  ]);

  return {
    apiKey,
    systemPrompt: systemPrompt || '',
    knowledge: knowledge || '',
    model: model || 'gemini-3.6-flash',
    temperature: temp ? parseFloat(temp) : 0.7,
    autoReplyComments: autoReply === 'on',
    enableCommentSuggest: commentSuggest !== 'off', // default on
    enableChatAssist: chatAssist !== 'off', // default on
    defaultChatBot: defaultChatBot === 'on', // default off (false)
    chatInstruction: chatInstruction || DEFAULT_CHAT_AI_INSTRUCTION,
    chatPersona: (chatPersona as 'sales_pro' | 'consultative' | 'fast' | 'custom') || 'sales_pro',
  };
}

/** ทดสอบว่า Gemini API Key ใช้งานได้จริงไหม */
export async function testGeminiApiKey(apiKeyOverride?: string, requestedModel?: string): Promise<{ ok: boolean; message_th: string; model: string }> {
  const apiKey = apiKeyOverride || (await getGeminiApiKey());
  if (!apiKey) {
    return { ok: false, message_th: 'ยังไม่ได้ใส่ Gemini API Key', model: '' };
  }

  const candidateModels = [
    requestedModel,
    'gemini-3.6-flash',
    'gemini-3.7-flash',
    'gemini-3.5-flash-lite',
    'gemini-2.5-flash',
  ].filter((m): m is string => Boolean(m && m.trim()));

  let lastErrMsg = '';
  for (const rawModel of candidateModels) {
    const model = rawModel.replace(/^models\//, '');
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'ตอบสั้นๆ เพียง 1 คำ: สบายดี' }] }],
            generationConfig: { maxOutputTokens: 10 },
          }),
          cache: 'no-store',
        },
      );

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        lastErrMsg = errJson?.error?.message || `HTTP ${res.status}`;
        continue;
      }

      const data = await res.json();
      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (reply) {
        return { ok: true, message_th: `เชื่อมต่อ Google Gemini สำเร็จ! (ทดสอบผ่านโมเดล ${model})`, model };
      }
    } catch (err) {
      lastErrMsg = err instanceof Error ? err.message : String(err);
    }
  }

  return { ok: false, message_th: `เชื่อมต่อ Gemini ไม่สำเร็จ: ${lastErrMsg}`, model: candidateModels[0] || 'gemini-3.6-flash' };
}

/** ทดสอบการตอบของบอทใน Playground / แชท Simulator */
export async function testAiPlayground(input: {
  userMessage: string;
  systemPrompt?: string;
  knowledgeBase?: string;
  model?: string;
  temperature?: number;
}): Promise<string> {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    throw new Error('กรุณาบันทึก GEMINI_API_KEY ก่อนทดสอบ');
  }

  const aiSettings = await getAiSettings();
  const model = (input.model || aiSettings.model || 'gemini-3.6-flash').replace(/^models\//, '');
  const temperature = input.temperature ?? aiSettings.temperature ?? 0.7;

  // 1. นำชุดคำสั่งสอนเทรน AI ประจำแชทมาใช้
  const baseInstruction = input.systemPrompt || aiSettings.chatInstruction || DEFAULT_CHAT_AI_INSTRUCTION;

  // 2. ดึงข้อมูลสินค้าและโปรโมชั่นจริงในร้านอัตโนมัติ
  const [products, promotions] = await Promise.all([
    listProducts(true).catch(() => []),
    listPromotions(true).catch(() => []),
  ]);

  let catalogContext = '';
  if (promotions.length > 0) {
    catalogContext += '\n[โปรโมชั่นพิเศษที่กำลังจัดอยู่จริงของทางร้าน]:\n';
    for (const promo of promotions.slice(0, 5)) {
      catalogContext += `• 🎁 ${promo.name}\n`;
    }
  }
  if (products.length > 0) {
    catalogContext += '\n[รายการสินค้าพร้อมส่งจริงของทางร้าน]:\n';
    for (const p of products.slice(0, 10)) {
      const priceStr = p.price > 0 ? ` ราคา ${p.price.toLocaleString('th-TH')} บาท` : '';
      const varStr = p.variant ? ` (${p.variant})` : '';
      catalogContext += `• ${p.name}${varStr}${priceStr}\n`;
    }
  }

  // 3. ดึงคลังความรู้ร้านค้า
  const knowledge = (input.knowledgeBase ?? aiSettings.knowledge)?.trim();
  let knowledgeContext = '';
  if (knowledge) {
    knowledgeContext = `\n\n[คลังความรู้ ข้อมูลร้านค้า และนโยบาย]:\n${knowledge}`;
  }

  const fullPrompt = `${baseInstruction}
${catalogContext}${knowledgeContext}

ข้อความของลูกค้าที่ทักเข้ามาในแชท: "${input.userMessage}"
คำสั่ง: ในฐานะแอดมินนักขาย จงเขียนข้อความตอบกลับลูกค้า โดยใช้คำลงท้าย "ค่ะ/นะคะ" อย่างสุภาพ อ่อนหวาน แจ้งโปรโมชั่นที่มี และพยายามปิดการขายทันที:`;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: fullPrompt }],
      },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens: 600,
    },
  };

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
    throw new Error(`Gemini API ผิดพลาด: ${errJson?.error?.message || `HTTP ${res.status}`}`);
  }

  const data = await res.json();
  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!reply) throw new Error('AI ไม่ได้สร้างคำตอบกลับมา');
  return reply;
}

export type CommentReplyContext = {
  fromName?: string | null;
  postTitle?: string | null;
  mode?: 'public' | 'private';
  instruction?: string | null;
};

/**
 * ให้ Google Gemini ช่วยคิดข้อความตอบกลับคอมเมนต์ลูกค้า
 */
export async function generateCommentReply(
  commentText: string,
  context: CommentReplyContext = {},
): Promise<string> {
  const aiSettings = await getAiSettings();
  const apiKey = aiSettings.apiKey;
  if (!apiKey) {
    throw new Error('ยังไม่ได้ตั้งค่า GEMINI_API_KEY — ไปที่ ตั้งค่า → AI & บอทเทรน เพื่อใส่คีย์');
  }

  const { fromName, postTitle, mode = 'public', instruction } = context;

  let systemInstruction = aiSettings.systemPrompt;
  if (!systemInstruction) {
    systemInstruction = mode === 'public'
      ? `คุณคือแอดมินเพจร้านค้าออนไลน์ของไทยที่สุภาพ เป็นมิตร และมืออาชีพ
หน้าที่ของคุณคือเขียนคำตอบสำหรับคอมเมนต์ใต้โพสต์ Facebook/IG ของลูกค้า
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
  }

  if (instruction?.trim()) {
    systemInstruction += `\n\n[สไตล์และคำสั่งพิเศษในการตอบ]:\n${instruction.trim()}`;
  }

  if (aiSettings.knowledge) {
    systemInstruction += `\n\n[ข้อมูลร้านค้าและสินค้าสำหรับอ้างอิง]:\n${aiSettings.knowledge}`;
  }

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
      temperature: aiSettings.temperature,
      maxOutputTokens: 300,
    },
  };

  const models = [aiSettings.model, 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.5-flash-lite'];
  const uniqueModels = [...new Set(models.filter(Boolean).map((m) => m.replace(/^models\//, '')))];
  let lastError: Error | null = null;

  for (const model of uniqueModels) {
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
