import {
  CalendarCheck,
  CalendarPlus,
  Handshake,
  MessageSquareText,
  Plus,
  Send,
  ThumbsDown,
  Timer,
} from 'lucide-react';
import type {
  Analytics,
  ApplicationStatus,
  DashboardStatistics,
  JobApplication,
  TaskItem,
} from '../types/application';
import { STATUSES } from '../types/application';
import { formatDate } from '../utils/format';
import { EmptyState, StatusBadge, SummaryCard } from '../components/ui';

interface Props {
  statistics: DashboardStatistics;
  analytics: Analytics;
  recent: JobApplication[];
  tasks: TaskItem[];
  onAdd: () => void;
  onView: (app: JobApplication) => void;
  onOpenApplications: (status?: ApplicationStatus) => void;
  onOpenTasks: () => void;
}

const displayTaskDate = (task: TaskItem) => {
  const date = new Date((task.snoozedUntil || task.dueAt).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

export function DashboardPage({
  statistics,
  analytics,
  recent,
  tasks,
  onAdd,
  onView,
  onOpenApplications,
  onOpenTasks,
}: Props) {
  const cards = [
    [
      'Total applications',
      statistics.total,
      <Send size={20} />,
      'blue',
      () => onOpenApplications(),
    ],
    [
      'Submitted this week',
      statistics.submittedThisWeek,
      <CalendarPlus size={20} />,
      'violet',
      () => onOpenApplications('Applied'),
    ],
    [
      'Active interviews',
      statistics.activeInterviews,
      <MessageSquareText size={20} />,
      'amber',
      () => onOpenApplications('Interviewing'),
    ],
    [
      'Offers',
      statistics.offers,
      <Handshake size={20} />,
      'green',
      () => onOpenApplications('Offer'),
    ],
    [
      'Open tasks',
      statistics.requiringFollowUp,
      <CalendarCheck size={20} />,
      'orange',
      onOpenTasks,
    ],
    [
      'Rejections',
      statistics.rejections,
      <ThumbsDown size={20} />,
      'red',
      () => onOpenApplications('Rejected'),
    ],
  ] as const;
  const max = Math.max(...Object.values(statistics.statusBreakdown), 1);
  const rateCards = [
    ['Response rate', `${statistics.responseRate}%`],
    ['Interview rate', `${statistics.interviewRate}%`],
    ['Offer rate', `${statistics.offerRate}%`],
    [
      'Avg. first response',
      statistics.averageDaysToFirstResponse == null
        ? '—'
        : `${statistics.averageDaysToFirstResponse} days`,
    ],
  ];
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Overview</p>
          <h1>Dashboard</h1>
          <p>See where your search stands and what needs attention.</p>
        </div>
        <button className="button primary" onClick={onAdd}>
          <Plus size={18} />
          Add application
        </button>
      </header>
      <div className="summary-grid">
        {cards.map(([label, value, icon, tone, action]) => (
          <button className="summary-button" key={label} onClick={action}>
            <SummaryCard label={label} value={value} icon={icon} tone={tone} />
          </button>
        ))}
      </div>
      <div className="insight-strip">
        {rateCards.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="dashboard-grid">
        <section className="panel status-panel">
          <div className="panel-heading">
            <div>
              <h2>Status breakdown</h2>
              <p>Select a stage to filter the pipeline</p>
            </div>
          </div>
          <div className="status-chart">
            {STATUSES.map((status) => (
              <button
                className="chart-row chart-button"
                key={status}
                onClick={() => onOpenApplications(status)}
              >
                <span>{status}</span>
                <div className="chart-track">
                  <div
                    className={`chart-fill status-${status.toLowerCase().replaceAll(' ', '-')}`}
                    style={{ width: `${(statistics.statusBreakdown[status] / max) * 100}%` }}
                  />
                </div>
                <strong>{statistics.statusBreakdown[status]}</strong>
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Priority tasks</h2>
              <p>Overdue work appears first</p>
            </div>
            <button className="text-button" onClick={onOpenTasks}>
              View all
            </button>
          </div>
          {tasks.length ? (
            <div className="compact-list">
              {tasks.slice(0, 5).map((task) => {
                const date = displayTaskDate(task);
                return (
                  <button key={task.id} onClick={onOpenTasks}>
                    <span className="date-tile">
                      <strong>{date.toLocaleDateString(undefined, { day: '2-digit' })}</strong>
                      <small>{date.toLocaleDateString(undefined, { month: 'short' })}</small>
                    </span>
                    <span>
                      <strong>{task.title}</strong>
                      <small>
                        {task.company} · {task.priority}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState title="Nothing scheduled" description="Tasks will appear here." />
          )}
        </section>
      </div>
      <div className="dashboard-grid analytics-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Best sources</h2>
              <p>Applications and outcomes</p>
            </div>
          </div>
          <div className="analytics-list">
            {analytics.bySource.slice(0, 5).map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>
                  {item.offers} offers · {item.interviews} interviews / {item.total}
                </strong>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Time in stage</h2>
              <p>Average days before the next status change</p>
            </div>
            <Timer size={19} />
          </div>
          <div className="analytics-list">
            {Object.entries(analytics.averageStageDays).length ? (
              Object.entries(analytics.averageStageDays)
                .slice(0, 5)
                .map(([label, days]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{days} days</strong>
                  </div>
                ))
            ) : (
              <p className="inline-empty">More status history is needed.</p>
            )}
          </div>
        </section>
      </div>
      <section className="panel recent-panel">
        <div className="panel-heading">
          <div>
            <h2>Recent applications</h2>
            <p>Your latest activity</p>
          </div>
          <button className="text-button" onClick={() => onOpenApplications()}>
            View all
          </button>
        </div>
        {recent.length ? (
          <div className="recent-list">
            {recent.slice(0, 6).map((app) => (
              <button key={app.id} onClick={() => onView(app)}>
                <span className="company-avatar">{app.company.slice(0, 2).toUpperCase()}</span>
                <span className="recent-main">
                  <strong>{app.company}</strong>
                  <small>{app.position}</small>
                </span>
                <StatusBadge status={app.status} />
                <span className="recent-date">{formatDate(app.updatedAt)}</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No applications yet"
            description="Add your first opportunity to start building your pipeline."
            action={
              <button className="button primary small" onClick={onAdd}>
                Add application
              </button>
            }
          />
        )}
      </section>
    </>
  );
}
