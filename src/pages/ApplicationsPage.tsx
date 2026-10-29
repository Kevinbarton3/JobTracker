import { BookmarkPlus, FilterX, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ApplicationTable } from '../components/ApplicationTable';
import { EmptyState } from '../components/ui';
import {
  EMPLOYMENT_TYPES,
  STATUSES,
  WORK_ARRANGEMENTS,
  type ApplicationFilters,
  type ApplicationStatus,
  type JobApplication,
  type SortField,
} from '../types/application';

export interface SavedView {
  name: string;
  filters: ApplicationFilters;
}
interface Props {
  applications: JobApplication[];
  totalCount: number;
  filters: ApplicationFilters;
  savedViews: SavedView[];
  onSavedViews: (views: SavedView[]) => void;
  onFilters: (filters: ApplicationFilters) => void;
  onAdd: () => void;
  onView: (app: JobApplication) => void;
  onEdit: (app: JobApplication) => void;
  onDelete: (app: JobApplication) => void;
  onBulkStatus: (ids: number[], status: ApplicationStatus) => void;
}

export function ApplicationsPage({
  applications,
  totalCount,
  filters,
  savedViews,
  onSavedViews,
  onFilters,
  onAdd,
  onView,
  onEdit,
  onDelete,
  onBulkStatus,
}: Props) {
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkStatus, setBulkStatus] = useState<ApplicationStatus>('Applied');
  const set = <K extends keyof ApplicationFilters>(key: K, value: ApplicationFilters[K]) =>
    onFilters({ ...filters, [key]: value });
  const clear = () =>
    onFilters({ ...filters, search: '', status: '', workArrangement: '', employmentType: '' });
  const sort = (field: SortField) =>
    onFilters({
      ...filters,
      sortBy: field,
      sortDirection: filters.sortBy === field && filters.sortDirection === 'asc' ? 'desc' : 'asc',
    });
  const filtered = Boolean(
    filters.search || filters.status || filters.workArrangement || filters.employmentType,
  );
  const saveView = () => {
    const name = window.prompt('Name this saved view');
    if (name?.trim())
      onSavedViews([
        ...savedViews.filter((view) => view.name !== name.trim()),
        { name: name.trim(), filters },
      ]);
  };
  const visibleSelected = useMemo(
    () => selected.filter((id) => applications.some((app) => app.id === id)),
    [selected, applications],
  );
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Pipeline</p>
          <h1>Applications</h1>
          <p>
            Showing {applications.length} of {totalCount} applications.
          </p>
        </div>
        <button className="button primary" onClick={onAdd}>
          <Plus size={18} />
          Add application
        </button>
      </header>
      <section className="panel table-panel">
        <div className="filters">
          <label className="search-box">
            <Search size={18} />
            <span className="sr-only">Search applications</span>
            <input
              id="application-search"
              value={filters.search}
              onChange={(event) => set('search', event.target.value)}
              placeholder="Search all application details…"
            />
          </label>
          <select
            aria-label="Open saved view"
            defaultValue=""
            onChange={(event) => {
              const view = savedViews.find((item) => item.name === event.target.value);
              if (view) onFilters(view.filters);
            }}
          >
            <option value="">Saved views</option>
            {savedViews.map((view) => (
              <option key={view.name}>{view.name}</option>
            ))}
          </select>
          <select
            aria-label="Filter by status"
            value={filters.status}
            onChange={(event) => set('status', event.target.value as ApplicationFilters['status'])}
          >
            <option value="">All statuses</option>
            {STATUSES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select
            aria-label="Filter by work arrangement"
            value={filters.workArrangement}
            onChange={(event) =>
              set('workArrangement', event.target.value as ApplicationFilters['workArrangement'])
            }
          >
            <option value="">Any arrangement</option>
            {WORK_ARRANGEMENTS.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select
            aria-label="Filter by employment type"
            value={filters.employmentType}
            onChange={(event) =>
              set('employmentType', event.target.value as ApplicationFilters['employmentType'])
            }
          >
            <option value="">Any employment type</option>
            {EMPLOYMENT_TYPES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <button className="button ghost" onClick={saveView}>
            <BookmarkPlus size={17} />
            Save view
          </button>
          {filtered && (
            <button className="button ghost" onClick={clear}>
              <FilterX size={17} />
              Clear filters
            </button>
          )}
        </div>
        {filtered && (
          <div className="active-filters" aria-label="Active filters">
            {filters.search && <span>Search: {filters.search}</span>}
            {filters.status && <span>Status: {filters.status}</span>}
            {filters.workArrangement && <span>Arrangement: {filters.workArrangement}</span>}
            {filters.employmentType && <span>Employment: {filters.employmentType}</span>}
          </div>
        )}
        {visibleSelected.length > 0 && (
          <div className="bulk-bar">
            <strong>{visibleSelected.length} selected</strong>
            <select
              value={bulkStatus}
              onChange={(event) => setBulkStatus(event.target.value as ApplicationStatus)}
            >
              {STATUSES.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
            <button
              className="button primary small"
              onClick={() => {
                onBulkStatus(visibleSelected, bulkStatus);
                setSelected([]);
              }}
            >
              Update status
            </button>
            <button className="button ghost small" onClick={() => setSelected([])}>
              Clear selection
            </button>
          </div>
        )}
        {applications.length ? (
          <ApplicationTable
            applications={applications}
            selected={selected}
            onSelected={setSelected}
            sortBy={filters.sortBy}
            sortDirection={filters.sortDirection}
            onSort={sort}
            onView={onView}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ) : (
          <EmptyState
            title={filtered ? 'No matching applications' : 'No applications yet'}
            description={
              filtered
                ? 'Try adjusting or clearing your filters.'
                : 'Add your first application to get started.'
            }
            action={
              <button className="button secondary small" onClick={filtered ? clear : onAdd}>
                {filtered ? 'Clear filters' : 'Add application'}
              </button>
            }
          />
        )}
      </section>
    </>
  );
}
