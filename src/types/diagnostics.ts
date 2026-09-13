export type DiagnosticItemStatus = 'healthy' | 'warning' | 'error';

export type SubsystemDiagnostic = {
  id: string;
  name: string;
  status: DiagnosticItemStatus;
  summary: string;
  details: string[];
  actionLink?: { href: string; label: string };
};

export type MetaErrorIssue = {
  id: string;
  title: string;
  code: number | null;
  subcode: number | null;
  count: number;
  lastOccurredAt: string;
  severity: 'high' | 'medium' | 'low';
  explanationTh: string;
  solutionTh: string;
  actionLink?: { href: string; label: string };
};

export type PageDiagnosticItem = {
  id: string;
  platform: string;
  pageId: string;
  pageName: string;
  isActive: boolean;
  hasToken: boolean;
  liveTest?: { ok: boolean; messageTh: string };
};

export type SystemDiagnosticsReport = {
  overallStatus: DiagnosticItemStatus;
  overallScore: number;
  checkedAt: string;
  subsystems: {
    meta: SubsystemDiagnostic;
    database: SubsystemDiagnostic;
    storage: SubsystemDiagnostic;
    ai: SubsystemDiagnostic;
    notifications: SubsystemDiagnostic;
    messaging: SubsystemDiagnostic;
  };
  metaErrors: {
    totalSends24h: number;
    successfulSends24h: number;
    failedSends24h: number;
    policyBlocked24h: number;
    issues: MetaErrorIssue[];
  };
  pages: PageDiagnosticItem[];
};
