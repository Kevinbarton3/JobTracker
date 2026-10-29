import { listen } from '@tauri-apps/api/event';
import { EmailInbox } from './components/Gmail';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { Sidebar, type PageName } from './components/Sidebar';
import { ApplicationForm } from './components/ApplicationForm';
import { ConfirmationDialog, Dialog, ErrorMessage, LoadingIndicator, Toast } from './components/ui';
import { DashboardPage } from './pages/DashboardPage';
import { ApplicationsPage, type SavedView } from './pages/ApplicationsPage';
import { DetailsPage } from './pages/DetailsPage';
import { FollowUpsPage } from './pages/FollowUpsPage';
import { SettingsPage, type Theme } from './pages/SettingsPage';
import { ResumesPage } from './pages/ResumesPage';
import { applicationService } from './services/applicationService';
import {
  ACTIVITY_TYPES,
  ATTACHMENT_KINDS,
  TASK_PRIORITIES,
  TASK_RECURRENCES,
  type Activity,
  type Analytics,
  type ApplicationFilters,
  type ApplicationStatus,
  type Attachment,
  type DashboardStatistics,
  type ImportPreview,
  type JobApplication,
  type NewActivity,
  type NewAttachment,
  type NewJobApplication,
  type NewTask,
  type TaskGroups,
  type TaskItem,
  type Resume,
} from './types/application';

import { initialFilters, emptyStats, emptyTasks, emptyAnalytics } from './state/defaults';
import { nowInput, readJson } from './utils/storage';
type View =
  | { kind: 'page'; page: PageName }
  | { kind: 'details'; application: JobApplication }
  | { kind: 'form'; application?: JobApplication };
type ToastState = { message: string; tone: 'success' | 'error'; undo?: boolean };
type ResumeDraft = {
  id?: number;
  sourcePath?: string;
  name: string;
  notes: string;
  makeCurrent: boolean;
};
export default function App() {
  const [view, setView] = useState<View>(() => ({
    kind: 'page',
    page: readJson<PageName>('jobtrack.page', 'dashboard'),
  }));
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [allApplications, setAllApplications] = useState<JobApplication[]>([]);
  const [statistics, setStatistics] = useState(emptyStats);
  const [tasks, setTasks] = useState(emptyTasks);
  const [analytics, setAnalytics] = useState(emptyAnalytics);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [filters, setFilters] = useState<ApplicationFilters>(() =>
    readJson('jobtrack.filters', initialFilters),
  );
  const [savedViews, setSavedViews] = useState<SavedView[]>(() =>
    readJson('jobtrack.savedViews', []),
  );
  const [theme, setTheme] = useState<Theme>(() => readJson('jobtrack.theme', 'system'));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<ToastState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<JobApplication | 'all' | null>(null);
  const [databasePath, setDatabasePath] = useState('');
  const [backups, setBackups] = useState<string[]>([]);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(
    () => !localStorage.getItem('jobtrack.onboarded'),
  );
  const [activityDraft, setActivityDraft] = useState<NewActivity | null>(null);
  const [taskDraft, setTaskDraft] = useState<NewTask | null>(null);
  const [attachmentDraft, setAttachmentDraft] = useState<NewAttachment | null>(null);
  const [snoozeTarget, setSnoozeTarget] = useState<TaskItem | null>(null);
  const [snoozeValue, setSnoozeValue] = useState(nowInput());
  const [resumeDraft, setResumeDraft] = useState<ResumeDraft | null>(null);
  const [resumeDeleteTarget, setResumeDeleteTarget] = useState<Resume | null>(null);
  const activePage: PageName = view.kind === 'page' ? view.page : 'applications';

  const refreshCore = useCallback(async () => {
    const [all, stats, taskGroups, analyticsValue, backupPaths] = await Promise.all([
      applicationService.getAll(initialFilters),
      applicationService.dashboard(),
      applicationService.tasks(),
      applicationService.analytics(),
      applicationService.listBackups(),
    ]);
    setAllApplications(all);
    setStatistics(stats);
    setTasks(taskGroups);
    setAnalytics(analyticsValue);
    setBackups(backupPaths);
    return taskGroups;
  }, []);
  const loadFiltered = useCallback(
    async (next: ApplicationFilters) => setApplications(await applicationService.getAll(next)),
    [],
  );
  const loadResumes = useCallback(async () => setResumes(await applicationService.resumes()), []);
  const loadDetails = useCallback(async (application: JobApplication) => {
    const [nextActivities, nextAttachments] = await Promise.all([
      applicationService.activities(application.id),
      applicationService.attachments(application.id),
    ]);
    setActivities(nextActivities);
    setAttachments(nextAttachments);
    setView({ kind: 'details', application });
  }, []);
  const notifyTasks = useCallback(async (groups: TaskGroups) => {
    const today = new Date().toISOString().slice(0, 10);
    if (
      localStorage.getItem('jobtrack.notified') === today ||
      (!groups.overdue.length && !groups.dueToday.length)
    )
      return;
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    if (granted) {
      const count = groups.overdue.length + groups.dueToday.length;
      sendNotification({
        title: 'JobTrack tasks',
        body: `${count} task${count === 1 ? '' : 's'} ${groups.overdue.length ? 'are overdue or ' : ''}need attention today.`,
      });
      localStorage.setItem('jobtrack.notified', today);
    }
  }, []);
  const initialize = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await applicationService.initialize();
      const [, groups] = await Promise.all([
        loadFiltered(filters),
        refreshCore(),
        applicationService.databasePath().then(setDatabasePath),
        loadResumes(),
      ]);
      await notifyTasks(groups).catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not initialize the application.');
    } finally {
      setLoading(false);
    }
  }, [filters, loadFiltered, loadResumes, notifyTasks, refreshCore]);

  useEffect(() => {
    void initialize();
  }, []);
  useEffect(() => {
    if (!loading) {
      const timer = window.setTimeout(
        () => loadFiltered(filters).catch((cause) => setError(cause.message)),
        180,
      );
      return () => window.clearTimeout(timer);
    }
  }, [filters, loadFiltered, loading]);
  useEffect(() => {
    localStorage.setItem('jobtrack.filters', JSON.stringify(filters));
  }, [filters]);
  useEffect(() => {
    localStorage.setItem('jobtrack.savedViews', JSON.stringify(savedViews));
  }, [savedViews]);
  useEffect(() => {
    if (view.kind === 'page') localStorage.setItem('jobtrack.page', JSON.stringify(view.page));
  }, [view]);
  useEffect(() => {
    localStorage.setItem('jobtrack.theme', JSON.stringify(theme));
    const resolved =
      theme === 'system'
        ? matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme;
    document.documentElement.dataset.theme = resolved;
  }, [theme]);
  useEffect(() => {
    if (toast) {
      const timer = window.setTimeout(() => setToast(null), toast.undo ? 7000 : 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setView({ kind: 'form' });
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setView({ kind: 'page', page: 'applications' });
        window.setTimeout(() => document.getElementById('application-search')?.focus(), 0);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const reload = async () => {
    await Promise.all([refreshCore(), loadFiltered(filters), loadResumes()]);
  };
  useEffect(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    const bind = async () => {
      for (const [event, callback] of [
        [
          'capture-changed',
          () => {
            void reload();
          },
        ],
        [
          'capture-open',
          (event: { payload: number }) => {
            void applicationService.getOne(event.payload).then(loadDetails);
          },
        ],
      ] as const) {
        try {
          const stop = await listen<number>(event, callback);
          if (disposed) stop();
          else stops.push(stop);
        } catch {
          /* Browser-only fixtures have no native event bridge. */
        }
      }
    };
    void bind();
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
    };
  }, [filters, refreshCore, loadFiltered, loadResumes, loadDetails]);
  const showError = (cause: unknown, fallback: string) =>
    setToast({ message: cause instanceof Error ? cause.message : fallback, tone: 'error' });
  const viewApp = async (application: JobApplication) => {
    try {
      await loadDetails(application);
    } catch (cause) {
      showError(cause, 'Could not load application details.');
    }
  };
  const viewAppById = async (id: number) => {
    const app =
      allApplications.find((item) => item.id === id) || (await applicationService.getOne(id));
    await viewApp(app);
  };
  const editApp = (application: JobApplication) => setView({ kind: 'form', application });
  const save = async (value: NewJobApplication) => {
    setBusy(true);
    try {
      const editing = view.kind === 'form' ? view.application : undefined;
      const matches = await applicationService.duplicates(
        value.company,
        value.position,
        value.jobUrl,
        editing?.id,
      );
      if (
        matches.length &&
        !window.confirm(
          `Possible duplicate: ${matches[0].company} — ${matches[0].position} (${matches[0].reason}). Save anyway?`,
        )
      )
        return;
      const saved = editing
        ? await applicationService.update({ ...value, id: editing.id })
        : await applicationService.create(value);
      await reload();
      await loadDetails(saved);
      setToast({
        message: editing ? 'Application updated.' : 'Application added.',
        tone: 'success',
      });
    } catch (cause) {
      showError(cause, 'Could not save the application.');
      throw cause;
    } finally {
      setBusy(false);
    }
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      if (deleteTarget === 'all') {
        const count = await applicationService.deleteAll();
        setToast({
          message: `${count} application${count === 1 ? '' : 's'} deleted.`,
          tone: 'success',
        });
        setView({ kind: 'page', page: 'settings' });
      } else {
        await applicationService.delete(deleteTarget.id);
        setToast({
          message: `${deleteTarget.company} application deleted.`,
          tone: 'success',
          undo: true,
        });
        setView({ kind: 'page', page: 'applications' });
      }
      setDeleteTarget(null);
      await reload();
    } catch (cause) {
      showError(cause, 'Delete failed.');
    } finally {
      setBusy(false);
    }
  };
  const undoDelete = async () => {
    try {
      const restored = await applicationService.undoDelete();
      await reload();
      setToast({ message: `${restored.company} restored.`, tone: 'success' });
    } catch (cause) {
      showError(cause, 'Could not restore the application.');
    }
  };
  const openActivity = (app: JobApplication) =>
    setActivityDraft({
      applicationId: app.id,
      activityType: 'Note',
      occurredAt: nowInput(),
      participants: null,
      notes: null,
      meetingUrl: null,
      outcome: null,
    });
  const saveActivity = async () => {
    if (!activityDraft) return;
    setBusy(true);
    try {
      await applicationService.createActivity({
        ...activityDraft,
        occurredAt: activityDraft.occurredAt.replace('T', ' ') + ':00',
      });
      setActivities(await applicationService.activities(activityDraft.applicationId));
      setActivityDraft(null);
      await refreshCore();
      setToast({ message: 'Activity added.', tone: 'success' });
    } catch (cause) {
      showError(cause, 'Could not add activity.');
    } finally {
      setBusy(false);
    }
  };
  const removeActivity = async (activity: Activity) => {
    try {
      await applicationService.deleteActivity(activity.id);
      setActivities((items) => items.filter((item) => item.id !== activity.id));
      setToast({ message: 'Activity removed.', tone: 'success' });
    } catch (cause) {
      showError(cause, 'Could not remove activity.');
    }
  };
  const openTask = (application?: JobApplication) => {
    const target = application || (view.kind === 'details' ? view.application : allApplications[0]);
    if (!target) {
      setToast({ message: 'Add an application before creating a task.', tone: 'error' });
      return;
    }
    const tomorrow = new Date(Date.now() + 86_400_000 - new Date().getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
    setTaskDraft({
      applicationId: target.id,
      title: `Follow up with ${target.company}`,
      dueAt: tomorrow,
      priority: 'Normal',
      recurrence: null,
    });
  };
  const saveTask = async () => {
    if (!taskDraft) return;
    setBusy(true);
    try {
      await applicationService.createTask({
        ...taskDraft,
        dueAt: taskDraft.dueAt.replace('T', ' ') + ':00',
      });
      setTaskDraft(null);
      await refreshCore();
      setToast({ message: 'Task added.', tone: 'success' });
    } catch (cause) {
      showError(cause, 'Could not add task.');
    } finally {
      setBusy(false);
    }
  };
  const completeTask = async (task: TaskItem, completed: boolean) => {
    try {
      await applicationService.setTaskCompleted(task.id, completed);
      await refreshCore();
      setToast({ message: completed ? 'Task completed.' : 'Task reopened.', tone: 'success' });
    } catch (cause) {
      showError(cause, 'Could not update task.');
    }
  };
  const saveSnooze = async () => {
    if (!snoozeTarget) return;
    try {
      await applicationService.snoozeTask(snoozeTarget.id, snoozeValue.replace('T', ' ') + ':00');
      setSnoozeTarget(null);
      await refreshCore();
      setToast({ message: 'Task snoozed.', tone: 'success' });
    } catch (cause) {
      showError(cause, 'Could not snooze task.');
    }
  };
  const removeTask = async (task: TaskItem) => {
    try {
      await applicationService.deleteTask(task.id);
      await refreshCore();
      setToast({ message: 'Task deleted.', tone: 'success' });
    } catch (cause) {
      showError(cause, 'Could not delete task.');
    }
  };
  const openAttachment = (app: JobApplication) =>
    setAttachmentDraft({ applicationId: app.id, kind: 'Resume', name: '', filePath: '' });
  const saveAttachment = async () => {
    if (!attachmentDraft) return;
    setBusy(true);
    try {
      await applicationService.createAttachment(attachmentDraft);
      setAttachments(await applicationService.attachments(attachmentDraft.applicationId));
      setAttachmentDraft(null);
      setToast({ message: 'File link added.', tone: 'success' });
    } catch (cause) {
      showError(cause, 'Could not add file link.');
    } finally {
      setBusy(false);
    }
  };
  const removeAttachment = async (attachment: Attachment) => {
    try {
      await applicationService.deleteAttachment(attachment.id);
      setAttachments((items) => items.filter((item) => item.id !== attachment.id));
    } catch (cause) {
      showError(cause, 'Could not remove file link.');
    }
  };
  const currentTasks = useMemo(
    () =>
      view.kind === 'details'
        ? [...tasks.overdue, ...tasks.dueToday, ...tasks.upcoming, ...tasks.completed].filter(
            (task) => task.applicationId === view.application.id,
          )
        : [],
    [tasks, view],
  );
  const priorityTasks = useMemo(
    () => [...tasks.overdue, ...tasks.dueToday, ...tasks.upcoming],
    [tasks],
  );
  const locationSuggestions = useMemo(
    () =>
      [
        ...new Map(
          allApplications.flatMap((application) =>
            application.location?.trim()
              ? [
                  [
                    application.location.trim().toLocaleLowerCase(),
                    application.location.trim(),
                  ] as const,
                ]
              : [],
          ),
        ).values(),
      ].sort((a, b) => a.localeCompare(b)),
    [allApplications],
  );
  const navigateApplications = (status?: ApplicationStatus) => {
    setFilters((current) => ({
      ...current,
      search: '',
      workArrangement: '',
      employmentType: '',
      status: status || '',
    }));
    setView({ kind: 'page', page: 'applications' });
  };
  const bulkStatus = async (ids: number[], status: ApplicationStatus) => {
    try {
      const count = await applicationService.bulkStatus(ids, status);
      await reload();
      setToast({
        message: `${count} application${count === 1 ? '' : 's'} updated.`,
        tone: 'success',
      });
    } catch (cause) {
      showError(cause, 'Could not update applications.');
    }
  };
  const addResume = async () => {
    try {
      const sourcePath = await applicationService.chooseResumeFile();
      if (!sourcePath) return;
      const fileName = sourcePath.split(/[\\/]/).pop() || 'Resume';
      setResumeDraft({
        sourcePath,
        name: fileName.replace(/\.(pdf|docx?)$/i, ''),
        notes: '',
        makeCurrent: resumes.length === 0,
      });
    } catch (cause) {
      showError(cause, 'Could not choose a resume file.');
    }
  };
  const saveResume = async () => {
    if (!resumeDraft || !resumeDraft.name.trim()) return;
    setBusy(true);
    try {
      if (resumeDraft.id) {
        await applicationService.updateResume({
          id: resumeDraft.id,
          name: resumeDraft.name.trim(),
          notes: resumeDraft.notes.trim() || null,
        });
        setToast({ message: 'Resume details updated.', tone: 'success' });
      } else if (resumeDraft.sourcePath) {
        await applicationService.importResume(
          resumeDraft.sourcePath,
          resumeDraft.name.trim(),
          resumeDraft.notes.trim() || null,
          resumeDraft.makeCurrent,
        );
        setToast({ message: 'Resume added to your library.', tone: 'success' });
      }
      const editedId = resumeDraft.id;
      setResumeDraft(null);
      await loadResumes();
      if (editedId && view.kind === 'details' && view.application.resumeId === editedId) {
        setView({
          kind: 'details',
          application: await applicationService.getOne(view.application.id),
        });
      }
    } catch (cause) {
      showError(cause, 'Could not save the resume.');
    } finally {
      setBusy(false);
    }
  };
  const makeCurrentResume = async (resume: Resume) => {
    try {
      await applicationService.setCurrentResume(resume.id);
      await loadResumes();
      setToast({ message: `${resume.name} is now current.`, tone: 'success' });
    } catch (cause) {
      showError(cause, 'Could not update the current resume.');
    }
  };
  const confirmResumeDelete = async () => {
    if (!resumeDeleteTarget) return;
    setBusy(true);
    try {
      const count = await applicationService.deleteResume(resumeDeleteTarget.id);
      setToast({
        message: count
          ? `Resume deleted. ${count} application${count === 1 ? '' : 's'} retain the historical label.`
          : 'Resume deleted.',
        tone: 'success',
      });
      setResumeDeleteTarget(null);
      await Promise.all([loadResumes(), loadFiltered(filters), refreshCore()]);
      if (view.kind === 'details' && view.application.resumeId === resumeDeleteTarget.id) {
        setView({
          kind: 'details',
          application: await applicationService.getOne(view.application.id),
        });
      }
    } catch (cause) {
      showError(cause, 'Could not delete the resume.');
    } finally {
      setBusy(false);
    }
  };
  const assignResume = async (application: JobApplication, resumeId: number | null) => {
    try {
      const updated = await applicationService.assignApplicationResume(application.id, resumeId);
      setView({ kind: 'details', application: updated });
      await Promise.all([loadFiltered(filters), refreshCore(), loadResumes()]);
      setToast({
        message: resumeId ? 'Resume assignment updated.' : 'Resume assignment cleared.',
        tone: 'success',
      });
    } catch (cause) {
      showError(cause, 'Could not update the resume assignment.');
    }
  };
  const dataAction = async (
    action: () => Promise<string | number>,
    success: (value: string | number) => string,
    reloadAfter = false,
  ) => {
    setBusy(true);
    try {
      const value = await action();
      if (reloadAfter) await reload();
      setBackups(await applicationService.listBackups());
      setToast({ message: success(value), tone: 'success' });
    } catch (cause) {
      showError(cause, 'The data operation failed.');
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return (
      <div className="startup">
        <div className="brand startup-brand">JobTrack</div>
        <LoadingIndicator label="Opening your local database…" />
      </div>
    );
  if (error && !allApplications.length)
    return (
      <div className="startup">
        <ErrorMessage message={error} onRetry={initialize} />
        <p className="startup-hint">
          Make sure the app is running through Tauri, not only in a browser.
        </p>
      </div>
    );
  return (
    <div className="app-shell">
      <Sidebar page={activePage} onNavigate={(page) => setView({ kind: 'page', page })} />
      <div className="content-shell">
        <main className="page-content">
          {error && (
            <ErrorMessage
              message={error}
              onRetry={() => {
                setError('');
                void reload();
              }}
            />
          )}
          {view.kind === 'page' && view.page === 'dashboard' && (
            <DashboardPage
              statistics={statistics}
              analytics={analytics}
              recent={allApplications}
              tasks={priorityTasks}
              onAdd={() => setView({ kind: 'form' })}
              onView={viewApp}
              onOpenApplications={navigateApplications}
              onOpenTasks={() => setView({ kind: 'page', page: 'follow-ups' })}
            />
          )}
          {view.kind === 'page' && view.page === 'applications' && (
            <ApplicationsPage
              totalCount={allApplications.length}
              applications={applications}
              filters={filters}
              savedViews={savedViews}
              onSavedViews={setSavedViews}
              onFilters={setFilters}
              onAdd={() => setView({ kind: 'form' })}
              onView={viewApp}
              onEdit={editApp}
              onDelete={setDeleteTarget}
              onBulkStatus={bulkStatus}
            />
          )}
          {view.kind === 'page' && view.page === 'follow-ups' && (
            <FollowUpsPage
              groups={tasks}
              onView={viewAppById}
              onAdd={() => openTask()}
              onComplete={completeTask}
              onSnooze={(task) => {
                setSnoozeTarget(task);
                setSnoozeValue(nowInput());
              }}
              onDelete={removeTask}
            />
          )}
          {view.kind === 'page' && view.page === 'resumes' && (
            <ResumesPage
              resumes={resumes}
              busy={busy}
              onAdd={() => void addResume()}
              onOpen={(resume) =>
                void applicationService
                  .openResume(resume.id)
                  .catch((cause) => showError(cause, 'Could not open the resume.'))
              }
              onEdit={(resume) =>
                setResumeDraft({
                  id: resume.id,
                  name: resume.name,
                  notes: resume.notes || '',
                  makeCurrent: false,
                })
              }
              onCurrent={(resume) => void makeCurrentResume(resume)}
              onDelete={setResumeDeleteTarget}
            />
          )}
          {view.kind === 'page' && view.page === 'email' && (
            <EmailInbox applications={allApplications} onChanged={() => void reload()} />
          )}
          {view.kind === 'page' && view.page === 'settings' && (
            <SettingsPage
              databasePath={databasePath}
              backups={backups}
              busy={busy}
              theme={theme}
              importPreview={importPreview}
              onTheme={setTheme}
              onSamples={() =>
                void dataAction(
                  applicationService.insertSampleData,
                  (value) => `${value} sample applications added.`,
                  true,
                )
              }
              onDeleteAll={() => setDeleteTarget('all')}
              onBackup={(path) =>
                void dataAction(
                  () => applicationService.createBackup(path),
                  (value) => `Backup created at ${value}.`,
                )
              }
              onRestore={(path) =>
                void dataAction(
                  () => applicationService.restoreBackup(path),
                  (value) => String(value),
                  true,
                )
              }
              onExport={(path) =>
                void dataAction(
                  () => applicationService.exportCsv(path),
                  (value) => `CSV exported to ${value}.`,
                )
              }
              onPreviewImport={(path) =>
                void applicationService
                  .previewCsv(path)
                  .then(setImportPreview)
                  .catch((cause) => showError(cause, 'Could not preview CSV.'))
              }
              onImport={(path) =>
                void dataAction(
                  () => applicationService.importCsv(path),
                  (value) => `${value} applications imported.`,
                  true,
                )
              }
            />
          )}
          {view.kind === 'details' && (
            <DetailsPage
              application={view.application}
              activities={activities}
              attachments={attachments}
              tasks={currentTasks}
              resumes={resumes}
              onBack={() => setView({ kind: 'page', page: 'applications' })}
              onEdit={() => editApp(view.application)}
              onDelete={() => setDeleteTarget(view.application)}
              onAddActivity={() => openActivity(view.application)}
              onDeleteActivity={removeActivity}
              onAddTask={() => openTask(view.application)}
              onAddAttachment={() => openAttachment(view.application)}
              onDeleteAttachment={removeAttachment}
              onResume={(resumeId) => void assignResume(view.application, resumeId)}
              onOpenResume={(id) =>
                void applicationService
                  .openResume(id)
                  .catch((cause) => showError(cause, 'Could not open the resume.'))
              }
              onOpenUrl={(url) =>
                void applicationService
                  .openUrl(url)
                  .catch((cause) => showError(cause, 'Could not open link.'))
              }
              onOpenPath={(path) =>
                void applicationService
                  .openPath(path)
                  .catch((cause) => showError(cause, 'Could not open file.'))
              }
            />
          )}
          {view.kind === 'details' && (
            <EmailInbox
              applications={allApplications}
              applicationId={view.application.id}
              onChanged={() => {
                void reload();
                void applicationService.getOne(view.application.id).then(loadDetails);
              }}
            />
          )}
          {view.kind === 'form' && (
            <>
              <header className="page-header form-page-header">
                <div>
                  <p className="eyebrow">
                    {view.application ? 'Update opportunity' : 'Quick entry'}
                  </p>
                  <h1>
                    {view.application ? `Edit ${view.application.company}` : 'Add application'}
                  </h1>
                  <p>
                    {view.application
                      ? 'Keep this opportunity current.'
                      : 'Company and position are enough to get started.'}
                  </p>
                </div>
              </header>
              <ApplicationForm
                initial={view.application}
                resumes={resumes}
                defaultResumeId={resumes.find((resume) => resume.isCurrent)?.id ?? null}
                locationSuggestions={locationSuggestions}
                submitting={busy}
                onSubmit={save}
                onCancel={() =>
                  setView(
                    view.application
                      ? { kind: 'details', application: view.application }
                      : { kind: 'page', page: 'applications' },
                  )
                }
              />
            </>
          )}
        </main>
      </div>
      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget === 'all' ? 'Delete every application?' : 'Delete this application?'}
        message={
          deleteTarget === 'all'
            ? 'This permanently removes all applications, activities, tasks, and file links. Create a backup first if you may need them.'
            : `This removes the application for ${deleteTarget ? deleteTarget.company : ''}. You can undo this briefly afterward.`
        }
        confirmLabel={
          busy ? 'Deleting…' : deleteTarget === 'all' ? 'Delete all data' : 'Delete application'
        }
        onCancel={() => !busy && setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
      <ConfirmationDialog
        open={Boolean(resumeDeleteTarget)}
        title="Delete this resume?"
        message={
          resumeDeleteTarget
            ? `JobTrack will remove its managed file.${resumeDeleteTarget.usageCount ? ` ${resumeDeleteTarget.usageCount} application${resumeDeleteTarget.usageCount === 1 ? '' : 's'} will keep “${resumeDeleteTarget.name}” as a deleted history label.` : ''}`
            : ''
        }
        confirmLabel={busy ? 'Deleting…' : 'Delete resume'}
        onCancel={() => !busy && setResumeDeleteTarget(null)}
        onConfirm={confirmResumeDelete}
      />
      {resumeDraft && (
        <Dialog
          title={resumeDraft.id ? 'Edit resume details' : 'Add resume'}
          onClose={() => !busy && setResumeDraft(null)}
          wide
        >
          {resumeDraft.sourcePath && (
            <p className="resume-source">
              Selected file: <strong>{resumeDraft.sourcePath.split(/[\\/]/).pop()}</strong>
            </p>
          )}
          <div className="dialog-form">
            <label className="field full">
              <span>Resume name</span>
              <input
                autoFocus
                value={resumeDraft.name}
                onChange={(event) => setResumeDraft({ ...resumeDraft, name: event.target.value })}
                placeholder="e.g. Product design resume"
              />
            </label>
            <label className="field full">
              <span>Notes</span>
              <textarea
                rows={4}
                value={resumeDraft.notes}
                onChange={(event) => setResumeDraft({ ...resumeDraft, notes: event.target.value })}
                placeholder="Target role, strengths, or changes in this version"
              />
            </label>
            {!resumeDraft.id && (
              <label className="check-label full">
                <input
                  type="checkbox"
                  checked={resumeDraft.makeCurrent}
                  onChange={(event) =>
                    setResumeDraft({ ...resumeDraft, makeCurrent: event.target.checked })
                  }
                />
                <span>Make this my current resume</span>
              </label>
            )}
          </div>
          <div className="dialog-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setResumeDraft(null)}
            >
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy || !resumeDraft.name.trim()}
              onClick={saveResume}
            >
              {busy ? 'Saving…' : resumeDraft.id ? 'Save changes' : 'Add resume'}
            </button>
          </div>
        </Dialog>
      )}
      {showOnboarding && (
        <Dialog
          title="Welcome to JobTrack v2"
          onClose={() => {
            localStorage.setItem('jobtrack.onboarded', '1');
            setShowOnboarding(false);
          }}
          wide
        >
          <div className="onboarding">
            <span className="settings-icon">
              <Plus size={22} />
            </span>
            <h3>Your search now has a memory.</h3>
            <p>
              Add opportunities, record every conversation and interview, and turn next steps into
              tasks. JobTrack creates a local backup each day; you can export or restore from
              Settings at any time.
            </p>
            <div className="dialog-actions">
              <button
                className="button primary"
                onClick={() => {
                  localStorage.setItem('jobtrack.onboarded', '1');
                  setShowOnboarding(false);
                }}
              >
                Start tracking
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {activityDraft && (
        <Dialog title="Add activity" onClose={() => setActivityDraft(null)} wide>
          <div className="dialog-form">
            <label className="field">
              <span>Type</span>
              <select
                value={activityDraft.activityType}
                onChange={(event) =>
                  setActivityDraft({
                    ...activityDraft,
                    activityType: event.target.value as NewActivity['activityType'],
                  })
                }
              >
                {ACTIVITY_TYPES.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Date and time</span>
              <input
                type="datetime-local"
                value={activityDraft.occurredAt}
                onChange={(event) =>
                  setActivityDraft({ ...activityDraft, occurredAt: event.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Participants</span>
              <input
                value={activityDraft.participants || ''}
                onChange={(event) =>
                  setActivityDraft({ ...activityDraft, participants: event.target.value || null })
                }
              />
            </label>
            <label className="field">
              <span>Meeting link</span>
              <input
                value={activityDraft.meetingUrl || ''}
                onChange={(event) =>
                  setActivityDraft({ ...activityDraft, meetingUrl: event.target.value || null })
                }
              />
            </label>
            <label className="field full">
              <span>Notes</span>
              <textarea
                rows={4}
                value={activityDraft.notes || ''}
                onChange={(event) =>
                  setActivityDraft({ ...activityDraft, notes: event.target.value || null })
                }
              />
            </label>
            <label className="field full">
              <span>Outcome</span>
              <input
                value={activityDraft.outcome || ''}
                onChange={(event) =>
                  setActivityDraft({ ...activityDraft, outcome: event.target.value || null })
                }
              />
            </label>
          </div>
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setActivityDraft(null)}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy || !activityDraft.occurredAt}
              onClick={saveActivity}
            >
              Add activity
            </button>
          </div>
        </Dialog>
      )}
      {taskDraft && (
        <Dialog title="Add task" onClose={() => setTaskDraft(null)} wide>
          <div className="dialog-form">
            <label className="field full">
              <span>Application</span>
              <select
                value={taskDraft.applicationId}
                onChange={(event) =>
                  setTaskDraft({ ...taskDraft, applicationId: Number(event.target.value) })
                }
              >
                {allApplications.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.company} — {app.position}
                  </option>
                ))}
              </select>
            </label>
            <label className="field full">
              <span>Task title</span>
              <input
                value={taskDraft.title}
                onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Due</span>
              <input
                type="datetime-local"
                value={taskDraft.dueAt}
                onChange={(event) => setTaskDraft({ ...taskDraft, dueAt: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Priority</span>
              <select
                value={taskDraft.priority}
                onChange={(event) =>
                  setTaskDraft({
                    ...taskDraft,
                    priority: event.target.value as NewTask['priority'],
                  })
                }
              >
                {TASK_PRIORITIES.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Repeat</span>
              <select
                value={taskDraft.recurrence || ''}
                onChange={(event) =>
                  setTaskDraft({
                    ...taskDraft,
                    recurrence: (event.target.value as NewTask['recurrence']) || null,
                  })
                }
              >
                <option value="">Does not repeat</option>
                {TASK_RECURRENCES.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setTaskDraft(null)}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy || !taskDraft.title.trim() || !taskDraft.dueAt}
              onClick={saveTask}
            >
              Add task
            </button>
          </div>
        </Dialog>
      )}
      {attachmentDraft && (
        <Dialog title="Add local file link" onClose={() => setAttachmentDraft(null)} wide>
          <p>JobTrack stores only the path. It does not copy or upload the file.</p>
          <div className="dialog-form">
            <label className="field">
              <span>Document type</span>
              <select
                value={attachmentDraft.kind}
                onChange={(event) =>
                  setAttachmentDraft({
                    ...attachmentDraft,
                    kind: event.target.value as NewAttachment['kind'],
                  })
                }
              >
                {ATTACHMENT_KINDS.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Display name</span>
              <input
                value={attachmentDraft.name}
                onChange={(event) =>
                  setAttachmentDraft({ ...attachmentDraft, name: event.target.value })
                }
              />
            </label>
            <label className="field full">
              <span>Full file path</span>
              <input
                value={attachmentDraft.filePath}
                onChange={(event) =>
                  setAttachmentDraft({ ...attachmentDraft, filePath: event.target.value })
                }
                placeholder="C:\Users\you\Documents\resume.pdf"
              />
            </label>
          </div>
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setAttachmentDraft(null)}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy || !attachmentDraft.name.trim() || !attachmentDraft.filePath.trim()}
              onClick={saveAttachment}
            >
              Add file link
            </button>
          </div>
        </Dialog>
      )}
      {snoozeTarget && (
        <Dialog title={`Snooze “${snoozeTarget.title}”`} onClose={() => setSnoozeTarget(null)}>
          <label className="field">
            <span>Remind me at</span>
            <input
              type="datetime-local"
              value={snoozeValue}
              onChange={(event) => setSnoozeValue(event.target.value)}
            />
          </label>
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setSnoozeTarget(null)}>
              Cancel
            </button>
            <button className="button primary" onClick={saveSnooze}>
              Snooze
            </button>
          </div>
        </Dialog>
      )}
      {toast && (
        <Toast
          message={toast.message}
          tone={toast.tone}
          onClose={() => setToast(null)}
          action={
            toast.undo ? (
              <button className="toast-action" onClick={undoDelete}>
                Undo
              </button>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
