import 'server-only';

import { db } from '@/lib/supabase/admin';
import { ALL_TABLES } from '@/types/db';
import { getRuntimeSetting } from '@/server/settings/service';
import { testPageConnection } from '@/server/pages/service';
import { getAiSettings } from '@/server/ai/gemini';
import { serverEnv } from '@/config/env';

import {
  type DiagnosticItemStatus,
  type SubsystemDiagnostic,
  type MetaErrorIssue,
  type PageDiagnosticItem,
  type SystemDiagnosticsReport,
} from '@/types/diagnostics';

export type {
  DiagnosticItemStatus,
  SubsystemDiagnostic,
  MetaErrorIssue,
  PageDiagnosticItem,
  SystemDiagnosticsReport,
};

export async function runSystemDiagnostics(options: { fullPageCheck?: boolean } = {}): Promise<SystemDiagnosticsReport> {
  const checkedAt = new Date().toISOString();
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  const since24h = oneDayAgo.toISOString();

  // 1. ดึงข้อมูลเพจและตรวจสถานะ Meta
  const { data: pageRows } = await db()
    .from('pages')
    .select('id, platform, page_id, page_name, is_active, access_token, created_at')
    .order('created_at');

  const rawPages = (pageRows ?? []) as Array<{
    id: string;
    platform: string;
    page_id: string;
    page_name: string;
    is_active: boolean;
    access_token: string | null;
    created_at: string;
  }>;

  const pages: PageDiagnosticItem[] = [];
  let pagesWithoutToken = 0;
  let activePagesCount = 0;

  for (const p of rawPages) {
    const hasToken = Boolean(p.access_token);
    if (p.is_active) activePagesCount++;
    if (!hasToken && p.is_active) pagesWithoutToken++;

    let liveTest: { ok: boolean; messageTh: string } | undefined;
    if (options.fullPageCheck && hasToken && p.is_active) {
      try {
        const testRes = await testPageConnection(p.id);
        liveTest = { ok: testRes.ok, messageTh: testRes.message_th };
      } catch (err) {
        liveTest = { ok: false, messageTh: `ทดสอบไม่สำเร็จ: ${(err as Error).message}` };
      }
    }

    pages.push({
      id: p.id,
      platform: p.platform,
      pageId: p.page_id,
      pageName: p.page_name,
      isActive: p.is_active,
      hasToken,
      liveTest,
    });
  }

  const [settingVerifyToken, settingAppId, settingAppSecret, settingAppUrl] = await Promise.all([
    getRuntimeSetting('META_VERIFY_TOKEN'),
    getRuntimeSetting('META_APP_ID'),
    getRuntimeSetting('META_APP_SECRET'),
    getRuntimeSetting('APP_BASE_URL'),
  ]);

  const envs = serverEnv();
  const hasVerifyToken = Boolean(settingVerifyToken || envs.META_VERIFY_TOKEN);
  const hasAppId = Boolean(settingAppId || envs.META_APP_ID);
  const hasAppSecret = Boolean(settingAppSecret || envs.META_APP_SECRET);

  // 2. ดึงสถิติข้อผิดพลาด Meta ย้อนหลัง 24 ชม.
  const [{ data: recentSends }, { data: recentAttempts }] = await Promise.all([
    db()
      .from('message_sends')
      .select('id, status, policy_reason_code, policy_reason_th, created_at')
      .gte('created_at', since24h)
      .order('created_at', { ascending: false })
      .limit(300),
    db()
      .from('send_attempts')
      .select('id, success, meta_response_code, meta_error_subcode, meta_error_message, policy_reason_code, policy_reason_th, fbtrace_id, created_at')
      .gte('created_at', since24h)
      .eq('success', false)
      .order('created_at', { ascending: false })
      .limit(300),
  ]);

  const sendsList = recentSends ?? [];
  const attemptsList = recentAttempts ?? [];

  const totalSends24h = sendsList.length;
  const successfulSends24h = sendsList.filter((s) => s.status === 'succeeded').length;
  const policyBlocked24h = sendsList.filter((s) => s.status === 'blocked_by_policy').length;
  const failedSends24h = sendsList.filter((s) => s.status === 'permanent_failed' || s.status === 'retryable_failed' || s.status === 'outcome_unknown').length;

  // วิเคราะห์และจัดกลุ่ม Meta Error Issues
  const issuesMap = new Map<string, MetaErrorIssue>();

  for (const att of attemptsList) {
    const code = att.meta_response_code;
    const subcode = att.meta_error_subcode;
    const msg = att.meta_error_message || '';

    // A. Token Expired / Invalid
    if (code === 190 || /token|session|oauth/i.test(msg)) {
      const key = 'token_expired';
      const existing = issuesMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        issuesMap.set(key, {
          id: key,
          title: 'Meta Access Token หมดอายุ หรือถูกเพิกถอน (Error 190)',
          code,
          subcode,
          count: 1,
          lastOccurredAt: att.created_at,
          severity: 'high',
          explanationTh: 'Token ของเพจหมดอายุ หรือแอดมินเพจเปลี่ยนรหัสผ่าน Facebook ทำให้ Meta ปฏิเสธการส่งข้อความ',
          solutionTh: 'ไปที่หน้า "จัดการเพจ" แล้วกดใส่ Access Token ใหม่จาก Facebook Graph API Explorer หรือ Meta Business Manager',
          actionLink: { href: '/settings/pages', label: 'ไปหน้าจัดการเพจ' },
        });
      }
      continue;
    }

    // B. Outside 24-Hour Messaging Window
    if (subcode === 2018278 || att.policy_reason_code === 'outside_24h_window' || /window|24\s*hour/i.test(msg)) {
      const key = 'window_closed';
      const existing = issuesMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        issuesMap.set(key, {
          id: key,
          title: 'อยู่นอกกรอบเวลา 24 ชั่วโมงของ Meta (Policy Block)',
          code,
          subcode,
          count: 1,
          lastOccurredAt: att.created_at,
          severity: 'medium',
          explanationTh: 'ลูกค้านิ่งเกิน 24 ชม. หลังจากข้อความล่าสุด กฎ Meta ห้ามเพจส่งข้อความทั่วไปหาลูกค้าเอง',
          solutionTh: 'ระบบ Policy Engine บล็อกให้อัตโนมัติเพื่อป้องกันเพจโดนแบน หากต้องการส่งต้องใช้ Message Tag ที่อนุญาต หรือรอให้ลูกค้าทักเข้ามาก่อน',
          actionLink: { href: '/send-status', label: 'ดูประวัติการส่ง' },
        });
      }
      continue;
    }

    // C. Missing Permissions
    if (code === 10 || code === 200 || /permission|pages_messaging|manage_pages/i.test(msg)) {
      const key = 'missing_permissions';
      const existing = issuesMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        issuesMap.set(key, {
          id: key,
          title: 'ขาดสิทธิ์ (Permission) ที่จำเป็นบน Meta (Error 10/200)',
          code,
          subcode,
          count: 1,
          lastOccurredAt: att.created_at,
          severity: 'high',
          explanationTh: 'Token ที่สร้างขึ้น ขาดสิทธิ์ `pages_messaging` หรือเพจถูกจำกัดสิทธิ์ใน Meta Business Manager',
          solutionTh: 'ตรวจสอบใน Meta Developer Portal ว่าแอปมีสิทธิ์ `pages_messaging` และ User ที่สร้าง Token มีบทบาทเป็น Admin เพจ',
          actionLink: { href: '/settings/pages', label: 'จัดการเพจ' },
        });
      }
      continue;
    }

    // D. User Blocked or Unavailable
    if (code === 551 || subcode === 2018108 || /blocked|cannot receive/i.test(msg)) {
      const key = 'user_blocked';
      const existing = issuesMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        issuesMap.set(key, {
          id: key,
          title: 'ลูกค้าบล็อกเพจ หรือปิดรับข้อความ (Error 551)',
          code,
          subcode,
          count: 1,
          lastOccurredAt: att.created_at,
          severity: 'low',
          explanationTh: 'ลูกค้าเลือกปิดรับข้อความจากเพจ บล็อกเพจ หรือบัญชี Facebook ถูกระงับ',
          solutionTh: 'ระบบตรวจจับและบันทึกสถานะเรียบร้อยแล้ว ไม่ต้องพยายามส่งซ้ำเพื่อป้องกันปัญหาด้านคะแนนเพจ',
          actionLink: { href: '/inbox', label: 'เปิดดูห้องแชท' },
        });
      }
      continue;
    }

    // E. Rate Limited
    if (code === 4 || code === 613 || /rate limit|calls/i.test(msg)) {
      const key = 'rate_limited';
      const existing = issuesMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        issuesMap.set(key, {
          id: key,
          title: 'ส่งข้อความถี่เกินเกณฑ์ Meta Rate Limit (Error 4/613)',
          code,
          subcode,
          count: 1,
          lastOccurredAt: att.created_at,
          severity: 'medium',
          explanationTh: 'เพจส่งข้อความหรือเรียก Meta API เร็วเกินกว่าที่ระบบ Meta อนุญาตต่อนาที',
          solutionTh: 'ระบบจะใช้ Exponential Backoff ชะลอและลองใหม่อัตโนมัติ ควรหลีกเลี่ยงการกดส่งซ้ำรัวๆ',
          actionLink: { href: '/send-status', label: 'ดูสถานะการส่ง' },
        });
      }
      continue;
    }

    // F. Other Generic Meta Errors
    const key = `generic_${code ?? 'err'}`;
    const existing = issuesMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      issuesMap.set(key, {
        id: key,
        title: att.policy_reason_th || `ข้อผิดพลาดจาก Meta (Code: ${code ?? 'N/A'})`,
        code,
        subcode,
        count: 1,
        lastOccurredAt: att.created_at,
        severity: 'medium',
        explanationTh: msg || 'Meta ส่งสัญญาณข้อผิดพลาดกลับมาขณะส่งข้อความ',
        solutionTh: 'ตรวจสอบรายละเอียดในประวัติการส่ง หรือทดสอบเชื่อมต่อเพจใหม่อีกครั้ง',
        actionLink: { href: '/send-status', label: 'ดูรายละเอียด' },
      });
    }
  }

  // เพิ่มเคส Timeout / Outcome Unknown จาก message_sends ถ้ามี
  const unknownSends = sendsList.filter((s) => s.status === 'outcome_unknown');
  if (unknownSends.length > 0) {
    issuesMap.set('outcome_unknown', {
      id: 'outcome_unknown',
      title: 'ข้อความไม่ทราบผล — ป้องกันการส่งเบิ้ล (Timeout 15s)',
      code: null,
      subcode: null,
      count: unknownSends.length,
      lastOccurredAt: unknownSends[0].created_at,
      severity: 'medium',
      explanationTh: 'เซิร์ฟเวอร์ส่งคำขอไปยัง Meta แล้วแต่ไม่ได้รับผลตอบกลับภายใน 15 วินาที',
      solutionTh: 'ระบบระงับไว้เพื่อป้องกันลูกค้าได้รับข้อความซ้ำ ห้ามกดส่งเดาซ้ำ แอดมินสามารถเปิดดูในแอพ Messenger เพื่อยืนยันได้',
      actionLink: { href: '/send-status', label: 'ดูรายการไม่ทราบผล' },
    });
  }

  const metaIssues = Array.from(issuesMap.values()).sort((a, b) => {
    const sevScore = { high: 3, medium: 2, low: 1 };
    return sevScore[b.severity] - sevScore[a.severity] || b.count - a.count;
  });

  // ประเมินสถานะ Meta Subsystem
  let metaStatus: DiagnosticItemStatus = 'healthy';
  const metaDetails: string[] = [];

  if (activePagesCount === 0) {
    metaStatus = 'warning';
    metaDetails.push('ยังไม่มีเพจที่เปิดใช้งาน (Active)');
  } else {
    metaDetails.push(`เชื่อมต่อเพจพร้อมทำงาน ${activePagesCount} เพจ`);
  }

  if (pagesWithoutToken > 0) {
    metaStatus = 'error';
    metaDetails.push(`มี ${pagesWithoutToken} เพจยังไม่ได้ใส่ Access Token`);
  }

  if (!hasVerifyToken) {
    metaStatus = metaStatus === 'error' ? 'error' : 'warning';
    metaDetails.push('ยังไม่ได้ตั้งค่า META_VERIFY_TOKEN สำหรับ Webhook');
  } else {
    metaDetails.push('Verify Token สำหรับ Webhook พร้อมใช้งาน');
  }

  if (hasAppId && hasAppSecret) {
    metaDetails.push('App ID & App Secret พร้อมใช้งาน');
  }

  const hasHighMetaIssues = metaIssues.some((i) => i.severity === 'high');
  if (hasHighMetaIssues) {
    metaStatus = 'error';
    metaDetails.push(`พบปัญหา Meta ขั้นวิกฤต ${metaIssues.filter((i) => i.severity === 'high').length} รายการ`);
  } else if (metaIssues.length > 0) {
    if (metaStatus !== 'error') metaStatus = 'warning';
    metaDetails.push(`พบข้อผิดพลาดหรือข้อควรระวัง ${metaIssues.length} เรื่องในรอบ 24 ชม.`);
  }

  // 3. ตรวจสอบฐานข้อมูล Supabase
  let dbStatus: DiagnosticItemStatus = 'healthy';
  const dbDetails: string[] = [];

  try {
    const { error: adminErr } = await db().from('admins').select('id', { head: true, count: 'exact' }).limit(1);
    if (adminErr) throw adminErr;
    dbDetails.push('เชื่อมต่อฐานข้อมูล PostgreSQL ผ่าน Service Role สำเร็จ');
  } catch (err) {
    dbStatus = 'error';
    dbDetails.push(`ต่อฐานข้อมูลไม่สำเร็จ: ${(err as Error).message}`);
  }

  // ตรวจตารางครบ 37 ตาราง
  try {
    const tableChecks = await Promise.all(
      ALL_TABLES.map(async (t) => {
        const { error } = await db().from(t).select('*', { head: true, count: 'exact' }).limit(1);
        return { table: t, ok: !error };
      }),
    );
    const missingTables = tableChecks.filter((tc) => !tc.ok).map((tc) => tc.table);
    if (missingTables.length > 0) {
      dbStatus = 'error';
      dbDetails.push(`พบตารางไม่สมบูรณ์ ${missingTables.length} ตาราง: ${missingTables.join(', ')}`);
    } else {
      dbDetails.push(`ตารางระบบสมบูรณ์ครบทั้ง ${ALL_TABLES.length} ตาราง`);
    }
  } catch (err) {
    dbStatus = 'error';
    dbDetails.push(`ตรวจตารางไม่สำเร็จ: ${(err as Error).message}`);
  }

  // 4. ตรวจสอบ Supabase Storage
  let storageStatus: DiagnosticItemStatus = 'healthy';
  const storageDetails: string[] = [];

  try {
    const { data: bucket, error: bucketErr } = await db().storage.getBucket('media');
    if (bucketErr || !bucket) {
      storageStatus = 'warning';
      storageDetails.push('ไม่พบบักเก็ต media หรือไม่มีสิทธิ์เข้าถึง (ระบบจะพยายามสร้างอัตโนมัติ)');
    } else {
      storageDetails.push(`บักเก็ต 'media' พร้อมใช้งาน (จำกัดขนาด ${Math.round((bucket.file_size_limit ?? 26214400) / 1024 / 1024)}MB)`);
    }
  } catch (err) {
    storageStatus = 'warning';
    storageDetails.push(`ไม่สามารถเข้าถึง Supabase Storage: ${(err as Error).message}`);
  }

  // 5. ตรวจสอบ Gemini AI & Bots
  let aiStatus: DiagnosticItemStatus = 'healthy';
  const aiDetails: string[] = [];
  const aiSettings = await getAiSettings();

  if (!aiSettings.apiKey) {
    aiStatus = 'error';
    aiDetails.push('ยังไม่ได้ใส่ GEMINI_API_KEY — ระบบ AI แอดมินและปุ่มช่วยคิดจะไม่ทำงาน');
  } else {
    aiDetails.push(`API Key พร้อมใช้งาน (โมเดล: ${aiSettings.model || 'gemini-2.5-flash'})`);
  }

  aiDetails.push(`บอทตอบคอมเมนต์: ${aiSettings.autoReplyComments ? 'เปิดใช้งาน' : 'ปิดอยู่'}`);
  aiDetails.push(`ค่าเริ่มต้นบอทในแชทใหม่: ${aiSettings.defaultChatBot ? 'เปิดตอบอัตโนมัติ' : 'ปิด (ให้แอดมินตอบเอง)'}`);

  // 6. ตรวจสอบ Notifications
  let notifyStatus: DiagnosticItemStatus = 'healthy';
  const notifyDetails: string[] = [];

  const [vapidPub, vapidPriv, teleToken, teleChatId] = await Promise.all([
    getRuntimeSetting('VAPID_PUBLIC_KEY'),
    getRuntimeSetting('VAPID_PRIVATE_KEY'),
    getRuntimeSetting('TELEGRAM_BOT_TOKEN'),
    getRuntimeSetting('TELEGRAM_CHAT_ID'),
  ]);

  const hasVapid = Boolean(vapidPub && vapidPriv);
  const hasTelegram = Boolean(teleToken && teleChatId);

  if (hasVapid) {
    notifyDetails.push('Web Push Notification (VAPID) พร้อมใช้งาน');
  } else {
    notifyDetails.push('ยังไม่ได้ตั้งค่า Web Push (VAPID Keys)');
  }

  if (hasTelegram) {
    notifyDetails.push('Telegram Bot แจ้งเตือนพร้อมใช้งาน');
  } else {
    notifyDetails.push('ยังไม่ได้ผูก Telegram Bot สำหรับแจ้งเตือนด่วน');
  }

  if (!hasVapid && !hasTelegram) {
    notifyStatus = 'warning';
  }

  // 7. ตรวจสอบ Messaging & Pipeline
  let messagingStatus: DiagnosticItemStatus = 'healthy';
  const messagingDetails: string[] = [];

  if (totalSends24h === 0) {
    messagingDetails.push('ไม่มีประวัติการส่งข้อความในรอบ 24 ชั่วโมงที่ผ่านมา');
  } else {
    const successRate = Math.round((successfulSends24h / totalSends24h) * 100);
    messagingDetails.push(`ส่งข้อความทั้งหมด ${totalSends24h} รายการ (สำเร็จ ${successfulSends24h} รายการ, อัตราสำเร็จ ${successRate}%)`);
    if (policyBlocked24h > 0) {
      messagingDetails.push(`ติดกฎความปลอดภัย/นอกกรอบ 24 ชม. ${policyBlocked24h} รายการ`);
    }
    if (failedSends24h > 0) {
      messagingDetails.push(`ส่งไม่สำเร็จ ${failedSends24h} รายการ`);
      if (successRate < 70) {
        messagingStatus = 'error';
      } else if (successRate < 90) {
        messagingStatus = 'warning';
      }
    }
  }

  // 8. คำนวณคะแนนและสถานะรวม (Overall Score)
  const statuses = [metaStatus, dbStatus, storageStatus, aiStatus, notifyStatus, messagingStatus];
  let errorCount = statuses.filter((s) => s === 'error').length;
  let warningCount = statuses.filter((s) => s === 'warning').length;

  let overallStatus: DiagnosticItemStatus = 'healthy';
  if (errorCount > 0) {
    overallStatus = 'error';
  } else if (warningCount > 0) {
    overallStatus = 'warning';
  }

  // คำนวณคะแนนเต็ม 100
  let score = 100;
  score -= errorCount * 25;
  score -= warningCount * 10;
  if (score < 0) score = 0;

  return {
    overallStatus,
    overallScore: score,
    checkedAt,
    subsystems: {
      meta: {
        id: 'meta',
        name: 'Meta / เพจ Facebook & IG',
        status: metaStatus,
        summary: activePagesCount > 0 ? `เชื่อมต่อ ${activePagesCount} เพจ (${hasHighMetaIssues ? 'พบ Error วิกฤต' : metaIssues.length > 0 ? `มีข้อผิดพลาด ${metaIssues.length} เรื่อง` : 'ปกติ 100%'})` : 'ยังไม่มีเพจพร้อมใช้งาน',
        details: metaDetails,
        actionLink: { href: '/settings/pages', label: 'จัดการเพจ' },
      },
      database: {
        id: 'database',
        name: 'ฐานข้อมูล (Supabase DB)',
        status: dbStatus,
        summary: dbStatus === 'healthy' ? `พร้อมใช้งาน (${ALL_TABLES.length} ตารางสมบูรณ์)` : 'พบปัญหาในฐานข้อมูล',
        details: dbDetails,
      },
      storage: {
        id: 'storage',
        name: 'คลังเก็บไฟล์ (Supabase Storage)',
        status: storageStatus,
        summary: storageStatus === 'healthy' ? "บักเก็ต 'media' พร้อมเก็บรูป/สลิป" : 'ที่เก็บไฟล์อาจมีปัญหา',
        details: storageDetails,
      },
      ai: {
        id: 'ai',
        name: 'AI อัจฉริยะ (Gemini)',
        status: aiStatus,
        summary: aiSettings.apiKey ? `พร้อมใช้งาน (${aiSettings.model || 'gemini-2.5-flash'})` : 'ยังไม่ได้ใส่ GEMINI_API_KEY',
        details: aiDetails,
        actionLink: { href: '/settings/ai', label: 'ตั้งค่า AI' },
      },
      notifications: {
        id: 'notifications',
        name: 'ระบบแจ้งเตือน (Push & Telegram)',
        status: notifyStatus,
        summary: hasVapid || hasTelegram ? 'พร้อมทำงาน' : 'ยังไม่ได้เปิดช่องทางแจ้งเตือน',
        details: notifyDetails,
        actionLink: { href: '/settings/notifications', label: 'ตั้งค่าการแจ้งเตือน' },
      },
      messaging: {
        id: 'messaging',
        name: 'คิวการส่งข้อความ & ทรานสปอร์ต',
        status: messagingStatus,
        summary: totalSends24h > 0 ? `ส่งสำเร็จ ${Math.round((successfulSends24h / totalSends24h) * 100)}% ใน 24 ชม.` : 'คิวงานพร้อมรองรับข้อความใหม่',
        details: messagingDetails,
        actionLink: { href: '/send-status', label: 'ดูประวัติการส่ง' },
      },
    },
    metaErrors: {
      totalSends24h,
      successfulSends24h,
      failedSends24h,
      policyBlocked24h,
      issues: metaIssues,
    },
    pages,
  };
}
