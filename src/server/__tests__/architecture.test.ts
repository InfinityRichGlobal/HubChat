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

/* ================================================================== */
/* รอบ 3A — ทางเข้าข้อมูล (webhook)                                     */
/* ================================================================== */
describe('🔴 ประตูรับ webhook ต้องปลอดภัยและตอบเร็ว', () => {
  const WEBHOOK_ROUTE = 'app/api/webhooks/meta/route.ts';

  function webhookSource(): string {
    const file = CODE_FILES.find((f) => rel(f) === WEBHOOK_ROUTE);
    expect(file, `ไม่พบไฟล์ ${WEBHOOK_ROUTE}`).toBeDefined();
    return read(file!);
  }

  it('ต้องอ่านเนื้อคำขอเป็นข้อความดิบ ห้ามใช้ req.json()', () => {
    const src = webhookSource();
    // ลายเซ็นคำนวณจากตัวอักษรดิบ ถ้า parse ก่อนแล้ว stringify ใหม่ ลายเซ็นจะไม่มีวันตรง
    expect(src).toMatch(/\.text\(\)/);
    expect(src).not.toMatch(/req\.json\(\)/);
  });

  it('ต้องตรวจลายเซ็น "ก่อน" วางงานลงคิวเสมอ', () => {
    // ต้องดูเฉพาะ "เนื้อในฟังก์ชัน POST" ไม่ใช่ลำดับบรรทัด import ด้านบนไฟล์
    const src = webhookSource();
    const body = src.slice(src.indexOf('export async function POST'));
    const verifyAt = body.indexOf('verifyMetaSignature');
    const enqueueAt = body.indexOf('enqueueWebhook');
    expect(verifyAt, 'ไม่พบการตรวจลายเซ็นในไฟล์ webhook').toBeGreaterThan(-1);
    expect(enqueueAt, 'ไม่พบการวางงานลงคิว').toBeGreaterThan(-1);
    expect(verifyAt).toBeLessThan(enqueueAt);
  });

  it('ห้ามประมวลผลข้อความก่อนตอบ Meta (สเปกหัวข้อ 6.3)', () => {
    const src = webhookSource();
    // ยอมให้เรียก processWebhookBatch ได้เฉพาะข้างใน after() เท่านั้น
    if (src.includes('processWebhookBatch')) {
      expect(src, 'ต้องเรียกผ่าน after() เท่านั้น').toMatch(/after\(/);
      const afterAt = src.indexOf('after(');
      const processAt = src.indexOf('processWebhookBatch(');
      expect(afterAt).toBeLessThan(processAt);
    }
  });

  it('ห้ามตอบรายละเอียดภายในกลับไปให้คนที่ยิงเข้ามา', () => {
    const src = webhookSource();
    // ข้อความ error ภาษาไทยของเราต้องอยู่ใน log ไม่ใช่ใน response
    expect(src).not.toMatch(/new Response\([^)]*message_th/);
  });
});

/* ================================================================== */
describe('🔴 ทางเข้าข้อมูลห้ามกลายเป็นทางลัดในการส่งข้อความ', () => {
  const ingestFiles = CODE_FILES.filter((f) => rel(f).startsWith('server/ingest/'));

  it('มีไฟล์ในโฟลเดอร์ ingest ให้ตรวจจริง', () => {
    expect(ingestFiles.length).toBeGreaterThan(0);
  });

  it('ingest ห้าม import transport adapter หรือ registry', () => {
    const offenders = ingestFiles.filter((f) => /@\/server\/transports\//.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('ingest แตะ Meta client ได้เฉพาะเป็นชนิดข้อมูล — ของจริงต้องผ่าน server/meta เท่านั้น', () => {
    const nonTypeImport = /^import\s+(?!type\s)[^;]*from\s+['"]@\/server\/meta\/client['"]/m;
    const offenders = ingestFiles.filter((f) => nonTypeImport.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});

/* ================================================================== */
describe('🔴 access token ของเพจห้ามหลุดออกไปฝั่งหน้าเว็บ', () => {
  it('API เกี่ยวกับเพจ ห้ามแตะตาราง pages เอง ต้องผ่านชั้นบริการที่ตัด token ออกแล้ว', () => {
    const pageApis = CODE_FILES.filter((f) => rel(f).startsWith('app/api/pages/'));
    expect(pageApis.length).toBeGreaterThan(0);
    // ถ้า route ไป query ตาราง pages เอง วันหนึ่งจะมีคนเผลอ select('*') แล้ว token หลุด
    const offenders = pageApis.filter((f) => /from\(['"]pages['"]\)/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('ชั้นบริการเพจต้องมีตัวตัด token ออกก่อนส่งกลับ', () => {
    const service = CODE_FILES.find((f) => rel(f) === 'server/pages/service.ts');
    expect(service, 'ไม่พบ server/pages/service.ts').toBeDefined();
    const src = read(service!);
    // ชนิดข้อมูลที่ส่งออก (SafePage) ต้องไม่มีช่อง access_token
    const safeType = src.slice(src.indexOf('export type SafePage'), src.indexOf('};', src.indexOf('export type SafePage')));
    expect(safeType).not.toContain('access_token');
    // และต้องเข้ารหัสก่อนเก็บเสมอ
    expect(src).toContain('encryptSecret');
  });

  it('หน้าเว็บฝั่งเบราว์เซอร์ต้องไม่มีคำว่า access_token ในชนิดข้อมูลที่รับมา', () => {
    const clientFiles = CODE_FILES.filter((f) => read(f).slice(0, 200).includes("'use client'"));
    const offenders = clientFiles
      .filter((f) => /access_token\s*:/.test(read(f)))
      .map(rel)
      // ช่องกรอกในฟอร์มชื่อ access_token ได้ (ส่งขึ้นอย่างเดียว ไม่ได้รับกลับ)
      .filter((r) => !r.endsWith('pages-client.tsx'));
    expect(offenders).toEqual([]);
  });
});

/* ================================================================== */
/* รอบ 3B — หน้าแชท                                                    */
/* ================================================================== */
describe('🔴 หน้าแชทต้องมี "ปุ่มส่งปุ่มเดียว" เท่านั้น', () => {
  const REPLY_ROUTE = 'app/api/conversations/[id]/reply/route.ts';

  it('route ตอบแชทต้องไม่รับ transport / tag จากหน้าเว็บ', () => {
    const file = CODE_FILES.find((f) => rel(f) === REPLY_ROUTE);
    expect(file, `ไม่พบไฟล์ ${REPLY_ROUTE}`).toBeDefined();
    const src = read(file!);
    // ถ้าวันหนึ่งมีคนเพิ่มช่องพวกนี้เข้าไปใน schema แอดมินจะเลือกช่องทางเองได้ทันที
    expect(src).not.toMatch(/transport\s*:/);
    expect(src).not.toMatch(/message_tag/);
    expect(src).not.toMatch(/messaging_type/);
  });

  it('route ตอบแชทต้องสร้างตราประทับจาก session ไม่ใช่รับมาจาก body', () => {
    const file = CODE_FILES.find((f) => rel(f) === REPLY_ROUTE);
    const src = read(file!);
    expect(src).toContain('humanAdminReply');
    // ห้ามรับ provenance หรือ admin_id มาจากผู้เรียก
    expect(src).not.toMatch(/provenance\s*:\s*(z\.|body\.)/);
    expect(src).not.toMatch(/admin_id\s*:\s*(z\.|body\.)/);
  });

  it('route ตอบแชทต้องส่งเฉพาะ conversation_id ที่มาจาก URL ไม่ใช่จาก body', () => {
    const file = CODE_FILES.find((f) => rel(f) === REPLY_ROUTE);
    const src = read(file!);
    expect(src).not.toMatch(/conversation_id\s*:\s*body\./);
    expect(src).not.toMatch(/customer_id|page_id|psid/);
  });
});

/* ================================================================== */
describe('🔴 ชั้นข้อมูลอินบ็อกซ์ต้องไม่เผลอดึง token ของเพจออกมา', () => {
  it("ไม่มี select('*') ในชั้นข้อมูลอินบ็อกซ์", () => {
    const files = CODE_FILES.filter((f) => rel(f).startsWith('server/inbox/'));
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) => /\.select\(\s*['"]\*['"]\s*\)/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('ไม่มีการเลือกคอลัมน์ access_token ในชั้นข้อมูลอินบ็อกซ์', () => {
    const files = CODE_FILES.filter((f) => rel(f).startsWith('server/inbox/'));
    const offenders = files.filter((f) => read(f).includes('access_token')).map(rel);
    expect(offenders).toEqual([]);
  });
});

/* ================================================================== */
/* รอบ 4 — เครื่องมือแอดมิน                                             */
/* ================================================================== */
describe('🔴 เครื่องมือแอดมินต้องไม่กลายเป็นการตอบอัตโนมัติ', () => {
  const contentFiles = CODE_FILES.filter((f) => rel(f).startsWith('server/content/'));

  it('มีไฟล์ในโฟลเดอร์ content ให้ตรวจจริง', () => {
    expect(contentFiles.length).toBeGreaterThan(0);
  });

  it('ชั้นชุดคำตอบ/แท็ก ห้ามเรียก sendMessage หรือแตะ Meta เลย', () => {
    // ชุดคำตอบคือ "ข้อความสำเร็จรูปที่วางในช่องพิมพ์" ไม่ใช่การตอบอัตโนมัติ
    // ถ้าวันหนึ่งมีคนต่อสายส่งเข้ามาตรงนี้ = ระบบส่งข้อความเองโดยไม่มีคนกด
    const offenders = contentFiles
      .filter((f) => /sendMessage|@\/server\/meta\/|@\/server\/transports\//.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('API ของชุดคำตอบ/แท็ก ห้ามเรียก sendMessage', () => {
    const apis = CODE_FILES.filter(
      (f) => rel(f).startsWith('app/api/canned/') || rel(f).startsWith('app/api/tags/'),
    );
    expect(apis.length).toBeGreaterThan(0);
    const offenders = apis.filter((f) => /sendMessage/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});

/* ================================================================== */
describe('🔴 ตัวดึงที่อยู่ต้องเป็นฟังก์ชันบริสุทธิ์ และไม่เขียนทับข้อมูลลูกค้าเอง', () => {
  const extractFiles = CODE_FILES.filter((f) => rel(f).startsWith('server/extract/'));

  it('มีไฟล์ในโฟลเดอร์ extract ให้ตรวจจริง', () => {
    expect(extractFiles.length).toBeGreaterThan(0);
  });

  it('ห้ามต่อฐานข้อมูล ห้ามยิงเน็ต ห้ามอ่านเวลาปัจจุบัน', () => {
    const offenders = extractFiles
      .filter((f) => /supabase|db\(\)|fetch\(|Date\.now\(\)|new Date\(\)/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('ไม่มีเส้นทางไหนเอาผลจากตัวดึงไปเขียนลง customers โดยตรง', () => {
    // ค่าที่บันทึกต้องมาจากฟอร์มที่แอดมินตรวจแล้วเท่านั้น (สเปก 5.2)
    const offenders = CODE_FILES.filter((f) => {
      const src = read(f).replace(/\n/g, ' ');
      if (!src.includes('extractAddress')) return false;
      // ไฟล์ที่เรียกตัวดึง ต้องไม่มีการเขียนตาราง customers อยู่ในไฟล์เดียวกัน
      return /from\(['"]customers['"]\)[^;]*\.update\(/.test(src);
    }).map(rel);
    expect(offenders).toEqual([]);
  });
});

/* ================================================================== */
/* รอบ 5 — ออเดอร์ / สินค้า / โปรโมชัน                                   */
/* ================================================================== */
describe('🔴 ชั้นออเดอร์ต้องไม่กลายเป็นทางลัดในการส่งข้อความ', () => {
  const orderFiles = CODE_FILES.filter((f) => rel(f).startsWith('server/orders/'));
  const orderApis = CODE_FILES.filter(
    (f) =>
      rel(f).startsWith('app/api/orders/') ||
      rel(f).startsWith('app/api/products/') ||
      rel(f).startsWith('app/api/promotions/'),
  );

  it('มีไฟล์ในโฟลเดอร์ orders และ API ให้ตรวจจริง', () => {
    expect(orderFiles.length).toBeGreaterThan(0);
    expect(orderApis.length).toBeGreaterThan(0);
  });

  it('ชั้นออเดอร์ห้ามเรียก sendMessage หรือแตะ Meta / transport เลย', () => {
    // การแจ้งเลขพัสดุให้ลูกค้าเป็นงานของรอบถัดไป และต้องผ่าน Policy Engine
    // ถ้าเปิดทางไว้ตรงนี้ วันหนึ่งจะมีคนต่อสาย "บันทึกเลขพัสดุแล้วส่งเลย" เข้ามา
    const offenders = [...orderFiles, ...orderApis]
      .filter((f) => /sendMessage|@\/server\/meta\/|@\/server\/transports\/|@\/server\/messaging\//.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("ชั้นออเดอร์ห้าม select('*') และห้ามแตะ access_token", () => {
    const offenders = orderFiles
      .filter((f) => /\.select\(\s*['"]\*['"]\s*\)/.test(read(f)) || read(f).includes('access_token'))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('ชั้นออเดอร์ต้องประกาศ server-only', () => {
    const service = CODE_FILES.find((f) => rel(f) === 'server/orders/service.ts');
    expect(service, 'ไม่พบ server/orders/service.ts').toBeDefined();
    expect(read(service!)).toContain("import 'server-only'");
  });
});

/* ================================================================== */
describe('🔴 ตัวคิดราคาต้องเป็นฟังก์ชันบริสุทธิ์ และมีที่เดียว', () => {
  const PRICING = 'server/orders/pricing.ts';

  it('ตัวคิดราคาห้ามต่อฐานข้อมูล ห้ามยิงเน็ต ห้ามอ่านเวลาปัจจุบัน', () => {
    // ราคาต้องคิดได้จาก input อย่างเดียว ถึงจะทดสอบให้ครบทุกกรณีได้
    const file = CODE_FILES.find((f) => rel(f) === PRICING);
    expect(file, `ไม่พบไฟล์ ${PRICING}`).toBeDefined();
    const src = read(file!);
    expect(src).not.toMatch(/supabase|db\(\)|fetch\(|Date\.now\(\)|new Date\(\)/);
  });

  it('🔴 เบราว์เซอร์ห้ามคิดราคาเอง — สูตรราคาต้องมีที่เดียว', () => {
    // ถ้าหน้าเว็บคูณเลขเองด้วย จะมีสูตรสองที่ วันที่ไม่ตรงกัน
    // แอดมินจะเห็นราคาหนึ่ง แต่ระบบบันทึกอีกราคาหนึ่ง โดยไม่มีใครรู้ตัว
    const clientFiles = CODE_FILES.filter((f) => read(f).slice(0, 200).includes("'use client'"));
    const offenders = clientFiles
      .filter((f) => /calculateOrder|requiredPickCount|@\/server\/orders\/pricing/.test(read(f)))
      .map(rel)
      // อนุญาตให้ import "ชนิดข้อมูล" ของราคามาแสดงผลได้ (import type เท่านั้น)
      .filter((r) => {
        const file = CODE_FILES.find((x) => rel(x) === r)!;
        const src = read(file);
        const nonTypeImport = /^import\s+(?!type\s)[^;]*from\s+['"]@\/server\/orders\/pricing['"]/m;
        return nonTypeImport.test(src) || /calculateOrder\(|requiredPickCount\(/.test(src);
      });
    expect(offenders).toEqual([]);
  });

  it('เรียก calculateOrder() ได้เฉพาะฝั่งเซิร์ฟเวอร์', () => {
    const offenders = CODE_FILES.filter((f) => {
      const r = rel(f);
      if (r.startsWith('server/orders/')) return false;
      if (!/\bcalculateOrder\(/.test(read(f))) return false;
      // API route ฝั่งเซิร์ฟเวอร์เรียกได้
      return !r.startsWith('app/api/');
    }).map(rel);
    expect(offenders).toEqual([]);
  });
});

/* ================================================================== */
describe('🔴 ตัวเลขที่ใช้วัดผลต้องปลอมจากหน้าเว็บไม่ได้', () => {
  it('API สร้างออเดอร์ต้องไม่รับ referral / first_contact / page_id / customer_id จาก body', () => {
    // ตัวเลขพวกนี้ใช้ตัดสินว่าแอดคนไหนคุ้ม และแอดมินคนไหนปิดการขายเก่ง
    // ถ้ารับมาจากเบราว์เซอร์ได้ = แก้ตัวเลขวัดผลของตัวเองได้
    const file = CODE_FILES.find((f) => rel(f) === 'app/api/orders/route.ts');
    expect(file, 'ไม่พบ app/api/orders/route.ts').toBeDefined();
    const src = read(file!);

    // ดูเฉพาะ "แบบฟอร์มที่รับจาก body" (createSchema) เท่านั้น
    // ตัวกรองของ GET ใช้ page_id ได้ตามปกติ — นั่นคือการอ่าน ไม่ใช่การเขียน
    const start = src.indexOf('const createSchema');
    expect(start, 'ไม่พบ createSchema').toBeGreaterThan(-1);
    const schema = src.slice(start, src.indexOf('});', start));

    for (const forbidden of ['referral_ad_id', 'referral_post_id', 'first_contact_at', 'page_id', 'customer_id']) {
      expect(schema, `${forbidden} ต้องไม่อยู่ในสิ่งที่รับจาก body`).not.toContain(forbidden);
    }
  });

  it('API แก้ออเดอร์ต้องไม่ยอมให้แก้เลขออเดอร์ / ที่มา / ผู้สร้าง', () => {
    const file = CODE_FILES.find((f) => rel(f) === 'app/api/orders/[id]/route.ts');
    expect(file, 'ไม่พบ app/api/orders/[id]/route.ts').toBeDefined();
    const src = read(file!);
    for (const forbidden of ['order_no', 'referral_ad_id', 'created_by_admin_id', 'conversation_id']) {
      expect(src, `${forbidden} ต้องแก้จากหน้าเว็บไม่ได้`).not.toContain(forbidden);
    }
  });

  it('ฟิลด์ที่ยอมให้แก้ ต้องอยู่ในรายชื่อปิด (OrderPatch) ไม่ใช่รับอะไรก็ได้', () => {
    const service = CODE_FILES.find((f) => rel(f) === 'server/orders/service.ts');
    const src = read(service!);
    expect(src).toMatch(/export type OrderPatch/);
    // ต้องไม่มีการโยน object ทั้งก้อนจากผู้เรียกเข้าไปเป็น patch แบบไม่กรอง
    expect(src).not.toMatch(/p_patch:\s*await\s/);
  });
});

/* ================================================================== */
/* รอบ 6 — ตอบอัตโนมัติด้วยคีย์เวิร์ด                                     */
/* ================================================================== */
describe('🔴 การตอบอัตโนมัติต้องเดินตามทางเดินกลางเสมอ', () => {
  const autoFiles = CODE_FILES.filter((f) => rel(f).startsWith('server/autoreply/'));

  it('มีไฟล์ในโฟลเดอร์ autoreply ให้ตรวจจริง', () => {
    expect(autoFiles.length).toBeGreaterThan(0);
  });

  it('🔴 ตอบอัตโนมัติห้ามแตะ Meta client / transport adapter เลย', () => {
    // ถ้าเปิดทางไว้ วันหนึ่งจะมีคน "แก้ให้ส่งได้" ด้วยการยิงตรง
    // ซึ่งข้ามการตรวจกรอบ 24 ชม. ทั้งหมด = เพจโดนระงับ
    const offenders = autoFiles
      .filter((f) => /@\/server\/meta\/|@\/server\/transports\//.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('🔴 ตอบอัตโนมัติต้องใช้ตราประทับของบอทเท่านั้น ห้ามใช้ของคน', () => {
    const runner = CODE_FILES.find((f) => rel(f) === 'server/autoreply/runner.ts');
    expect(runner, 'ไม่พบ server/autoreply/runner.ts').toBeDefined();
    const src = read(runner!);
    expect(src).toContain('keywordBotProvenance');
    // humanAdminReply อ่าน session ของแอดมิน — งานเบื้องหลังต้องไม่แตะเด็ดขาด
    expect(src).not.toContain('humanAdminReply');
    expect(src).not.toMatch(/human_authored/);
  });

  it('🔴 ตัวจับคีย์เวิร์ดต้องเป็นฟังก์ชันบริสุทธิ์', () => {
    const matcher = CODE_FILES.find((f) => rel(f) === 'server/autoreply/matcher.ts');
    expect(matcher, 'ไม่พบ server/autoreply/matcher.ts').toBeDefined();
    const src = read(matcher!);
    expect(src).not.toMatch(/supabase|db\(\)|fetch\(|Date\.now\(\)|new Date\(\)/);
  });

  it('🔴 ห้ามใช้ regex ที่แอดมินกำหนดเอง (ช่อง ReDoS)', () => {
    // แอดมินใส่ pattern อย่าง (a+)+$ ได้เมื่อไหร่ เซิร์ฟเวอร์ค้างได้ด้วยข้อความสั้น ๆ
    const offenders = autoFiles
      .filter((f) => /new RegExp\(/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('🔴 ต้องจองสิทธิ์กับฐานข้อมูลก่อนส่งเสมอ', () => {
    const runner = CODE_FILES.find((f) => rel(f) === 'server/autoreply/runner.ts');
    const src = read(runner!);
    const claimAt = src.indexOf('claim_auto_reply');
    const sendAt = src.indexOf('sendMessage(');
    expect(claimAt, 'ไม่พบการจองสิทธิ์').toBeGreaterThan(-1);
    expect(sendAt, 'ไม่พบการส่ง').toBeGreaterThan(-1);
    // จองต้องมาก่อนส่ง ไม่งั้น worker สองตัวจะตอบซ้ำ
    expect(claimAt).toBeLessThan(sendAt);
  });

  it('🔴 ผลลัพธ์ "ไม่ทราบผล" ต้องไม่ถูกลองใหม่อัตโนมัติ', () => {
    const runner = CODE_FILES.find((f) => rel(f) === 'server/autoreply/runner.ts');
    const src = read(runner!);
    expect(src).toContain('outcome_unknown');
    // งานอัตโนมัติต้องยิงรอบเดียว — ลองซ้ำ = เสี่ยงลูกค้าได้ข้อความสองครั้ง
    expect(src).toMatch(/maxRetries:\s*1/);
  });

  it('API ของกฎห้ามเรียก sendMessage (ตั้งกฎ ≠ ส่งข้อความ)', () => {
    const apis = CODE_FILES.filter((f) => rel(f).startsWith('app/api/autoreply/'));
    expect(apis.length).toBeGreaterThan(0);
    const offenders = apis.filter((f) => /sendMessage|runAutoReply/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});

/* ================================================================== */
describe('🔴 การส่งรูปต้องเดินเส้นทางเดียวกับข้อความ', () => {
  it('ชั้นส่งรูปต้องเรียก sendMessage() ไม่ใช่ยิง Meta เอง', () => {
    const file = CODE_FILES.find((f) => rel(f) === 'server/messaging/send-image.ts');
    expect(file, 'ไม่พบ server/messaging/send-image.ts').toBeDefined();
    const src = read(file!);
    expect(src).toContain('sendMessage(');
    expect(src).not.toContain('sendToMeta');
    expect(src).not.toContain('graph.facebook.com');
  });

  it('route ส่งรูปต้องไม่รับ transport / tag / psid จากเบราว์เซอร์', () => {
    const file = CODE_FILES.find((f) => rel(f) === 'app/api/conversations/[id]/reply-image/route.ts');
    expect(file, 'ไม่พบ route ส่งรูป').toBeDefined();
    const src = read(file!);
    expect(src).not.toMatch(/transport\s*:/);
    expect(src).not.toMatch(/message_tag|messaging_type/);
    expect(src).not.toMatch(/psid/);
    // ตัวตนผู้ส่งต้องมาจาก session เท่านั้น
    expect(src).toContain('humanAdminReply');
  });
});

/* ================================================================== */
describe('🔴 ข้อมูลที่ทำให้ออเดอร์เก่าเพี้ยน ต้องปลอมจากหน้าเว็บไม่ได้', () => {
  it('สำเนาวิธีจัดส่งต้องไม่อยู่ในฟิลด์ที่แก้ได้จากหน้าเว็บ', () => {
    const service = CODE_FILES.find((f) => rel(f) === 'server/orders/service.ts');
    const src = read(service!);
    const start = src.indexOf('export type OrderPatch');
    expect(start).toBeGreaterThan(-1);
    const patchBlock = src.slice(start, src.indexOf('}>;', start));
    // ถ้ารับได้ จะปลอมค่าส่ง/สิทธิ์ COD ของออเดอร์เก่าได้ทันที
    expect(patchBlock).not.toContain('shipping_snapshot');
    expect(patchBlock).not.toContain('order_no');
    expect(patchBlock).not.toContain('created_by_admin_id');
  });

  it('กฎ COD ต้องบังคับในฐานข้อมูล ไม่ใช่แค่ฝั่งหน้าเว็บ', () => {
    const migrations = readdirSync(path.resolve(SRC, '../supabase/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(path.resolve(SRC, '../supabase/migrations', f), 'utf8'))
      .join('\n');
    expect(migrations).toContain('cod_supported');
    expect(migrations).toMatch(/ไม่รองรับเก็บเงินปลายทาง/);
  });

  it('การกันตอบซ้ำต้องมาจาก unique index ของฐานข้อมูล', () => {
    const migrations = readdirSync(path.resolve(SRC, '../supabase/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(path.resolve(SRC, '../supabase/migrations', f), 'utf8'))
      .join('\n');
    // ถ้าไม่มีบรรทัดนี้ การกันซ้ำจะเหลือแค่จังหวะของ JavaScript ซึ่งกันไม่ได้จริง
    expect(migrations).toMatch(/create unique index[^;]*auto_reply_executions \(message_id\)/);
  });
});

/* ================================================================== */
/* D-17 — เก็บสื่อไว้เองอย่างถาวร                                        */
/* ================================================================== */
describe('🔴 ที่เก็บไฟล์ต้องอยู่ฝั่งเซิร์ฟเวอร์ที่เดียว', () => {
  it('r2.cloudflarestorage.com ปรากฏได้เฉพาะใน server/storage/r2.ts', () => {
    const offenders = CODE_FILES.filter(
      (f) => read(f).includes('r2.cloudflarestorage.com') && rel(f) !== 'server/storage/r2.ts',
    ).map(rel);
    expect(offenders).toEqual([]);
  });

  it('🔴 กุญแจของ R2 ห้ามหลุดไปฝั่งเบราว์เซอร์', () => {
    const clientFiles = CODE_FILES.filter((f) => read(f).slice(0, 200).includes("'use client'"));
    const offenders = clientFiles
      .filter((f) => /R2_ACCESS_KEY|R2_SECRET|aws4fetch|AwsClient/.test(read(f)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('ชั้นที่เก็บไฟล์ต้องประกาศ server-only', () => {
    for (const target of ['server/storage/r2.ts', 'server/storage/media.ts']) {
      const file = CODE_FILES.find((f) => rel(f) === target);
      expect(file, `ไม่พบไฟล์ ${target}`).toBeDefined();
      expect(read(file!), `${target} ต้องมี import 'server-only'`).toContain("import 'server-only'");
    }
  });

  it('🔴 การแยก "ลิงก์หมดอายุ" ต้องใช้ชนิดของ error ไม่ใช่เดาจากข้อความ', () => {
    // เคยเขียนแบบอ่านเลขจากข้อความแล้วพลาด : R2 ตอบ 403 → ไปจดว่าไฟล์ลูกค้าหายถาวร
    const media = CODE_FILES.find((f) => rel(f) === 'server/storage/media.ts');
    expect(media).toBeDefined();
    const src = read(media!);
    expect(src).toContain('SourceGoneError');
    // ต้องไม่มี regex ที่ไล่จับเลขสถานะจากข้อความ error
    expect(src).not.toMatch(/\(403\|404\|410\)/);
  });

  it('🔴 เสิร์ฟไฟล์ต้องตรวจสิทธิ์รายเพจทุกครั้ง', () => {
    const route = CODE_FILES.find((f) => rel(f) === 'app/api/media/[id]/route.ts');
    expect(route, 'ไม่พบ route เสิร์ฟไฟล์').toBeDefined();
    const src = read(route!);
    // ถ้าไม่ตรวจ แอดมินที่ไม่มีสิทธิ์เห็นเพจจะเปิดสลิปของเพจนั้นได้
    expect(src).toContain('canSeePage');
    expect(src).toContain('requireAdmin');
  });

  it('การเก็บไฟล์ต้องจองสิทธิ์กับฐานข้อมูลก่อนโหลดเสมอ', () => {
    const media = CODE_FILES.find((f) => rel(f) === 'server/storage/media.ts');
    const src = read(media!);
    const claimAt = src.indexOf('claim_media');
    const fetchAt = src.indexOf('fetchAndStore(');
    expect(claimAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(-1);
    expect(claimAt).toBeLessThan(fetchAt);
  });

  it('การกันโหลดซ้ำต้องมาจาก unique index ของฐานข้อมูล', () => {
    const migrations = readdirSync(path.resolve(SRC, '../supabase/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(path.resolve(SRC, '../supabase/migrations', f), 'utf8'))
      .join('\n');
    expect(migrations).toMatch(/create unique index[^;]*media_assets \(message_id, attachment_index\)/);
  });

  it('⭐ ระบบต้องทำงานได้แม้ยังไม่ได้ตั้งค่า R2', () => {
    // ถ้าบังคับให้ตั้งค่าก่อน = เจ้าของร้านใช้ระบบไม่ได้จนกว่าจะเปิดบัญชี R2
    const r2 = CODE_FILES.find((f) => rel(f) === 'server/storage/r2.ts');
    expect(read(r2!)).toContain('isStorageConfigured');
    const media = CODE_FILES.find((f) => rel(f) === 'server/storage/media.ts');
    expect(read(media!)).toContain('isStorageConfigured');
  });
});
