'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Database,
  ExternalLink,
  HardDrive,
  HelpCircle,
  Loader2,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import PlatformIcon from '@/components/platform-icon';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type {
  DiagnosticItemStatus,
  MetaErrorIssue,
  SystemDiagnosticsReport,
} from '@/types/diagnostics';

function StatusIcon({ status, className }: { status: DiagnosticItemStatus; className?: string }) {
  if (status === 'healthy') {
    return <CheckCircle2 className={cn('size-4 text-emerald-500', className)} />;
  }
  if (status === 'warning') {
    return <AlertTriangle className={cn('size-4 text-amber-500', className)} />;
  }
  return <AlertCircle className={cn('size-4 text-rose-500', className)} />;
}

function StatusBadge({ status, score }: { status: DiagnosticItemStatus; score: number }) {
  if (status === 'healthy') {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 gap-1.5 py-0.5 px-2.5">
        <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
        พร้อมทำงานสมบูรณ์ ({score}/100)
      </Badge>
    );
  }
  if (status === 'warning') {
    return (
      <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 gap-1.5 py-0.5 px-2.5">
        <span className="size-2 rounded-full bg-amber-500" />
        มีข้อควรตรวจสอบ ({score}/100)
      </Badge>
    );
  }
  return (
    <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30 gap-1.5 py-0.5 px-2.5">
      <span className="size-2 rounded-full bg-rose-500 animate-ping" />
      ตรวจพบปัญหา ({score}/100)
    </Badge>
  );
}

export default function SystemMonitor({ isOwner }: { isOwner: boolean }) {
  const [report, setReport] = useState<SystemDiagnosticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showPagesList, setShowPagesList] = useState(false);

  const fetchDiagnostics = useCallback(async (isFullRefresh = false) => {
    if (isFullRefresh) setRefreshing(true);
    try {
      const url = isFullRefresh ? '/api/system/diagnostics?refresh=true' : '/api/system/diagnostics';
      const res = await fetch(url, { cache: 'no-store' });
      const json = await res.json();
      if (json.ok && json.data) {
        setReport(json.data);
        if (isFullRefresh) {
          toast.success('ตรวจสอบสถานะสดของทุกระบบเรียบร้อยแล้ว');
        }
      } else {
        toast.error(json.error?.message_th || 'ไม่สามารถโหลดสถานะระบบได้');
      }
    } catch (err) {
      console.error('[SystemMonitor] fetch error:', err);
      toast.error('เกิดข้อผิดพลาดในการเชื่อมต่อระบบตรวจสอบ');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchDiagnostics(false);
  }, [fetchDiagnostics]);

  if (loading && !report) {
    return (
      <Card className="border-border/60 bg-muted/20">
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
            <div className="text-sm text-muted-foreground">กำลังตรวจสอบสถานะและความพร้อมของระบบ...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!report) return null;

  const { overallStatus, overallScore, checkedAt, subsystems, metaErrors, pages } = report;
  const criticalIssueCount = metaErrors.issues.filter((i) => i.severity === 'high').length;
  const totalIssueCount = metaErrors.issues.length;

  return (
    <div className="flex flex-col gap-3">
      {/* Header Summary Card */}
      <Card className={cn(
        'transition-all duration-200 shadow-sm border',
        overallStatus === 'healthy' && 'border-emerald-500/30 bg-emerald-500/[0.02]',
        overallStatus === 'warning' && 'border-amber-500/30 bg-amber-500/[0.02]',
        overallStatus === 'error' && 'border-rose-500/30 bg-rose-500/[0.03]',
      )}>
        <CardHeader className="pb-3 pt-4 px-4 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start sm:items-center gap-3">
              <div className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-xl font-bold shadow-sm',
                overallStatus === 'healthy' && 'bg-emerald-500/15 text-emerald-600',
                overallStatus === 'warning' && 'bg-amber-500/15 text-amber-600',
                overallStatus === 'error' && 'bg-rose-500/15 text-rose-600',
              )}>
                <Activity className="size-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base sm:text-lg font-bold">แผงมอนิเตอร์สถานะระบบ & ตรวจสอบแอป</CardTitle>
                  <StatusBadge status={overallStatus} score={overallScore} />
                </div>
                <CardDescription className="text-xs mt-0.5 flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="size-3" />
                  ตรวจล่าสุด: {new Date(checkedAt).toLocaleTimeString('th-TH')}
                  {totalIssueCount > 0 && (
                    <span className="text-rose-600 font-medium ml-1">
                      • พบข้อสังเกต {totalIssueCount} เรื่อง
                    </span>
                  )}
                </CardDescription>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs font-medium"
                onClick={() => void fetchDiagnostics(true)}
                disabled={refreshing}
                title="ยิง ping ตรวจสอบสดทุกระบบและทดสอบ Token เพจ"
              >
                <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin text-primary')} />
                <span>{refreshing ? 'กำลังตรวจ...' : 'ตรวจสอบสด'}</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? (
                  <>
                    <span>ย่อ</span>
                    <ChevronUp className="size-4 ml-1" />
                  </>
                ) : (
                  <>
                    <span>ดูละเอียด</span>
                    <ChevronDown className="size-4 ml-1" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>

        {/* Quick Functional Chips (Always Visible) */}
        <CardContent className="px-4 pb-4 pt-0 sm:px-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {/* 1. Meta */}
            <div className={cn(
              'flex flex-col p-2.5 rounded-lg border text-left text-xs gap-1 transition-colors',
              subsystems.meta.status === 'healthy' && 'bg-emerald-500/5 border-emerald-500/20 text-emerald-950 dark:text-emerald-100',
              subsystems.meta.status === 'warning' && 'bg-amber-500/5 border-amber-500/20 text-amber-950 dark:text-amber-100',
              subsystems.meta.status === 'error' && 'bg-rose-500/5 border-rose-500/20 text-rose-950 dark:text-rose-100',
            )}>
              <div className="flex items-center justify-between font-semibold">
                <span>Meta / เพจ</span>
                <StatusIcon status={subsystems.meta.status} className="size-3.5" />
              </div>
              <span className="text-[11px] text-muted-foreground truncate" title={subsystems.meta.summary}>
                {subsystems.meta.summary}
              </span>
            </div>

            {/* 2. Supabase DB */}
            <div className={cn(
              'flex flex-col p-2.5 rounded-lg border text-left text-xs gap-1 transition-colors',
              subsystems.database.status === 'healthy' && 'bg-emerald-500/5 border-emerald-500/20 text-emerald-950 dark:text-emerald-100',
              subsystems.database.status === 'warning' && 'bg-amber-500/5 border-amber-500/20 text-amber-950 dark:text-amber-100',
              subsystems.database.status === 'error' && 'bg-rose-500/5 border-rose-500/20 text-rose-950 dark:text-rose-100',
            )}>
              <div className="flex items-center justify-between font-semibold">
                <span>ฐานข้อมูล</span>
                <StatusIcon status={subsystems.database.status} className="size-3.5" />
              </div>
              <span className="text-[11px] text-muted-foreground truncate" title={subsystems.database.summary}>
                {subsystems.database.summary}
              </span>
            </div>

            {/* 3. Storage */}
            <div className={cn(
              'flex flex-col p-2.5 rounded-lg border text-left text-xs gap-1 transition-colors',
              subsystems.storage.status === 'healthy' && 'bg-emerald-500/5 border-emerald-500/20 text-emerald-950 dark:text-emerald-100',
              subsystems.storage.status === 'warning' && 'bg-amber-500/5 border-amber-500/20 text-amber-950 dark:text-amber-100',
              subsystems.storage.status === 'error' && 'bg-rose-500/5 border-rose-500/20 text-rose-950 dark:text-rose-100',
            )}>
              <div className="flex items-center justify-between font-semibold">
                <span>คลังรูป/ไฟล์</span>
                <StatusIcon status={subsystems.storage.status} className="size-3.5" />
              </div>
              <span className="text-[11px] text-muted-foreground truncate" title={subsystems.storage.summary}>
                {subsystems.storage.summary}
              </span>
            </div>

            {/* 4. AI Gemini */}
            <div className={cn(
              'flex flex-col p-2.5 rounded-lg border text-left text-xs gap-1 transition-colors',
              subsystems.ai.status === 'healthy' && 'bg-emerald-500/5 border-emerald-500/20 text-emerald-950 dark:text-emerald-100',
              subsystems.ai.status === 'warning' && 'bg-amber-500/5 border-amber-500/20 text-amber-950 dark:text-amber-100',
              subsystems.ai.status === 'error' && 'bg-rose-500/5 border-rose-500/20 text-rose-950 dark:text-rose-100',
            )}>
              <div className="flex items-center justify-between font-semibold">
                <span>AI Gemini</span>
                <StatusIcon status={subsystems.ai.status} className="size-3.5" />
              </div>
              <span className="text-[11px] text-muted-foreground truncate" title={subsystems.ai.summary}>
                {subsystems.ai.summary}
              </span>
            </div>

            {/* 5. Notifications */}
            <div className={cn(
              'flex flex-col p-2.5 rounded-lg border text-left text-xs gap-1 transition-colors',
              subsystems.notifications.status === 'healthy' && 'bg-emerald-500/5 border-emerald-500/20 text-emerald-950 dark:text-emerald-100',
              subsystems.notifications.status === 'warning' && 'bg-amber-500/5 border-amber-500/20 text-amber-950 dark:text-amber-100',
              subsystems.notifications.status === 'error' && 'bg-rose-500/5 border-rose-500/20 text-rose-950 dark:text-rose-100',
            )}>
              <div className="flex items-center justify-between font-semibold">
                <span>การแจ้งเตือน</span>
                <StatusIcon status={subsystems.notifications.status} className="size-3.5" />
              </div>
              <span className="text-[11px] text-muted-foreground truncate" title={subsystems.notifications.summary}>
                {subsystems.notifications.summary}
              </span>
            </div>

            {/* 6. Messaging Queue */}
            <div className={cn(
              'flex flex-col p-2.5 rounded-lg border text-left text-xs gap-1 transition-colors',
              subsystems.messaging.status === 'healthy' && 'bg-emerald-500/5 border-emerald-500/20 text-emerald-950 dark:text-emerald-100',
              subsystems.messaging.status === 'warning' && 'bg-amber-500/5 border-amber-500/20 text-amber-950 dark:text-amber-100',
              subsystems.messaging.status === 'error' && 'bg-rose-500/5 border-rose-500/20 text-rose-950 dark:text-rose-100',
            )}>
              <div className="flex items-center justify-between font-semibold">
                <span>คิวส่งข้อความ</span>
                <StatusIcon status={subsystems.messaging.status} className="size-3.5" />
              </div>
              <span className="text-[11px] text-muted-foreground truncate" title={subsystems.messaging.summary}>
                {subsystems.messaging.summary}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 🚨 META ERROR & BUG INSPECTOR (ถ้ามี Error หรือผู้ใช้ขยายดู) */}
      {(totalIssueCount > 0 || expanded) && (
        <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/[0.03] to-rose-500/[0.03]">
          <CardHeader className="pb-3 px-4 sm:px-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-5 text-amber-600" />
                <CardTitle className="text-sm sm:text-base font-bold text-foreground">
                  ตัวตรวจจับ & ปรับปรุง Meta Error (ย้อนหลัง 24 ชม.)
                </CardTitle>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">ส่งทั้งหมด {metaErrors.totalSends24h} ครั้ง</span>
                <span className="text-emerald-600 font-medium">สำเร็จ {metaErrors.successfulSends24h}</span>
                {metaErrors.policyBlocked24h > 0 && (
                  <span className="text-amber-600 font-medium">ติดกฎ 24h: {metaErrors.policyBlocked24h}</span>
                )}
                {metaErrors.failedSends24h > 0 && (
                  <span className="text-rose-600 font-medium">ล้มเหลว {metaErrors.failedSends24h}</span>
                )}
              </div>
            </div>
            <CardDescription className="text-xs">
              ระบบตรวจสอบและแยกแยะข้อผิดพลาดที่เกิดขึ้นจริง เพื่อให้แอดมินแก้ไขได้อย่างตรงจุด
            </CardDescription>
          </CardHeader>

          <CardContent className="px-4 pb-4 pt-0 sm:px-6 flex flex-col gap-3">
            {metaErrors.issues.length === 0 ? (
              <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-800 dark:text-emerald-200">
                <CheckCircle2 className="size-5 text-emerald-600 shrink-0" />
                <div className="text-xs leading-relaxed">
                  <span className="font-semibold">ไม่พบข้อผิดพลาดหรือบั๊กจาก Meta ในรอบ 24 ชั่วโมงที่ผ่านมา</span>
                  <p className="text-emerald-700/80 dark:text-emerald-300/80 mt-0.5">
                    การรับ Webhook ขาเข้า และการส่งข้อความผ่าน Graph API ตอบกลับ 200 OK ปกติ 100%
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {metaErrors.issues.map((issue) => (
                  <div
                    key={issue.id}
                    className={cn(
                      'rounded-lg border p-3.5 flex flex-col gap-2 transition-all',
                      issue.severity === 'high' && 'border-rose-500/40 bg-rose-500/5',
                      issue.severity === 'medium' && 'border-amber-500/40 bg-amber-500/5',
                      issue.severity === 'low' && 'border-blue-500/30 bg-blue-500/5',
                    )}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] px-1.5 py-0 font-bold',
                            issue.severity === 'high' && 'border-rose-500 text-rose-600 bg-rose-500/10',
                            issue.severity === 'medium' && 'border-amber-500 text-amber-600 bg-amber-500/10',
                            issue.severity === 'low' && 'border-blue-500 text-blue-600 bg-blue-500/10',
                          )}
                        >
                          {issue.severity === 'high' ? 'วิกฤต' : issue.severity === 'medium' ? 'ควรระวัง' : 'แจ้งเตือน'}
                        </Badge>
                        <span className="font-semibold text-xs sm:text-sm text-foreground">{issue.title}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-rose-600">พบ {issue.count} ครั้ง</span>
                        <span>• ล่าสุด: {new Date(issue.lastOccurredAt).toLocaleTimeString('th-TH')}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs mt-1">
                      <div className="rounded bg-background/60 p-2 border border-border/50">
                        <span className="font-medium text-foreground block mb-0.5">🔍 สาเหตุ:</span>
                        <p className="text-muted-foreground leading-relaxed">{issue.explanationTh}</p>
                      </div>
                      <div className="rounded bg-background/60 p-2 border border-border/50">
                        <span className="font-medium text-emerald-700 dark:text-emerald-400 block mb-0.5">💡 วิธีแก้ไข & ปรับปรุง:</span>
                        <p className="text-foreground leading-relaxed">{issue.solutionTh}</p>
                      </div>
                    </div>

                    {issue.actionLink && (
                      <div className="flex justify-end pt-1">
                        <Button asChild size="sm" variant="secondary" className="h-7 text-xs gap-1 font-medium">
                          <Link href={issue.actionLink.href}>
                            {issue.actionLink.label} <ArrowRight className="size-3" />
                          </Link>
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* FULL SUBSYSTEM DETAILS (เมื่อกดขยาย) */}
      {expanded && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Subsystem 1: Meta & Pages */}
          <Card className="border-border/70">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <PlatformIcon platform="facebook" className="size-4" />
                  <span>{subsystems.meta.name}</span>
                </div>
                <StatusIcon status={subsystems.meta.status} />
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-1 flex flex-col gap-2 text-xs">
              <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                {subsystems.meta.details.map((d, i) => (
                  <li key={i} className="leading-relaxed">{d}</li>
                ))}
              </ul>
              <div className="pt-2 flex items-center justify-between border-t border-border/50">
                <button
                  type="button"
                  onClick={() => setShowPagesList(!showPagesList)}
                  className="text-[11px] text-primary hover:underline font-medium"
                >
                  {showPagesList ? 'ซ่อนรายชื่อเพจ' : `ดูสถานะเพจทั้ง ${pages.length} เพจ`}
                </button>
                {subsystems.meta.actionLink && (
                  <Link href={subsystems.meta.actionLink.href} className="text-xs text-primary hover:underline flex items-center gap-1 font-medium">
                    {subsystems.meta.actionLink.label} <ArrowRight className="size-3" />
                  </Link>
                )}
              </div>

              {showPagesList && pages.length > 0 && (
                <div className="mt-2 space-y-1.5 rounded-lg border p-2 bg-muted/20">
                  {pages.map((p) => (
                    <div key={p.id} className="flex items-center justify-between py-1 border-b last:border-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <PlatformIcon platform={p.platform === 'instagram' ? 'instagram' : 'facebook'} className="size-3.5 shrink-0" />
                        <span className="font-medium truncate">{p.pageName}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {p.hasToken ? (
                          <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30 py-0">Token พร้อม</Badge>
                        ) : (
                          <Badge variant="destructive" className="text-[10px] py-0">ยังไม่มี Token</Badge>
                        )}
                        {p.liveTest && (
                          <span className={cn('text-[10px]', p.liveTest.ok ? 'text-emerald-600' : 'text-rose-600')} title={p.liveTest.messageTh}>
                            {p.liveTest.ok ? '✓ ตอบกลับ 200' : '✗ ขัดข้อง'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Subsystem 2: Database & Storage */}
          <Card className="border-border/70">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <Database className="size-4 text-emerald-600" />
                  <span>ฐานข้อมูล & ที่เก็บไฟล์ (Supabase)</span>
                </div>
                <StatusIcon status={subsystems.database.status} />
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-1 flex flex-col gap-2 text-xs">
              <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                {subsystems.database.details.map((d, i) => (
                  <li key={i} className="leading-relaxed">{d}</li>
                ))}
                {subsystems.storage.details.map((d, i) => (
                  <li key={`st_${i}`} className="leading-relaxed">{d}</li>
                ))}
              </ul>
              {isOwner && (
                <div className="pt-2 flex justify-end border-t border-border/50">
                  <Link href="/settings/system" className="text-xs text-primary hover:underline flex items-center gap-1 font-medium">
                    จัดการระบบ & ความลับ <ArrowRight className="size-3" />
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Subsystem 3: AI Engine */}
          <Card className="border-border/70">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <Sparkles className="size-4 text-amber-500" />
                  <span>{subsystems.ai.name}</span>
                </div>
                <StatusIcon status={subsystems.ai.status} />
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-1 flex flex-col gap-2 text-xs">
              <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                {subsystems.ai.details.map((d, i) => (
                  <li key={i} className="leading-relaxed">{d}</li>
                ))}
              </ul>
              <div className="pt-2 flex justify-end border-t border-border/50 gap-3">
                <Link href="/settings/ai/assist" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1">
                  เทรนหมวดหมู่ช่วยคิด <ArrowRight className="size-3" />
                </Link>
                <Link href="/settings/ai" className="text-xs text-primary hover:underline flex items-center gap-1 font-medium">
                  ตั้งค่า AI <ArrowRight className="size-3" />
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Subsystem 4: Notifications & Messaging */}
          <Card className="border-border/70">
            <CardHeader className="p-4 pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <Send className="size-4 text-blue-500" />
                  <span>การแจ้งเตือน & คิวการส่ง</span>
                </div>
                <StatusIcon status={subsystems.notifications.status} />
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-1 flex flex-col gap-2 text-xs">
              <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                {subsystems.notifications.details.map((d, i) => (
                  <li key={i} className="leading-relaxed">{d}</li>
                ))}
                {subsystems.messaging.details.map((d, i) => (
                  <li key={`msg_${i}`} className="leading-relaxed">{d}</li>
                ))}
              </ul>
              <div className="pt-2 flex justify-end border-t border-border/50 gap-3">
                <Link href="/send-status" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1">
                  ประวัติการส่ง <ArrowRight className="size-3" />
                </Link>
                <Link href="/settings/notifications" className="text-xs text-primary hover:underline flex items-center gap-1 font-medium">
                  ตั้งค่าแจ้งเตือน <ArrowRight className="size-3" />
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
