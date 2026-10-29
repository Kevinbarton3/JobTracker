// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ApplicationForm } from './ApplicationForm';
import { Dialog } from './ui';
import { ApplicationsPage } from '../pages/ApplicationsPage';
import { DashboardPage } from '../pages/DashboardPage';
import { ResumesPage } from '../pages/ResumesPage';
import {
  STATUSES,
  type ApplicationFilters,
  type DashboardStatistics,
  type Resume,
} from '../types/application';

afterEach(cleanup);

const filters: ApplicationFilters = {
  search: '',
  status: '',
  workArrangement: '',
  employmentType: '',
  sortBy: 'updatedAt',
  sortDirection: 'desc',
};

describe('daily workflows', () => {
  it('validates and submits quick application entry', async () => {
    const user = userEvent.setup();
    const submit = vi.fn().mockResolvedValue(undefined);
    render(<ApplicationForm submitting={false} onSubmit={submit} onCancel={() => undefined} />);
    const save = screen.getByRole('button', { name: 'Add application' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText(/Company name/), 'Contoso');
    await user.type(screen.getByLabelText(/Position title/), 'Engineer');
    expect((save as HTMLButtonElement).disabled).toBe(false);
    await user.click(save);
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ company: 'Contoso', position: 'Engineer' }),
    );
  });

  it('keeps required application fields stable when deletion continues past empty', async () => {
    const user = userEvent.setup();
    render(
      <ApplicationForm
        submitting={false}
        onSubmit={async () => undefined}
        onCancel={() => undefined}
      />,
    );
    const company = screen.getByLabelText(/Company name/);
    const position = screen.getByLabelText(/Position title/);
    await user.type(company, 'Contoso');
    await user.type(position, 'Engineer');
    await user.clear(company);
    await user.keyboard('{Backspace}{Delete}{Backspace}');
    expect(screen.getByRole('button', { name: 'Add application' })).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Add application' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.type(company, 'Contoso');
    await user.clear(position);
    await user.keyboard('{Delete}{Backspace}{Delete}');
    expect((position as HTMLInputElement).value).toBe('');
  });

  it('continues normalizing cleared optional application fields to null', async () => {
    const user = userEvent.setup();
    const submit = vi.fn().mockResolvedValue(undefined);
    render(<ApplicationForm submitting={false} onSubmit={submit} onCancel={() => undefined} />);
    await user.type(screen.getByLabelText(/Company name/), 'Contoso');
    await user.type(screen.getByLabelText(/Position title/), 'Engineer');
    const notes = screen.getByLabelText('Notes');
    await user.type(notes, 'Temporary note');
    await user.clear(notes);
    await user.click(screen.getByRole('button', { name: 'Add application' }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ notes: null }));
  });

  it('offers previously used locations while keeping free-form entry', async () => {
    const user = userEvent.setup();
    render(
      <ApplicationForm
        locationSuggestions={['Chicago, IL', 'Remote — US']}
        submitting={false}
        onSubmit={async () => undefined}
        onCancel={() => undefined}
      />,
    );
    const location = screen.getByLabelText('Location') as HTMLInputElement;
    expect(location.getAttribute('list')).toBe('saved-locations');
    expect(document.querySelectorAll('#saved-locations option')).toHaveLength(2);
    await user.type(location, 'Milwaukee, WI');
    expect(location.value).toBe('Milwaukee, WI');
  });

  it('closes a dialog with Escape', () => {
    const close = vi.fn();
    render(
      <Dialog title="Keyboard dialog" onClose={close}>
        <button>Action</button>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('keeps focus in a controlled dialog field across parent rerenders', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      const [notes, setNotes] = useState('');
      return (
        <>
          <button onClick={() => setOpen(true)}>Open notes</button>
          {open && (
            <Dialog title="Edit resume" onClose={() => setOpen(false)}>
              <label>
                Resume notes
                <textarea
                  autoFocus
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </label>
            </Dialog>
          )}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open notes' });
    await user.click(opener);
    const notes = screen.getByLabelText('Resume notes');
    expect(document.activeElement).toBe(notes);
    await user.type(notes, 'Targeted engineering resume');
    expect((notes as HTMLTextAreaElement).value).toBe('Targeted engineering resume');
    expect(document.activeElement).toBe(notes);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(notes);
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('Resume notes')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('explains an empty filtered subset of a nonempty collection', () => {
    render(
      <ApplicationsPage
        totalCount={45}
        applications={[]}
        filters={{ ...filters, search: 'Missing', status: 'Offer' }}
        savedViews={[]}
        onSavedViews={() => undefined}
        onFilters={() => undefined}
        onAdd={() => undefined}
        onView={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
        onBulkStatus={() => undefined}
      />,
    );
    expect(screen.getByText('Showing 0 of 45 applications.')).toBeTruthy();
    expect(screen.getByText('Search: Missing')).toBeTruthy();
    expect(screen.getByText('Status: Offer')).toBeTruthy();
    expect(screen.getByText('No matching applications')).toBeTruthy();
  });

  it('updates application filters from the pipeline controls', async () => {
    const user = userEvent.setup();
    const onFilters = vi.fn();
    render(
      <ApplicationsPage
        totalCount={0}
        applications={[]}
        filters={filters}
        savedViews={[]}
        onSavedViews={() => undefined}
        onFilters={onFilters}
        onAdd={() => undefined}
        onView={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
        onBulkStatus={() => undefined}
      />,
    );
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'Interviewing');
    expect(onFilters).toHaveBeenCalledWith(expect.objectContaining({ status: 'Interviewing' }));
  });

  it('drills into a status from the dashboard chart', async () => {
    const user = userEvent.setup();
    const onOpenApplications = vi.fn();
    const statusBreakdown = Object.fromEntries(
      STATUSES.map((status) => [status, status === 'Offer' ? 2 : 0]),
    ) as DashboardStatistics['statusBreakdown'];
    const statistics: DashboardStatistics = {
      total: 2,
      submittedThisWeek: 0,
      activeInterviews: 0,
      offers: 2,
      requiringFollowUp: 0,
      rejections: 0,
      statusBreakdown,
      responseRate: 100,
      interviewRate: 100,
      offerRate: 100,
      rejectionRate: 0,
      averageDaysToFirstResponse: 2,
    };
    render(
      <DashboardPage
        statistics={statistics}
        analytics={{ bySource: [], byWorkArrangement: [], averageStageDays: {} }}
        recent={[]}
        tasks={[]}
        onAdd={() => undefined}
        onView={() => undefined}
        onOpenApplications={onOpenApplications}
        onOpenTasks={() => undefined}
      />,
    );
    const chartButton = screen
      .getAllByRole('button')
      .find(
        (button) =>
          button.classList.contains('chart-button') && button.textContent?.includes('Offer'),
      );
    expect(chartButton).toBeTruthy();
    await user.click(chartButton!);
    expect(onOpenApplications).toHaveBeenCalledWith('Offer');
  });

  it('defaults a new application to the current resume', () => {
    const resumes: Resume[] = [
      {
        id: 7,
        name: 'Engineering resume',
        notes: null,
        originalFileName: 'resume.pdf',
        storedFileName: 'managed.pdf',
        createdAt: '2026-08-01 12:00:00',
        isCurrent: true,
        usageCount: 0,
        fileExists: true,
      },
    ];
    render(
      <ApplicationForm
        resumes={resumes}
        defaultResumeId={7}
        submitting={false}
        onSubmit={async () => undefined}
        onCancel={() => undefined}
      />,
    );
    expect((screen.getByLabelText('Resume used') as HTMLSelectElement).value).toBe('7');
  });

  it('shows resume status and invokes current selection', async () => {
    const user = userEvent.setup();
    const onCurrent = vi.fn();
    const resumes: Resume[] = [
      {
        id: 8,
        name: 'Product resume',
        notes: 'Portfolio-focused version',
        originalFileName: 'product.docx',
        storedFileName: 'managed.docx',
        createdAt: '2026-08-02 12:00:00',
        isCurrent: false,
        usageCount: 2,
        fileExists: true,
      },
    ];
    render(
      <ResumesPage
        resumes={resumes}
        busy={false}
        onAdd={() => undefined}
        onOpen={() => undefined}
        onEdit={() => undefined}
        onCurrent={onCurrent}
        onDelete={() => undefined}
      />,
    );
    expect(screen.getByText('2 applications')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Set current/ }));
    expect(onCurrent).toHaveBeenCalledWith(resumes[0]);
  });
});
