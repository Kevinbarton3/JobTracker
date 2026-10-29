import {
  Mail,
  BriefcaseBusiness,
  CalendarClock,
  FileUser,
  LayoutDashboard,
  Settings,
} from 'lucide-react';

export type PageName =
  | 'dashboard'
  | 'applications'
  | 'follow-ups'
  | 'resumes'
  | 'settings'
  | 'email';
interface Props {
  page: PageName;
  onNavigate: (page: PageName) => void;
}
const items = [
  { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
  { id: 'applications' as const, label: 'Applications', icon: BriefcaseBusiness },
  { id: 'follow-ups' as const, label: 'Tasks', icon: CalendarClock },
  { id: 'resumes' as const, label: 'Resumes', icon: FileUser },
  { id: 'email' as const, label: 'Email', icon: Mail },
  { id: 'settings' as const, label: 'Settings', icon: Settings },
];

export function Sidebar({ page, onNavigate }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <BriefcaseBusiness size={20} />
        </span>
        <span>JobTrack</span>
      </div>
      <nav aria-label="Primary navigation">
        {items.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`nav-item ${page === id ? 'active' : ''}`}
            onClick={() => onNavigate(id)}
            aria-current={page === id ? 'page' : undefined}
          >
            <Icon size={19} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <span className="privacy-dot" />
        Stored locally · Gmail sync optional
      </div>
    </aside>
  );
}
