import { ArrowUpDown, Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { JobApplication, SortField } from '../types/application';
import { formatDate } from '../utils/format';
import { StatusBadge } from './ui';

interface Props {
  applications: JobApplication[];
  sortBy: SortField;
  sortDirection: 'asc' | 'desc';
  selected: number[];
  onSelected: (ids: number[]) => void;
  onSort: (field: SortField) => void;
  onView: (app: JobApplication) => void;
  onEdit: (app: JobApplication) => void;
  onDelete: (app: JobApplication) => void;
}

export function ApplicationTable({
  applications,
  sortBy,
  sortDirection,
  selected,
  onSelected,
  onSort,
  onView,
  onEdit,
  onDelete,
}: Props) {
  const heading = (label: string, field: SortField) => (
    <button className={sortBy === field ? 'sort-active' : ''} onClick={() => onSort(field)}>
      {label}
      <ArrowUpDown size={14} />
      <span className="sr-only">{sortBy === field ? `sorted ${sortDirection}` : ''}</span>
    </button>
  );
  const all = applications.length > 0 && applications.every((app) => selected.includes(app.id));
  const toggleAll = () =>
    onSelected(
      all
        ? selected.filter((id) => !applications.some((app) => app.id === id))
        : Array.from(new Set([...selected, ...applications.map((app) => app.id)])),
    );
  const toggle = (id: number) =>
    onSelected(
      selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id],
    );
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                checked={all}
                onChange={toggleAll}
                aria-label="Select all visible applications"
              />
            </th>
            <th>{heading('Company', 'company')}</th>
            <th>Position</th>
            <th>Status</th>
            <th>Location</th>
            <th>{heading('Applied', 'dateApplied')}</th>
            <th>{heading('Follow-up', 'followUpDate')}</th>
            <th>{heading('Updated', 'updatedAt')}</th>
            <th>
              <span className="sr-only">Actions</span>
              <MoreHorizontal size={17} />
            </th>
          </tr>
        </thead>
        <tbody>
          {applications.map((app) => (
            <tr key={app.id} onDoubleClick={() => onView(app)}>
              <td>
                <input
                  type="checkbox"
                  checked={selected.includes(app.id)}
                  onChange={() => toggle(app.id)}
                  aria-label={`Select ${app.company} ${app.position}`}
                />
              </td>
              <td>
                <button className="company-link" onClick={() => onView(app)}>
                  {app.company}
                </button>
              </td>
              <td>{app.position}</td>
              <td>
                <StatusBadge status={app.status} />
              </td>
              <td className="muted-cell">{app.location || '—'}</td>
              <td className="muted-cell">{formatDate(app.dateApplied)}</td>
              <td className="muted-cell">{formatDate(app.followUpDate)}</td>
              <td className="muted-cell">{formatDate(app.updatedAt)}</td>
              <td>
                <div className="row-actions">
                  <button
                    onClick={() => onView(app)}
                    aria-label={`View ${app.company}`}
                    title="View"
                  >
                    <Eye size={16} />
                  </button>
                  <button
                    onClick={() => onEdit(app)}
                    aria-label={`Edit ${app.company}`}
                    title="Edit"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => onDelete(app)}
                    aria-label={`Delete ${app.company}`}
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
