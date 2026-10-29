import { invoke } from '@tauri-apps/api/core';
import type {
  Activity,
  Analytics,
  ApplicationFilters,
  Attachment,
  DashboardStatistics,
  DuplicateMatch,
  ImportPreview,
  JobApplication,
  NewActivity,
  NewAttachment,
  NewJobApplication,
  NewTask,
  Resume,
  ResumeUpdate,
  TaskGroups,
  TaskItem,
  UpdateJobApplication,
} from '../types/application';

const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : 'An unexpected database error occurred.';
async function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    console.error(`[${command}]`, error);
    throw new Error(message(error));
  }
}

export const applicationService = {
  initialize: () => call<string>('initialize_database'),
  getAll: (filters: ApplicationFilters) => call<JobApplication[]>('get_applications', { filters }),
  getOne: (id: number) => call<JobApplication>('get_application', { id }),
  create: (application: NewJobApplication) =>
    call<JobApplication>('create_application', { application }),
  update: (application: UpdateJobApplication) =>
    call<JobApplication>('update_application', { application }),
  delete: (id: number) => call<void>('delete_application', { id }),
  undoDelete: () => call<JobApplication>('undo_last_delete'),
  bulkStatus: (ids: number[], status: string) =>
    call<number>('bulk_update_status', { ids, status }),
  duplicates: (company: string, position: string, jobUrl: string | null, excludeId?: number) =>
    call<DuplicateMatch[]>('check_duplicates', { company, position, jobUrl, excludeId }),
  dashboard: () => call<DashboardStatistics>('get_dashboard_statistics'),
  activities: (applicationId: number) => call<Activity[]>('get_activities', { applicationId }),
  createActivity: (activity: NewActivity) => call<Activity>('create_activity', { activity }),
  deleteActivity: (id: number) => call<void>('delete_activity', { id }),
  tasks: () => call<TaskGroups>('get_tasks'),
  createTask: (task: NewTask) => call<TaskItem>('create_task', { task }),
  setTaskCompleted: (id: number, completed: boolean) =>
    call<TaskItem>('set_task_completed', { id, completed }),
  snoozeTask: (id: number, snoozedUntil: string | null) =>
    call<TaskItem>('snooze_task', { id, snoozedUntil }),
  deleteTask: (id: number) => call<void>('delete_task', { id }),
  attachments: (applicationId: number) => call<Attachment[]>('get_attachments', { applicationId }),
  createAttachment: (attachment: NewAttachment) =>
    call<Attachment>('create_attachment', { attachment }),
  deleteAttachment: (id: number) => call<void>('delete_attachment', { id }),
  chooseResumeFile: () => call<string | null>('choose_resume_file'),
  resumes: () => call<Resume[]>('get_resumes'),
  importResume: (sourcePath: string, name: string, notes: string | null, makeCurrent: boolean) =>
    call<Resume>('import_resume', { sourcePath, name, notes, makeCurrent }),
  updateResume: (resume: ResumeUpdate) => call<void>('update_resume', { resume }),
  setCurrentResume: (id: number) => call<void>('set_current_resume', { id }),
  assignApplicationResume: (applicationId: number, resumeId: number | null) =>
    call<JobApplication>('assign_application_resume', { applicationId, resumeId }),
  deleteResume: (id: number) => call<number>('delete_resume', { id }),
  openResume: (id: number) => call<void>('open_resume', { id }),
  openPath: (path: string) => call<void>('open_path', { path }),
  createBackup: (path?: string) => call<string>('create_backup', { path: path || null }),
  listBackups: () => call<string[]>('list_backups'),
  restoreBackup: (path: string) => call<string>('restore_backup', { path }),
  exportCsv: (path?: string) => call<string>('export_csv', { path: path || null }),
  previewCsv: (path: string) => call<ImportPreview>('preview_csv_import', { path }),
  importCsv: (path: string, skipDuplicates = true) =>
    call<number>('import_csv', { path, skipDuplicates }),
  analytics: () => call<Analytics>('get_analytics'),
  insertSampleData: () => call<number>('insert_sample_data'),
  deleteAll: () => call<number>('delete_all_applications'),
  databasePath: () => call<string>('get_database_path'),
  openUrl: (url: string) => call<void>('open_url', { url }),
};
