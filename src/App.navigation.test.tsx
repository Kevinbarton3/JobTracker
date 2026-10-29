// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { applicationService } from './services/applicationService';
vi.mock('./services/applicationService', () => ({
  applicationService: {
    initialize: vi.fn(),
    getAll: vi.fn().mockResolvedValue([]),
    dashboard: vi.fn().mockResolvedValue({
      total: 0,
      statusBreakdown: {},
      responseRate: 0,
      interviewRate: 0,
      offerRate: 0,
    }),
    tasks: vi.fn().mockResolvedValue({ overdue: [], dueToday: [], upcoming: [], completed: [] }),
    analytics: vi
      .fn()
      .mockResolvedValue({ bySource: [], byWorkArrangement: [], averageStageDays: {} }),
    listBackups: vi.fn().mockResolvedValue([]),
    databasePath: vi.fn().mockResolvedValue('fixture'),
    resumes: vi.fn().mockResolvedValue([]),
  },
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});
it('dashboard navigation clears unrelated persisted filters and preserves sorting', async () => {
  localStorage.setItem('jobtrack.onboarded', 'true');
  localStorage.setItem('jobtrack.theme', JSON.stringify('dark'));
  localStorage.setItem(
    'jobtrack.filters',
    JSON.stringify({
      search: 'old search',
      status: 'Rejected',
      workArrangement: 'Remote',
      employmentType: 'Contract',
      sortBy: 'company',
      sortDirection: 'asc',
    }),
  );
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: /Active interviews/ }));
  await waitFor(() =>
    expect(applicationService.getAll).toHaveBeenLastCalledWith({
      search: '',
      status: 'Interviewing',
      workArrangement: '',
      employmentType: '',
      sortBy: 'company',
      sortDirection: 'asc',
    }),
  );
  expect(screen.getByText('Showing 0 of 0 applications.')).toBeTruthy();
  expect(screen.getByText('Status: Interviewing')).toBeTruthy();
  await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
  await waitFor(() =>
    expect(applicationService.getAll).toHaveBeenLastCalledWith({
      search: '',
      status: '',
      workArrangement: '',
      employmentType: '',
      sortBy: 'company',
      sortDirection: 'asc',
    }),
  );
});
