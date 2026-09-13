import 'server-only';
import { db } from '@/lib/supabase/admin';
import type { PublicAdmin } from '@/types/db';
import { deleteRuntimeSetting, getRuntimeSetting, saveRuntimeSetting } from '@/server/settings/service';
import { getAiSettings } from './gemini';
import {
  type AiCategory,
  DEFAULT_ASSIST_CATEGORIES,
  DEFAULT_RELATION_CATEGORIES,
} from '@/types/ai-assist';

export type { AiCategory };
export { DEFAULT_ASSIST_CATEGORIES, DEFAULT_RELATION_CATEGORIES };

export async function getAssistCategories(): Promise<AiCategory[]> {
  try {
    const raw = await getRuntimeSetting('AI_ASSIST_CATEGORIES');
    if (!raw) return DEFAULT_ASSIST_CATEGORIES;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as AiCategory[];
    }
    return DEFAULT_ASSIST_CATEGORIES;
  } catch {
    return DEFAULT_ASSIST_CATEGORIES;
  }
}

export async function saveAssistCategories(admin: PublicAdmin, categories: AiCategory[]): Promise<void> {
  await saveRuntimeSetting(admin, 'AI_ASSIST_CATEGORIES', JSON.stringify(categories));
}

export async function getRelationCategories(): Promise<AiCategory[]> {
  try {
    const raw = await getRuntimeSetting('AI_RELATION_CATEGORIES');
    if (!raw) return DEFAULT_RELATION_CATEGORIES;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as AiCategory[];
    }
    return DEFAULT_RELATION_CATEGORIES;
  } catch {
    return DEFAULT_RELATION_CATEGORIES;
  }
}

export async function saveRelationCategories(admin: PublicAdmin, categories: AiCategory[]): Promise<void> {
  await saveRuntimeSetting(admin, 'AI_RELATION_CATEGORIES', JSON.stringify(categories));
}

export async function getGlobalAssistPrompt(): Promise<string> {
  const p = await getRuntimeSetting('AI_ASSIST_GLOBAL_PROMPT');
  return p?.trim() || '';
}

export async function saveGlobalAssistPrompt(admin: PublicAdmin, prompt: string): Promise<void> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    await deleteRuntimeSetting(admin, 'AI_ASSIST_GLOBAL_PROMPT');
  } else {
    await saveRuntimeSetting(admin, 'AI_ASSIST_GLOBAL_PROMPT', trimmed);
  }
}

export type GenerateDraftParams = {
  mode: 'reply' | 'relationship';
  conversationId: string;
  categoryId?: string;
  customerMessage?: string;
  customerName?: string;
  customInstruction?: string;
};

/**
 * ฟังก์ชันหลักในการเรียก Gemini AI เพื่อร่างคำตอบหรือข้อความสัมพันธ์
 */
export async function generateAiDraft(params: GenerateDraftParams): Promise<{ reply: string; categoryName: string }> {
  const { mode, conversationId, categoryId, customInstruction } = params;
  const aiSettings = await getAiSettings();
  const apiKey = aiSettings.apiKey;
  if (!apiKey) {
    throw new Error('ยังไม่ได้ตั้งค่า GEMINI_API_KEY — กรุณาไปที่ ตั้งค่า → AI & บอทเทรน เพื่อใส่ API Key');
  }

  const model = aiSettings.model || 'gemini-2.5-flash';
  const temperature = aiSettings.temperature ?? 0.7;
  const globalPrompt = await getGlobalAssistPrompt();

  // 1. ดึงข้อมูลสินค้าและโปรโมชั่นจริงจากฐานข้อมูล
  const [{ data: activeProducts }, { data: activePromos }, { data: convData }] = await Promise.all([
    db().from('products').select('name, price_satang, variants(name, price_satang)').eq('is_active', true).limit(10),
    db().from('promotions').select('name, description, discount_satang, free_shipping, is_active').eq('is_active', true).limit(5),
    db().from('conversations').select('username, display_name, notes').eq('id', conversationId).maybeSingle(),
  ]);

  let catalogContext = '';
  if (activePromos && activePromos.length > 0) {
    catalogContext += '\n[โปรโมชั่นพิเศษที่กำลังจัดอยู่]:\n';
    for (const pr of activePromos) {
      catalogContext += `• ${pr.name}${pr.description ? `: ${pr.description}` : ''}${pr.free_shipping ? ' (ส่งฟรี)' : ''}\n`;
    }
  }

  if (activeProducts && activeProducts.length > 0) {
    catalogContext += '\n[รายการสินค้าพร้อมส่งจริง]:\n';
    for (const p of activeProducts) {
      const priceStr = p.price_satang ? ` ${p.price_satang / 100} บาท` : '';
      catalogContext += `• ${p.name}${priceStr}\n`;
    }
  }

  const knowledge = aiSettings.knowledge?.trim()
    ? `\n\n[คลังความรู้และข้อมูลร้านค้า]:\n${aiSettings.knowledge.trim()}`
    : '';

  let categoryName = 'AI ช่วยคิด';
  let categoryPrompt = '';

  if (mode === 'reply') {
    const categories = await getAssistCategories();
    const cat = categories.find((c) => c.id === categoryId) || categories[0];
    categoryName = cat?.name ?? 'ตอบแชททั่วไป';
    categoryPrompt = cat?.prompt ?? '';

    // ดึงข้อความลูกค้า: หากไม่ได้ส่งมา ให้ดึงข้อความขาเข้าล่าสุดจาก DB (direction === 'in' เท่านั้น)
    let userMsg = params.customerMessage?.trim();
    if (!userMsg) {
      const { data: latestMsg } = await db()
        .from('messages')
        .select('text')
        .eq('conversation_id', conversationId)
        .eq('direction', 'in')
        .not('text', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      userMsg = latestMsg?.text?.trim() || '';
    }

    if (!userMsg) {
      throw new Error('ไม่พบข้อความจากลูกค้าในห้องแชทนี้เพื่อให้ AI ช่วยคิด');
    }

    const systemInstruction = `คุณคือแอดมินนักขายมืออาชีพของร้านค้าออนไลน์ไทยที่สุภาพ อ่อนหวาน เป็นมิตร และเชี่ยวชาญการปิดการขาย
หน้าที่ของคุณคือร่างข้อความตอบกลับลูกค้าตามหมวดหมู่และแนวทางที่กำหนด
กฎสำคัญ:
1. ตอบด้วยภาษาไทยที่สุภาพ เป็นกันเอง น่ารัก ใช้คำลงท้าย "ค่ะ" หรือ "นะคะ" เสมอ
2. ยึดข้อมูลสินค้า โปรโมชั่น และราคาสินค้าจริงจากรายการด้านล่าง ห้ามแต่งราคาหรือข้อมูลเอง
3. หากมีโปรโมชั่น ให้หยิบยกมาแนะนำอย่างแนบเนียนและกระตุ้นการสั่งซื้อ
4. ร่างข้อความให้กระชับ ชัดเจน น่าอ่าน ไม่ยาวจนน่าเบื่อ

[หมวดหมู่คำตอบ]: ${categoryName}
[แนวทางการตอบของหมวดนี้]: ${categoryPrompt}${customInstruction ? `\n[คำสั่งพิเศษเพิ่มเติม]: ${customInstruction}` : ''}
${globalPrompt ? `\n[คำสั่งสอนรวม]: ${globalPrompt}` : ''}
${catalogContext}${knowledge}`;

    const prompt = `${systemInstruction}

ข้อความล่าสุดของลูกค้า: "${userMsg}"
คำสั่ง: จงเขียนร่างข้อความตอบกลับลูกค้าตามแนวทางของหมวดหมู่นี้ เพื่อให้แอดมินนำไปส่งได้ทันที:`;

    const reply = await callGemini(apiKey, model, temperature, prompt);
    return { reply, categoryName };
  } else {
    // Relationship / Follow-up mode
    const categories = await getRelationCategories();
    const cat = categories.find((c) => c.id === categoryId) || categories[0];
    categoryName = cat?.name ?? 'สานสัมพันธ์ลูกค้า';
    categoryPrompt = cat?.prompt ?? '';

    const customerName = params.customerName || convData?.display_name || convData?.username || 'ลูกค้า';

    const systemInstruction = `คุณคือแอดมินร้านค้าออนไลน์ไทยที่สุภาพ อ่อนหวาน เอาใจใส่ และจริงใจกับลูกค้าทุกคน
หน้าที่ของคุณคือร่างข้อความสร้างความสัมพันธ์ ติดตามผล หรือทักทายลูกค้าประจำ
กฎสำคัญ:
1. ทักทายลูกค้าด้วยความอบอุ่นและสุภาพ โดยเรียกชื่อลูกค้า ("คุณ${customerName}")
2. ใช้ภาษาไทยธรรมชาติ ไพเราะ ใช้คำลงท้าย "ค่ะ" หรือ "นะคะ" อย่างน่ารัก
3. ตรงตามหมวดหมู่ที่ได้รับมอบหมาย ไม่ขายของจนน่าอึดอัด แต่ทำให้ลูกค้ารู้สึกเป็นคนพิเศษ
4. ความยาวพอเหมาะ 2-3 ประโยค กระชับและน่าประทับใจ

[หมวดหมู่ข้อความ]: ${categoryName}
[แนวทางการเขียน]: ${categoryPrompt}${customInstruction ? `\n[คำสั่งพิเศษเพิ่มเติม]: ${customInstruction}` : ''}
${globalPrompt ? `\n[คำสั่งสอนรวม]: ${globalPrompt}` : ''}
${catalogContext}${knowledge}`;

    const prompt = `${systemInstruction}

ชื่อลูกค้าที่จะส่งหา: "${customerName}"
${convData?.notes ? `ข้อมูล/บันทึกเกี่ยวกับลูกค้า: "${convData.notes}"` : ''}
คำสั่ง: จงเขียนข้อความทักทายหรือสานสัมพันธ์ตามแนวทางของหมวดหมู่นี้ เพื่อให้แอดมินนำไปส่งหาลูกค้าได้ทันที:`;

    const reply = await callGemini(apiKey, model, temperature, prompt);
    return { reply, categoryName };
  }
}

async function callGemini(apiKey: string, model: string, temperature: number, prompt: string): Promise<string> {
  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, maxOutputTokens: 600 },
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
  if (!reply) throw new Error('AI ไม่ได้สร้างข้อความกลับมา');
  return reply;
}
