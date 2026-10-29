export interface CapturePreview {
  company: string;
  position: string;
  location: string;
  workArrangement: '' | 'On-site' | 'Hybrid' | 'Remote';
  employmentType: '' | 'Full-time' | 'Part-time' | 'Contract' | 'Internship' | 'Temporary';
  salaryRange: string;
  jobUrl: string;
  source: 'LinkedIn' | 'Indeed' | 'Company Website' | 'Other';
  description: string;
  resumeId: string;
}
export interface ExistingMatch {
  id: number;
  company: string;
  position: string;
  status: string;
  exact: boolean;
}
export type SaveResult = { id: number } | { matches: ExistingMatch[] };
export type CaptureRequest = { version: 1 } & (
  | { action: 'ping' | 'resumes' }
  | { action: 'open'; id: number }
  | {
      action: 'save' | 'duplicates';
      requestId: string;
      mode: 'save' | 'applied';
      draft: CapturePreview;
      allowDuplicate?: boolean;
      existingId?: number | null;
    }
);
export type NativeResponse<T> = { ok: true; data: T } | { ok: false; error: string };
