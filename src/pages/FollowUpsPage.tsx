import {
  CalendarCheck,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type { JobApplication, TaskGroups, TaskItem } from '../types/application';
import { EmptyState, StatusBadge } from '../components/ui';

interface Props {
  groups: TaskGroups;
  onView: (id: number) => void;
  onAdd: () => void;
  onComplete: (task: TaskItem, completed: boolean) => void;
  onSnooze: (task: TaskItem) => void;
  onDelete: (task: TaskItem) => void;
}

const displayDateTime = (value: string) => {
  const date = new Date(value.replace(' ', 'T'));
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

export function FollowUpsPage({ groups, onView, onAdd, onComplete, onSnooze, onDelete }: Props) {
  const total = groups.overdue.length + groups.dueToday.length + groups.upcoming.length;
  const section = (
    title: string,
    subtitle: string,
    items: TaskItem[],
    tone: string,
    completed = false,
  ) => (
    <section className="follow-section">
      <div className="follow-heading">
        <div>
          <span className={`follow-dot ${tone}`} />
          <h2>{title}</h2>
          <span className="count-badge">{items.length}</span>
        </div>
        <p>{subtitle}</p>
      </div>
      {items.length ? (
        <div className="follow-list">
          {items.map((task) => (
            <article key={task.id}>
              <button className="follow-main" onClick={() => onView(task.applicationId)}>
                <span className="company-avatar">{task.company.slice(0, 2).toUpperCase()}</span>
                <span>
                  <strong>{task.title}</strong>
                  <small>
                    {task.company} · {task.position}
                  </small>
                </span>
                <StatusBadge status={task.status} />
                <span className="follow-date">
                  <CalendarDays size={16} />
                  {displayDateTime(task.snoozedUntil || task.dueAt)}
                </span>
                <ChevronRight size={18} />
              </button>
              <div className="follow-actions">
                {!completed && (
                  <button onClick={() => onSnooze(task)}>
                    <Clock3 size={15} />
                    Snooze
                  </button>
                )}
                <button onClick={() => onComplete(task, !completed)}>
                  {completed ? <RotateCcw size={15} /> : <Check size={15} />}{' '}
                  {completed ? 'Reopen' : 'Complete'}
                </button>
                <button onClick={() => onDelete(task)} aria-label={`Delete ${task.title}`}>
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="inline-empty">Nothing here right now.</p>
      )}
    </section>
  );

  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Next actions</p>
          <h1>Tasks</h1>
          <p>
            {total
              ? `${total} active task${total === 1 ? '' : 's'} need your attention.`
              : 'You’re all caught up.'}
          </p>
        </div>
        <button className="button primary" onClick={onAdd}>
          <Plus size={18} />
          Add task
        </button>
      </header>
      {total === 0 && groups.completed.length === 0 ? (
        <section className="panel">
          <EmptyState
            title="No tasks scheduled"
            description="Add a task for an application to see it here."
            action={
              <button className="button secondary small" onClick={onAdd}>
                Add task
              </button>
            }
          />
        </section>
      ) : (
        <div className="follow-groups">
          {section('Overdue', 'Past the scheduled due time', groups.overdue, 'red')}
          {section('Due today', 'Actions scheduled for today', groups.dueToday, 'amber')}
          {section('Upcoming', 'Planned for a future date', groups.upcoming, 'blue')}
          {section('Completed', 'Finished tasks can be reopened', groups.completed, 'gray', true)}
        </div>
      )}
      <span className="sr-only">
        <CalendarCheck />
        Task management
      </span>
    </>
  );
}
