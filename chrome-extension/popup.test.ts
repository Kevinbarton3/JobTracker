// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
const html = readFileSync('chrome-extension/popup.html', 'utf8');
const source = readFileSync('chrome-extension/popup.js', 'utf8');
const el = (id: string) => document.getElementById(id) as HTMLInputElement;
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});
function boot(
  execute: ReturnType<typeof vi.fn>,
  url = 'https://www.linkedin.com/jobs/search-results/?currentJobId=42',
  saved?: Record<string, unknown>,
) {
  document.body.innerHTML = html;
  const chrome = {
    tabs: { query: async () => [{ id: 1, url }], create: vi.fn(async () => ({})) },
    storage: {
      local: {
        get: async () => (saved ? { [`draft:1:${url}`]: saved } : {}),
        set: vi.fn(async () => {}),
      },
    },
    scripting: { executeScript: execute },
    runtime: { sendNativeMessage: async () => ({ ok: true, data: [] }) },
  };
  new Function('chrome', 'extractJobs', source)(chrome, () => []);
  return chrome;
}
it('reports capture progress and keeps edited fields after an empty recapture', async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce([
      {
        result: [{ company: 'Acme', position: 'Engineer', jobUrl: 'https://example.com/jobs/42' }],
      },
    ])
    .mockResolvedValueOnce([{ result: [{ company: '', position: '', description: '' }] }]);
  boot(execute);
  await vi.waitFor(() => expect(el('message').textContent).toContain('Captured Engineer'));
  el('company').value = 'My correction';
  el('refresh').click();
  expect(el('refresh').textContent).toContain('Reading');
  expect(el('refresh').disabled).toBe(true);
  await vi.waitFor(() => expect(el('message').textContent).toContain('No job details found'));
  expect(el('company').value).toBe('My correction');
  expect(el('refresh').disabled).toBe(false);
});
it('shows injection errors instead of silently doing nothing', async () => {
  boot(vi.fn().mockRejectedValue(new Error('Cannot access contents of the page')));
  await vi.waitFor(() =>
    expect(el('message').textContent).toContain('Capture failed: Cannot access'),
  );
  expect(el('refresh').disabled).toBe(false);
});

it('offers the embedded posting and blocks saving the outer marketing page', async () => {
  boot(
    vi.fn().mockResolvedValue([
      {
        result: [
          {
            embeddedUrl:
              'https://careers.enthought.com/careers.html?job=scientific-software-developer-3',
          },
        ],
      },
    ]),
  );
  await vi.waitFor(() => expect(el('embeddedNotice').hidden).toBe(false));
  expect(el('save').disabled).toBe(true);
  expect(el('applied').disabled).toBe(true);
  expect(el('embeddedOpen').disabled).toBe(false);
});

it('shows the Enthought posting action even with a restored old preview', async () => {
  const execute = vi.fn();
  const url =
    'https://www.enthought.com/careers?job=scientific-software-developer-3&utm_source=linkedin';
  const chrome = boot(execute, url, {
    position: 'Join the Enthought Team',
    description: 'My manual notes',
  });
  await vi.waitFor(() => expect(el('embeddedNotice').hidden).toBe(false));
  expect(el('position').value).toBe('Join the Enthought Team');
  expect(el('description').value).toBe('My manual notes');
  expect(el('save').disabled).toBe(true);
  expect(el('applied').disabled).toBe(true);
  el('embeddedOpen').click();
  expect(chrome.tabs.create).toHaveBeenCalledWith({
    url: 'https://careers.enthought.com/careers.html?job=scientific-software-developer-3',
  });
  expect(execute).not.toHaveBeenCalled();
});
it('routes the original Enthought URL before its iframe loads', async () => {
  const execute = vi.fn();
  boot(execute, 'https://www.enthought.com/careers?job=scientific-software-developer-3');
  await vi.waitFor(() => expect(el('embeddedNotice').hidden).toBe(false));
  expect(el('save').disabled).toBe(true);
  expect(execute).not.toHaveBeenCalled();
});
it('preserves ordinary restored drafts without recapturing', async () => {
  const execute = vi.fn();
  boot(execute, 'https://example.com/jobs/1', { company: 'My correction', position: 'Engineer' });
  await vi.waitFor(() => expect(el('company').value).toBe('My correction'));
  expect(el('embeddedNotice').hidden).toBe(true);
  expect(execute).not.toHaveBeenCalled();
});
