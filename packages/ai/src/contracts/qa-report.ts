export type QAIssueSeverity =
  | 'info'
  | 'warning'
  | 'error'
  | 'critical';

export interface QAIssue {
  code: string;
  severity: QAIssueSeverity;
  message: string;
  pageId?: string;
  blockId?: string;
  recommendation?: string;
}

export interface QAReport {
  passed: boolean;
  score: number;
  issues: QAIssue[];
  checkedAt: string;
  notes?: string;
}
