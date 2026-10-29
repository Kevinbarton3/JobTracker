export const STATUSES = [
  'Interested',
  'Applied',
  'Phone Screen',
  'Interviewing',
  'Offer',
  'Rejected',
  'Withdrawn',
] as const;
export const WORK_ARRANGEMENTS = ['On-site', 'Hybrid', 'Remote'] as const;
export const EMPLOYMENT_TYPES = [
  'Full-time',
  'Part-time',
  'Internship',
  'Contract',
  'Temporary',
] as const;
export const SOURCES = [
  'LinkedIn',
  'Indeed',
  'Company Website',
  'Recruiter',
  'Referral',
  'Handshake',
  'Other',
] as const;
export const ACTIVITY_TYPES = [
  'Application',
  'Status Change',
  'Email',
  'Phone Screen',
  'Interview',
  'Offer',
  'Rejection',
  'Note',
] as const;
export const TASK_PRIORITIES = ['Low', 'Normal', 'High'] as const;
export const TASK_RECURRENCES = ['Daily', 'Weekly', 'Monthly'] as const;
export const ATTACHMENT_KINDS = [
  'Resume',
  'Cover Letter',
  'Portfolio',
  'Job Description',
  'Other',
] as const;

export type ApplicationStatus = (typeof STATUSES)[number];
export type WorkArrangement = (typeof WORK_ARRANGEMENTS)[number];
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export type Source = (typeof SOURCES)[number];
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskRecurrence = (typeof TASK_RECURRENCES)[number];
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export interface JobApplication {
  id: number;
  company: string;
  position: string;
  status: ApplicationStatus;
  location: string | null;
  workArrangement: WorkArrangement | null;
  employmentType: EmploymentType | null;
  jobUrl: string | null;
  salaryRange: string | null;
  contactName: string | null;
  contactEmail: string | null;
  dateApplied: string | null;
  followUpDate: string | null;
  followUpCompleted: boolean;
  interviewDate: string | null;
  source: Source | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  resumeId: number | null;
  resumeName: string | null;
  resumeDeleted: boolean;
}

export interface NewJobApplication {
  company: string;
  position: string;
  status: ApplicationStatus;
  location: string | null;
  workArrangement: WorkArrangement | null;
  employmentType: EmploymentType | null;
  jobUrl: string | null;
  salaryRange: string | null;
  contactName: string | null;
  contactEmail: string | null;
  dateApplied: string | null;
  followUpDate: string | null;
  followUpCompleted: boolean;
  interviewDate: string | null;
  source: Source | null;
  notes: string | null;
  resumeId: number | null;
}

export type UpdateJobApplication = NewJobApplication & { id: number };

export interface DashboardStatistics {
  total: number;
  submittedThisWeek: number;
  activeInterviews: number;
  offers: number;
  requiringFollowUp: number;
  rejections: number;
  statusBreakdown: Record<ApplicationStatus, number>;
  responseRate: number;
  interviewRate: number;
  offerRate: number;
  rejectionRate: number;
  averageDaysToFirstResponse: number | null;
}

export type SortField = 'company' | 'dateApplied' | 'followUpDate' | 'updatedAt';
export interface ApplicationFilters {
  search: string;
  status: ApplicationStatus | '';
  workArrangement: WorkArrangement | '';
  employmentType: EmploymentType | '';
  sortBy: SortField;
  sortDirection: 'asc' | 'desc';
}

export interface FollowUpGroups {
  overdue: JobApplication[];
  dueToday: JobApplication[];
  upcoming: JobApplication[];
  completedOrInactive: JobApplication[];
}

export interface Activity {
  id: number;
  applicationId: number;
  activityType: ActivityType;
  occurredAt: string;
  participants: string | null;
  notes: string | null;
  meetingUrl: string | null;
  outcome: string | null;
  fromStatus: ApplicationStatus | null;
  toStatus: ApplicationStatus | null;
  createdAt: string;
}

export interface NewActivity {
  applicationId: number;
  activityType: ActivityType;
  occurredAt: string;
  participants: string | null;
  notes: string | null;
  meetingUrl: string | null;
  outcome: string | null;
}

export interface TaskItem {
  id: number;
  applicationId: number;
  title: string;
  dueAt: string;
  completed: boolean;
  priority: TaskPriority;
  recurrence: TaskRecurrence | null;
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  company: string;
  position: string;
  status: ApplicationStatus;
}

export interface NewTask {
  applicationId: number;
  title: string;
  dueAt: string;
  priority: TaskPriority;
  recurrence: TaskRecurrence | null;
}

export interface TaskGroups {
  overdue: TaskItem[];
  dueToday: TaskItem[];
  upcoming: TaskItem[];
  completed: TaskItem[];
}

export interface Attachment {
  id: number;
  applicationId: number;
  kind: AttachmentKind;
  name: string;
  filePath: string;
  createdAt: string;
  fileExists: boolean;
}

export interface NewAttachment {
  applicationId: number;
  kind: AttachmentKind;
  name: string;
  filePath: string;
}

export interface Resume {
  id: number;
  name: string;
  notes: string | null;
  originalFileName: string;
  storedFileName: string;
  createdAt: string;
  isCurrent: boolean;
  usageCount: number;
  fileExists: boolean;
}

export interface ResumeUpdate {
  id: number;
  name: string;
  notes: string | null;
}

export interface DuplicateMatch {
  id: number;
  company: string;
  position: string;
  reason: string;
}

export interface ImportPreview {
  total: number;
  valid: number;
  duplicates: number;
  errors: string[];
}

export interface OutcomeBreakdown {
  label: string;
  total: number;
  interviews: number;
  offers: number;
}

export interface Analytics {
  bySource: OutcomeBreakdown[];
  byWorkArrangement: OutcomeBreakdown[];
  averageStageDays: Partial<Record<ApplicationStatus, number>>;
}
