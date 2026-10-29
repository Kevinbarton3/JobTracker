// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmailInbox, GmailSettings } from './Gmail';
import { gmail } from '../services/gmailService';
import type { JobApplication } from '../types/application';
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));
vi.mock('../services/gmailService', () => ({ gmail: vi.fn() }));
const message = {
  id: 1,
  account: 'jobs@example.com',
  sender: 'Recruiter',
  subject: 'Interview invitation',
  receivedAt: '2026-10-22T12:00:00Z',
  preview: 'We invite you to an interview.',
  applicationId: 7,
  disposition: 'linked',
  suggestedStatus: 'Interviewing',
  excerpt: 'We invite you to an interview.',
  suggestionState: 'pending',
  gmailId: 'abcd',
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('does not apply status until the user explicitly approves', async () => {
  vi.mocked(gmail).mockResolvedValue([message]);
  const user = userEvent.setup();
  render(
    <EmailInbox
      applications={[{ id: 7, company: 'Acme', position: 'Engineer' } as JobApplication]}
    />,
  );
  await screen.findByText('Suggested status: Interviewing');
  expect(vi.mocked(gmail).mock.calls.some((c) => c[0] === 'apply')).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Apply status' }));
  await waitFor(() =>
    expect(gmail).toHaveBeenCalledWith('apply', { id: 1, applicationId: undefined }),
  );
});
it('supports reassignment and ignoring a message', async () => {
  vi.mocked(gmail).mockResolvedValue([message]);
  const user = userEvent.setup();
  render(
    <EmailInbox
      applications={[
        { id: 7, company: 'Acme', position: 'Engineer' } as JobApplication,
        { id: 8, company: 'Other', position: 'Engineer' } as JobApplication,
      ]}
    />,
  );
  await user.selectOptions(
    await screen.findByLabelText('Application for Interview invitation'),
    '8',
  );
  expect(gmail).toHaveBeenCalledWith('link', { id: 1, applicationId: 8 });
  await user.click(screen.getByRole('button', { name: 'Ignore' }));
  expect(gmail).toHaveBeenCalledWith('ignore', { id: 1, applicationId: undefined });
});
it('shows account and reconnect state without relying on ChatGPT identity', async () => {
  vi.mocked(gmail).mockResolvedValue({
    configured: true,
    accounts: [{ address: 'jobs@example.com', lastSync: null, reconnect: true }],
    busy: false,
    error: null,
    autostart: false,
  });
  render(<GmailSettings />);
  await screen.findByText('jobs@example.com');
  expect(screen.getByRole('button', { name: 'Reconnect / change account' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Sync now' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});
