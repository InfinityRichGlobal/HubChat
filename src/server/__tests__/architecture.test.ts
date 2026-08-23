/**
 * ชุดทดสอบสถาปัตยกรรม — กันไม่ให้ใครข้าม Policy Engine ได้
 * ===========================================================================
 * ชุดนี้ไม่ได้ทดสอบ "โค้ดทำงานถูกไหม" แต่ทดสอบ "โค้ดถูกวางที่ถูกที่ไหม"
 *
 * ทำไมต้องมี :
 *   กฎอย่าง "ห้ามเรียก Meta ตรง ๆ" เป็นกฎที่คนลืมได้ง่ายมากตอนรีบ
 *   ถ้าอาศัยแค่ความจำหรือ code review วันหนึ่งจะมีคนเผลอ
 *   เขียนเป็นเทสต์ = เผลอเมื่อไหร่ CI แดงทันที ไม่ต้องพึ่งความจำใคร
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const ALL_FILES = walk(SRC);
const rel = (f: string) => path.relative(SRC, f).replace(/\\/g, '/');

/** ไฟล์โค้ดจริง (ไม่นับชุดทดสอบ) */
const CODE_FILES = ALL_FILES.filter((f) => !rel(f).includes('__tests__'));

/**
 * อ่านไฟล์แบบ "ตัดคอมเมนต์ทิ้ง" ก่อนตรวจ
 * เพราะในโค้ดมีคอมเมนต์ที่ตั้งใจพูดถึงของต้องห้าม เช่น
 * "ห้ามใช้ POST_PURCHASE_UPDATE" — นั่นคือเอกสาร ไม่ใช่การใช้งาน
 * เราต้องจับเฉพาะ "การใช้จริง" เท่านั้น
 *
 * ตัดเฉพาะบล็อกคอมเมนต์กับบรรทัดที่ขึ้นต้นด้วย // หรือ *
 * (ไม่ตัด // ที่อยู่กลางบรรทัด เพราะจะไปทำลาย URL ที่อยู่ในสตริง)
 */
function read(f: string): string {
  return readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*');
    })
    .join('\n');
}

/* ================================================================== */
describe('🔴 ห้ามเรียก Meta Graph API จากที่อื่นนอกจาก client กลาง', () => {
  it('graph.facebook.com ปรากฏได้เฉพาะใน src/server/meta/client.ts', () => {
    const offenders = CODE_FILES.filter(
      (f) => read(f).includes('graph.facebook.com') && rel(f) !== 'server/meta/client.ts',
    ).map(rel);
    expect(offenders).toEqual([]);
  });

  it('ไม่มี fetch ไป Meta จากหน้าเว็บหรือ API route', () => {
    const appFiles = CODE_FILES.filter((f) => rel(f).startsWith('app/'));
    const offenders = appFiles.filter((f) => /graph\.facebook|fbgraph|facebook\.com\/v\d/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});

/* ================================================================== */
describe('🔴 ห้ามข้าม Policy Engine ไปเรียก transport ตรง ๆ', () => {
  it('ไฟล์ที่ import transports ได้ มีแค่ใน server/transports และ server/messaging', () => {
    const offenders = CODE_FILES.filter((f) => {
      const r = rel(f);
      if (r.startsWith('server/transports/') || r.startsWith('server/messaging/')) return false;
      // API route ที่ใช้ transportChannelSupport() เพื่ออ่านอย่างเดียว ยอมให้ได้
      const src = read(f);
      if (!src.includes('@/server/transports')) return false;
      return !src.includes('transportChannelSupport');
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it('หน้าเว็บและ API route ห้าม import adapter รายตัว', () => {
    const offenders = CODE_FILES.filter((f) => {
      if (!rel(f).startsWith('app/')) return false;
      return /@\/server\/transports\/(standard|human-agent|utility|marketing|base)/.test(read(f));
    }).map(rel);
    expect(offenders).toEqual([]);
  });
});

/* ================================================================== */
describe('🔴 ห้ามฝังกฎเวลาของ Meta ไว้นอก policy config', () => {
  it('ไม่มีการเทียบ 24 ชั่วโมง / 7 วัน แบบ hardcode นอก server/policy', () => {
    const suspicious = /(24\s*\*\s*60\s*\*\s*60|86400000|86_400_000|7\s*\*\s*24\s*\*\s*60|604800000)/;
    const offenders = CODE_FILES.filter((f) => {
      const r = rel(f);
      if (r.startsWith('server/policy/')) return false;
      return suspicious.test(read(f));
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it('ชื่อ transport ปรากฏใน UI ได้เฉพาะเป็นป้ายอ่านอย่างเดียว ไม่ใช่ตัวเลือก', () => {
    const uiFiles = CODE_FILES.filter((f) => rel(f).startsWith('app/') || rel(f).startsWith('components/'));
    const offenders = uiFiles.filter((f) => /'HUMAN_AGENT'|"HUMAN_AGENT"/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});

/* ================================================================== */
describe('🔴 ห้ามใช้ message tag แบบเก่าที่ Meta กำลังเลิกรองรับ', () => {
  const LEGACY_TAGS = [
    'POST_PURCHASE_UPDATE',
    'ACCOUNT_UPDATE',
    'CONFIRMED_EVENT_UPDATE',
    'NON_PROMOTIONAL_SUBSCRIPTION',
  ];

  for (const tag of LEGACY_TAGS) {
    it(`ไม่มี ${tag} อยู่ในโค้ดเลย`, () => {
      const offenders = CODE_FILES.filter((f) => read(f).includes(tag)).map(rel);
      expect(offenders).toEqual([]);
    });
  }
});

/* ================================================================== */
describe('🔴 ความลับต้องอยู่ฝั่งเซิร์ฟเวอร์เท่านั้น', () => {
  it("ไฟล์ที่มี 'use client' ห้ามแตะ serverEnv / service role key / token ของเพจ", () => {
    const clientFiles = CODE_FILES.filter((f) => read(f).slice(0, 200).includes("'use client'"));
    const offenders = clientFiles
      .filter((f) => {
        const src = read(f);
        return (
          src.includes('serverEnv') ||
          src.includes('SUPABASE_SERVICE_ROLE_KEY') ||
          src.includes('ENCRYPTION_KEY') ||
          src.includes('decryptSecret') ||
          src.includes('SESSION_SECRET')
        );
      })
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('ไม่มีค่า secret เขียนตายอยู่ในโค้ด', () => {
    // token ของ Meta ขึ้นต้นด้วย EAA / service role key ของ Supabase เป็น JWT ขึ้นต้น eyJ
    const offenders = CODE_FILES.filter((f) => /['"](EAA[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{30,})['"]/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('ไฟล์ฝั่งเซิร์ฟเวอร์ที่แตะความลับต้องประกาศ server-only', () => {
    const mustBeServerOnly = [
      'lib/crypto.ts',
      'lib/supabase/admin.ts',
      'server/meta/client.ts',
      'server/messaging/send-message.ts',
      'server/transports/registry.ts',
    ];
    for (const target of mustBeServerOnly) {
      const file = CODE_FILES.find((f) => rel(f) === target);
      expect(file, `ไม่พบไฟล์ ${target}`).toBeDefined();
      expect(read(file!), `${target} ต้องมี import 'server-only'`).toContain("import 'server-only'");
    }
  });
});

/* ================================================================== */
describe('🔴 ห้ามเดา message_type จากเนื้อข้อความ', () => {
  it('ไม่มี regex ที่พยายามเดาว่าข้อความเป็นการขายหรือไม่', () => {
    const suspicious = /(isMarketing|looksLikePromo|detectMessageType|guessMessageType|classifyMessage)/;
    const offenders = CODE_FILES.filter((f) => suspicious.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});

/* ================================================================== */
describe('adapter ต้องตรงกับตารางที่ engine ใช้ตัดสิน', () => {
  it('DEFAULT_CHANNEL_SUPPORT ตรงกับ channels ที่ adapter ประกาศไว้จริง', async () => {
    const { DEFAULT_CHANNEL_SUPPORT } = await import('@/server/policy/engine');
    const { standardAdapter } = await import('@/server/transports/standard');
    const { humanAgentAdapter } = await import('@/server/transports/human-agent');
    const { utilityAdapter } = await import('@/server/transports/utility');
    const { marketingAdapter } = await import('@/server/transports/marketing');

    expect(standardAdapter.channels).toEqual(DEFAULT_CHANNEL_SUPPORT.STANDARD);
    expect(humanAgentAdapter.channels).toEqual(DEFAULT_CHANNEL_SUPPORT.HUMAN_AGENT);
    expect(utilityAdapter.channels).toEqual(DEFAULT_CHANNEL_SUPPORT.UTILITY);
    expect(marketingAdapter.channels).toEqual(DEFAULT_CHANNEL_SUPPORT.MARKETING);
  });

  it('adapter ทุกตัวมีหน้าตาเหมือนกันครบทุกเมธอด', async () => {
    const { allAdapters } = await import('@/server/transports/registry');
    for (const a of allAdapters()) {
      expect(typeof a.enabled).toBe('function');
      expect(typeof a.isEligible).toBe('function');
      expect(typeof a.build).toBe('function');
      expect(typeof a.send).toBe('function');
    }
  });
});


/* ================================================================== */
/* รอบ 2.1 — ลดช่องทางที่จะข้าม sendMessage() ได้                        */
/* ================================================================== */
describe('🔴 sendMessage() ต้องเป็นทางเข้าเดียวของการส่งข้อความ', () => {
  /** โฟลเดอร์ที่มีสิทธิ์แตะ Meta client / adapter ได้จริง */
  const META_ALLOWED = ['server/meta/', 'server/transports/base.ts'];
  const ADAPTER_ALLOWED = ['server/transports/', 'server/messaging/'];

  it('โค้ดฝั่งฟีเจอร์ (app / components / lib) ห้ามแตะ Meta client เลย', () => {
    const featureFiles = CODE_FILES.filter((f) => {
      const r = rel(f);
      return r.startsWith('app/') || r.startsWith('components/') || r.startsWith('lib/');
    });
    const offenders = featureFiles.filter((f) => read(f).includes('@/server/meta/')).map(rel);
    expect(offenders).toEqual([]);
  });

  it('ไฟล์ที่ import Meta client แบบไม่ใช่ชนิดข้อมูล ต้องอยู่ในรายชื่อที่อนุญาต', () => {
    const offenders = CODE_FILES.filter((f) => {
      const r = rel(f);
      if (META_ALLOWED.some((a) => r.startsWith(a))) return false;
      const src = read(f);
      // อนุญาตเฉพาะ `import type { ... } from '@/server/meta/client'`
      const nonTypeImport = /^import\s+(?!type\s)[^;]*from\s+['"]@\/server\/meta\/client['"]/m;
      return nonTypeImport.test(src);
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it('หยิบ adapter มาใช้เองได้เฉพาะใน transports และ messaging', () => {
    const offenders = CODE_FILES.filter((f) => {
      const r = rel(f);
      if (ADAPTER_ALLOWED.some((a) => r.startsWith(a))) return false;
      return /\bgetAdapter\b|\ballAdapters\b/.test(read(f));
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it('เรียก sendToMeta() ได้เฉพาะใน transports/base.ts', () => {
    const offenders = CODE_FILES.filter((f) => {
      const r = rel(f);
      if (r.startsWith('server/meta/') || r === 'server/transports/base.ts') return false;
      return /\bsendToMeta\b/.test(read(f));
    }).map(rel);
    expect(offenders).toEqual([]);
  });
});

/* ================================================================== */
describe('🔴 ห้ามเชื่อคำอ้างว่า "เป็นคนพิมพ์เอง" จากผู้เรียก', () => {
  it('ไม่มีฟิลด์ human_typed ที่ผู้เรียกกำหนดเองหลงเหลืออยู่ในสัญญาของ engine', () => {
    const types = CODE_FILES.find((f) => rel(f) === 'server/policy/types.ts');
    expect(types).toBeDefined();
    // ต้องไม่มีฟิลด์ human_typed ใน SendContext อีกแล้ว (ถูกแทนด้วย provenance)
    expect(read(types!)).not.toMatch(/^\s*human_typed\s*:/m);
  });

  it('สร้าง provenance ได้จากไฟล์เดียวเท่านั้น', () => {
    const offenders = CODE_FILES.filter((f) => {
      const r = rel(f);
      if (r === 'server/messaging/provenance.ts') return false;
      return /human_authored\s*:\s*true/.test(read(f));
    })
      .map(rel)
      // หน้าตรวจสถานะสร้างบริบทจำลองเพื่อ "ลองถาม" เท่านั้น ส่งจริงไม่ได้ (ไม่มีตราประทับ)
      .filter((r) => r !== 'app/api/policy/preview/route.ts');
    expect(offenders).toEqual([]);
  });
});

/* ================================================================== */
describe('🔴 คำตอบของ Meta ห้ามไปแก้ประวัติข้อความจริง', () => {
  it('ไม่มีโค้ดที่เขียนทับ last_customer_message_at นอกเส้นทางรับข้อความเข้า', () => {
    const offenders = CODE_FILES.filter((f) => {
      const src = read(f);
      // จับรูปแบบ update ... last_customer_message_at
      return /update\([^)]*last_customer_message_at/.test(src.replace(/\n/g, ' '));
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it('ชั้นบันทึกข้อสังเกตต้องไม่แตะตาราง conversations / customers', () => {
    const store = CODE_FILES.find((f) => rel(f) === 'server/messaging/store.ts');
    expect(store).toBeDefined();
    const src = read(store!);
    const observationBlock = src.slice(src.indexOf('recordPolicyObservation'));
    expect(observationBlock).not.toContain("from('conversations')");
    expect(observationBlock).not.toContain("from('customers')");
  });
});
