// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
const source = readFileSync('chrome-extension/extract.js', 'utf8');
const extract = () => new Function(source + ';return extractJobs();')();
function page(html: string, host = 'https://careers.example.com/job/123?jobId=123&utm_source=ad') {
  document.body.innerHTML = html;
  vi.stubGlobal('location', new URL(host));
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});
describe('Chrome extraction', () => {
  it('extracts structured fields and strips tracking without losing job identifiers', () => {
    page(
      `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Engineer', hiringOrganization: { name: 'Acme' }, description: '<p>Build systems</p><input value="secret">', employmentType: 'FULL_TIME', jobLocationType: 'TELECOMMUTE', baseSalary: { currency: 'USD', value: { minValue: 90000, maxValue: 120000, unitText: 'YEAR' } } })}</script>`,
    );
    const j = extract()[0];
    expect(j.company).toBe('Acme');
    expect(j.description).toBe('Build systems');
    expect(j.workArrangement).toBe('Remote');
    expect(j.jobUrl).toContain('jobId=123');
    expect(j.jobUrl).not.toContain('utm_source');
  });
  it.each([
    [
      'LinkedIn',
      '<div class="jobs-details"><div class="job-details-jobs-unified-top-card__job-title"><h1>Engineer</h1></div><div class="job-details-jobs-unified-top-card__company-name">Acme</div><div id="job-details">Build systems</div></div>',
      'https://www.linkedin.com/jobs/view/123',
    ],
    [
      'Indeed',
      '<h1 class="jobsearch-JobInfoHeader-title">Engineer</h1><div data-testid="inlineHeader-companyName">Acme</div><div id="jobDescriptionText">Build systems</div>',
      'https://www.indeed.com/viewjob?jk=123',
    ],
    [
      'Greenhouse',
      '<h1 class="app-title">Engineer</h1><div class="company-name">Acme</div><div class="job-description">Build systems</div>',
      'https://boards.greenhouse.io/acme/jobs/123',
    ],
    [
      'Modern Greenhouse',
      '<main class="job-post"><a class="logo"><img alt="Acme Logo"></a><h1>Engineer</h1><div class="job__description">Build systems</div><form>Private answer</form></main>',
      'https://job-boards.greenhouse.io/acme/jobs/123',
    ],
    [
      'Lever',
      '<div class="posting-headline"><h2>Engineer</h2></div><div class="company-name">Acme</div><div class="posting-page"><div class="content">Build systems</div></div>',
      'https://jobs.lever.co/acme/123',
    ],
    [
      'Workday',
      '<div data-automation-id="jobPostingHeader">Engineer</div><div data-automation-id="companyName">Acme</div><div data-automation-id="jobPostingDescription">Build systems</div>',
      'https://acme.wd5.myworkdayjobs.com/en-US/job/123',
    ],
  ])('extracts %s fixture', (_, html, url) => {
    page(html, url);
    const j = extract()[0];
    expect(j.company).toBe('Acme');
    expect(j.position).toBe('Engineer');
    expect(j.description).toBe('Build systems');
    expect(j.salaryRange).toBe('');
  });
  it('returns multiple jobs for selection instead of guessing', () => {
    page(
      `<script type="application/ld+json">${JSON.stringify([
        { '@type': 'JobPosting', title: 'One' },
        { '@type': 'JobPosting', title: 'Two' },
      ])}</script>`,
    );
    expect(extract()).toHaveLength(2);
  });
  it('does not copy form answers or unrelated body text', () => {
    page('<h1>Engineer</h1><form><textarea>Private answer</textarea></form><nav>Unrelated</nav>');
    const j = extract()[0];
    expect(j.company).toBe('');
    expect(j.description).toBe('');
  });
  it('bounds long descriptions', () => {
    page(
      `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Engineer', description: 'x'.repeat(50000) })}</script>`,
    );
    expect(extract()[0].description).toHaveLength(40000);
  });
});

it('captures the selected job in the new LinkedIn search layout', () => {
  page(
    '<main><button>Other job Other company</button><a href="https://www.linkedin.com/company/acme/life/">Acme</a><a href="https://www.linkedin.com/jobs/view/4481202208/?trackingId=x">Data Engineer</a><h2>About the job</h2><div><p>Build pipelines</p><p>Use SQL</p></div><form><textarea>Private answer</textarea></form></main>',
    'https://www.linkedin.com/jobs/search-results/?currentJobId=4481202208&eBP=tracking',
  );
  const j = extract()[0];
  expect(j.company).toBe('Acme');
  expect(j.position).toBe('Data Engineer');
  expect(j.description).toBe('Build pipelines Use SQL');
  expect(j.jobUrl).toBe('https://www.linkedin.com/jobs/view/4481202208/');
});
it('prefers the selected LinkedIn job over stale structured data', () => {
  page(
    '<script type="application/ld+json">{"@type":"JobPosting","title":"Old role","hiringOrganization":{"name":"Old company"}}</script><a href="/company/acme/">Acme</a><a href="/jobs/view/42/">New role</a><h2>About the job</h2><div>New description</div>',
    'https://www.linkedin.com/jobs/search-results/?currentJobId=42',
  );
  expect(extract()[0].position).toBe('New role');
});

it('detects the Enthought frame rather than capturing the marketing heading', () => {
  page(
    '<h1>Join the Enthought Team</h1><iframe id="ats-careers-frame" src="https://careers.enthought.com/careers.html?job=scientific-software-developer-3&amp;utm_source=linkedin"></iframe>',
    'https://www.enthought.com/careers?job=scientific-software-developer-3',
  );
  expect(extract()).toEqual([
    {
      embeddedUrl: 'https://careers.enthought.com/careers.html?job=scientific-software-developer-3',
    },
  ]);
});
it('reads Enthought job details without application answers or inferred salary', () => {
  page(
    '<main><h1>Careers at Enthought</h1><div data-testid="job-detail-panel"><h2>Scientific Software Developer</h2><p></p><p>Austin, TX (hybrid) &middot; Full-time</p><div class="mt-3"><h3>The Opportunity</h3><p>Build scientific software.</p></div><div class="mt-4"><form><label>Salary expectations<input value="90000"></label><textarea>Private answer</textarea></form></div></div></main>',
    'https://careers.enthought.com/careers.html?job=scientific-software-developer-3',
  );
  const j = extract()[0];
  expect(j.position).toBe('Scientific Software Developer');
  expect(j.company).toBe('Enthought');
  expect(j.location).toBe('Austin, TX');
  expect(j.workArrangement).toBe('Hybrid');
  expect(j.employmentType).toBe('Full-time');
  expect(j.salaryRange).toBe('');
  expect(j.description).toBe('The Opportunity Build scientific software.');
});
it('does not use the Enthought careers heading before the job has loaded', () => {
  page(
    '<main><h1>Careers at Enthought</h1></main>',
    'https://careers.enthought.com/careers.html?job=scientific-software-developer-3',
  );
  expect(extract()).toEqual([]);
});

it('routes Enthought before the cross-origin frame has been created', () => {
  page(
    '<h1>Join the Enthought Team</h1>',
    'https://www.enthought.com/careers?job=scientific-software-developer-3&utm_source=linkedin',
  );
  expect(extract()).toEqual([
    {
      embeddedUrl: 'https://careers.enthought.com/careers.html?job=scientific-software-developer-3',
    },
  ]);
});
