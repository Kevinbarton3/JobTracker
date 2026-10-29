import {
  ArrowLeft,
  CalendarPlus,
  ExternalLink,
  FileText,
  Mail,
  MapPin,
  MessageSquarePlus,
  Paperclip,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { Activity, Attachment, JobApplication, Resume, TaskItem } from '../types/application';
import { formatDate, isValidUrl } from '../utils/format';
import { EmptyState, StatusBadge } from '../components/ui';

interface Props {
  application: JobApplication;
  activities: Activity[];
  attachments: Attachment[];
  tasks: TaskItem[];
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddActivity: () => void;
  onDeleteActivity: (activity: Activity) => void;
  onAddTask: () => void;
  onAddAttachment: () => void;
  onDeleteAttachment: (attachment: Attachment) => void;
  onOpenUrl: (url: string) => void;
  onOpenPath: (path: string) => void;
  resumes: Resume[];
  onResume: (resumeId: number | null) => void;
  onOpenResume: (id: number) => void;
}

const dateTime = (value: string) => formatDate(value, true);

export function DetailsPage({
  application: app,
  activities,
  attachments,
  tasks,
  onBack,
  onEdit,
  onDelete,
  onAddActivity,
  onDeleteActivity,
  onAddTask,
  onAddAttachment,
  onDeleteAttachment,
  onOpenUrl,
  onOpenPath,
  resumes,
  onResume,
  onOpenResume,
}: Props) {
  const field = (label: string, value: string | null) => (
    <div className="detail-field">
      <span>{label}</span>
      <strong>{value || '—'}</strong>
    </div>
  );
  return (
    <>
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={18} />
        Back to applications
      </button>
      <header className="detail-hero">
        <div className="detail-title">
          <span className="company-avatar large">{app.company.slice(0, 2).toUpperCase()}</span>
          <div>
            <div className="title-badges">
              <StatusBadge status={app.status} />
              {app.workArrangement && <span className="neutral-badge">{app.workArrangement}</span>}
            </div>
            <h1>{app.position}</h1>
            <p>
              {app.company}
              {app.location && (
                <>
                  <span>·</span>
                  <MapPin size={15} />
                  {app.location}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="detail-actions">
          <button className="button secondary" onClick={onEdit}>
            <Pencil size={17} />
            Edit
          </button>
          {app.jobUrl && isValidUrl(app.jobUrl) && (
            <button className="button secondary" onClick={() => onOpenUrl(app.jobUrl!)}>
              <ExternalLink size={17} />
              Open posting
            </button>
          )}
          <button className="icon-button danger-text" onClick={onDelete} title="Delete application">
            <Trash2 size={18} />
          </button>
        </div>
      </header>
      <div className="detail-layout">
        <main>
          <section className="panel detail-panel">
            <div className="panel-heading">
              <div>
                <h2>Application details</h2>
                <p>Role and employment information</p>
              </div>
            </div>
            <div className="detail-grid">
              {field('Company', app.company)}
              {field('Position', app.position)}
              {field('Location', app.location)}
              {field('Work arrangement', app.workArrangement)}
              {field('Employment type', app.employmentType)}
              {field('Salary range', app.salaryRange)}
              {field('Source', app.source)}
            </div>
          </section>
          <section className="panel detail-panel">
            <div className="panel-heading">
              <div>
                <h2>Activity timeline</h2>
                <p>Conversations, interviews, decisions, and status history</p>
              </div>
              <button className="button secondary small" onClick={onAddActivity}>
                <MessageSquarePlus size={16} />
                Add activity
              </button>
            </div>
            {activities.length ? (
              <div className="timeline-list">
                {activities.map((activity) => (
                  <article key={activity.id}>
                    <span
                      className={`timeline-dot activity-${activity.activityType.toLowerCase().replaceAll(' ', '-')}`}
                    />
                    <div>
                      <div className="timeline-title">
                        <strong>{activity.activityType}</strong>
                        <time>{dateTime(activity.occurredAt)}</time>
                      </div>
                      {activity.fromStatus && activity.toStatus && (
                        <p>
                          {activity.fromStatus} → {activity.toStatus}
                        </p>
                      )}
                      {activity.participants && <small>With {activity.participants}</small>}
                      {activity.notes && <p>{activity.notes}</p>}
                      {activity.outcome && <small>Outcome: {activity.outcome}</small>}
                      {activity.meetingUrl && (
                        <button
                          className="text-button"
                          onClick={() => onOpenUrl(activity.meetingUrl!)}
                        >
                          Open meeting link
                        </button>
                      )}
                    </div>
                    <button
                      className="icon-button danger-text"
                      onClick={() => onDeleteActivity(activity)}
                      aria-label="Delete activity"
                    >
                      <Trash2 size={15} />
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No activity yet"
                description="Add a conversation, interview, or note to build the timeline."
              />
            )}
          </section>
          <section className="panel detail-panel">
            <div className="panel-heading">
              <div>
                <h2>Documents</h2>
                <p>Links to files stored on this computer</p>
              </div>
              <button className="button secondary small" onClick={onAddAttachment}>
                <Paperclip size={16} />
                Add file link
              </button>
            </div>
            {attachments.length ? (
              <div className="attachment-list">
                {attachments.map((file) => (
                  <article key={file.id}>
                    <FileText size={18} />
                    <button onClick={() => onOpenPath(file.filePath)} disabled={!file.fileExists}>
                      <strong>{file.name}</strong>
                      <small>
                        {file.kind} · {file.fileExists ? file.filePath : 'File missing'}
                      </small>
                    </button>
                    <button
                      className="icon-button danger-text"
                      onClick={() => onDeleteAttachment(file)}
                      aria-label={`Remove ${file.name}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <p className="inline-empty padded-empty">No file links added.</p>
            )}
          </section>
          <section className="panel detail-panel">
            <div className="panel-heading">
              <div>
                <h2>Contact</h2>
                <p>Recruiter or hiring team details</p>
              </div>
            </div>
            <div className="detail-grid">
              {field('Contact name', app.contactName)}
              <div className="detail-field">
                <span>Contact email</span>
                {app.contactEmail ? (
                  <a href={`mailto:${app.contactEmail}`}>
                    <Mail size={15} />
                    {app.contactEmail}
                  </a>
                ) : (
                  <strong>—</strong>
                )}
              </div>
            </div>
          </section>
          <section className="panel detail-panel">
            <div className="panel-heading">
              <div>
                <h2>Notes</h2>
                <p>Context and preparation</p>
              </div>
            </div>
            <p className="notes-content">{app.notes || 'No notes added.'}</p>
          </section>
          <section className="panel detail-panel">
            <div className="panel-heading">
              <div>
                <h2>Resume used</h2>
                <p>The library version associated with this application</p>
              </div>
              {app.resumeId && !app.resumeDeleted && (
                <button
                  className="button secondary small"
                  onClick={() => onOpenResume(app.resumeId!)}
                >
                  <ExternalLink size={16} />
                  Open
                </button>
              )}
            </div>
            <div className="resume-assignment">
              <select
                aria-label="Resume used"
                value={app.resumeId ?? ''}
                onChange={(event) =>
                  onResume(event.target.value ? Number(event.target.value) : null)
                }
              >
                <option value="">No resume selected</option>
                {app.resumeDeleted && app.resumeId && (
                  <option value={app.resumeId}>{app.resumeName} (deleted)</option>
                )}
                {resumes.map((resume) => (
                  <option key={resume.id} value={resume.id}>
                    {resume.name}
                    {resume.isCurrent ? ' (current)' : ''}
                  </option>
                ))}
              </select>
              {app.resumeDeleted && (
                <small>
                  This resume was deleted from the library and is kept here for history.
                </small>
              )}
            </div>
          </section>
        </main>
        <aside>
          <section className="panel timeline-card">
            <h2>Next actions</h2>
            {tasks
              .filter((task) => !task.completed)
              .slice(0, 4)
              .map((task) => (
                <div className="detail-field" key={task.id}>
                  <span>{task.priority} priority</span>
                  <strong>{task.title}</strong>
                  <small>{dateTime(task.snoozedUntil || task.dueAt)}</small>
                </div>
              ))}
            <button className="button secondary full-button" onClick={onAddTask}>
              <CalendarPlus size={17} />
              Add task
            </button>
            <hr />
            {field('Date applied', formatDate(app.dateApplied))}
            {field('Created', formatDate(app.createdAt, true))}
            {field('Last updated', formatDate(app.updatedAt, true))}
          </section>
        </aside>
      </div>
    </>
  );
}
