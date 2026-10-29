// Executed only following a toolbar click. Never reads form controls.
function extractJobs() {
  const clean = (s) =>
    String(s ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  const text = (html) => {
    const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
    doc.querySelectorAll('script,style,input,textarea,select,form').forEach((n) => n.remove());
    doc
      .querySelectorAll('p,div,li,br,h1,h2,h3,h4,section')
      .forEach((n) => n.append(doc.createTextNode(' ')));
    return clean(doc.body.textContent).slice(0, 40000);
  };
  const visible = (e) => !!e && e.getClientRects().length > 0;
  const pick = (root, selectors) => {
    for (const selector of selectors) {
      const e = [...root.querySelectorAll(selector)].find(visible);
      if (e) return text(e.innerHTML);
    }
    return '';
  };
  const canonical = (raw) => {
    try {
      const u = new URL(raw, location.href);
      if (!/^https?:$/.test(u.protocol)) return location.href;
      u.username = '';
      u.password = '';
      if (/(^|\.)linkedin\.com$/.test(u.hostname)) {
        const id =
          u.searchParams.get('currentJobId') || u.pathname.match(/\/jobs\/view\/(\d+)/)?.[1];
        if (id && /^\d+$/.test(id)) return `https://www.linkedin.com/jobs/view/${id}/`;
      }
      for (const k of [...u.searchParams.keys()])
        if (/^utm_|^(trk|trackingId|refId|ref|source|src|fbclid|gclid)$/i.test(k))
          u.searchParams.delete(k);
      u.hash = '';
      return u.href;
    } catch {
      return location.href;
    }
  };
  const source = /linkedin\.com$/.test(location.hostname)
    ? 'LinkedIn'
    : /indeed\.com$/.test(location.hostname)
      ? 'Indeed'
      : 'Company Website';
  const arrangement = (s) =>
    /\bhybrid\b/i.test(s)
      ? 'Hybrid'
      : /\bremote\b|TELECOMMUTE/i.test(s)
        ? 'Remote'
        : /\bon[ -]site\b/i.test(s)
          ? 'On-site'
          : '';
  const employment = (s) =>
    /FULL_TIME|full.time/i.test(s)
      ? 'Full-time'
      : /PART_TIME|part.time/i.test(s)
        ? 'Part-time'
        : /INTERN|internship/i.test(s)
          ? 'Internship'
          : /CONTRACT/i.test(s)
            ? 'Contract'
            : /TEMPORARY/i.test(s)
              ? 'Temporary'
              : '';
  // This careers site embeds a cross-origin posting. activeTab deliberately
  // cannot read that frame; send the user to the visible posting itself.
  if (location.hostname === 'www.enthought.com' || location.hostname === 'enthought.com') {
    const current = new URL(location.href);
    if (current.pathname.replace(/\/$/, '') === '/careers' && current.searchParams.get('job')) {
      const target = new URL('https://careers.enthought.com/careers.html');
      target.searchParams.set('job', current.searchParams.get('job'));
      return [{ embeddedUrl: target.href }];
    }
    const frame = document.querySelector('iframe#ats-careers-frame');
    if (frame) {
      try {
        const u = new URL(frame.src, location.href);
        if (
          u.origin === 'https://careers.enthought.com' &&
          u.pathname === '/careers.html' &&
          u.searchParams.has('job')
        )
          return [{ embeddedUrl: canonical(u.href) }];
      } catch {}
    }
  }
  if (location.hostname === 'careers.enthought.com') {
    const panel = [...document.querySelectorAll('[data-testid="job-detail-panel"]')].find(visible);
    if (!panel) return [];
    const meta =
      [...panel.querySelectorAll(':scope > p')]
        .map((e) => clean(e.textContent))
        .find((s) => /full-time|part-time|contract/i.test(s)) || '';
    const place = meta
      .split('\u00b7')[0]
      .replace(/\s*\((?:hybrid|remote|on-site)\)\s*/gi, '')
      .trim();
    const heading = clean(document.querySelector('main > h1')?.textContent);
    const descriptionNode = panel.querySelector(':scope > .mt-3');
    return [
      {
        company: heading === 'Careers at Enthought' ? 'Enthought' : '',
        position: pick(panel, [':scope > h2']),
        location: /^remote$/i.test(place) ? '' : place,
        workArrangement: arrangement(meta),
        employmentType: employment(meta),
        salaryRange: '',
        jobUrl: canonical(location.href),
        source,
        description: descriptionNode ? text(descriptionNode.innerHTML) : '',
        extraction: 'Enthought job details',
      },
    ];
  }
  const jobs = [];
  const visit = (v, depth = 0) => {
    if (!v || depth > 15) return;
    if (Array.isArray(v)) {
      v.forEach((x) => visit(x, depth + 1));
      return;
    }
    if (typeof v !== 'object') return;
    if ([v['@type']].flat().includes('JobPosting')) {
      const loc = [v.jobLocation]
        .flat()
        .filter(Boolean)
        .map((x) => {
          const a = x.address ?? x;
          return [
            a.addressLocality,
            a.addressRegion,
            typeof a.addressCountry === 'string' ? a.addressCountry : a.addressCountry?.name,
          ]
            .filter(Boolean)
            .join(', ');
        })
        .join('; ');
      const salary = v.baseSalary;
      const val = salary?.value;
      const amount =
        typeof val === 'object'
          ? [val.minValue, val.maxValue].filter((x) => x != null).join('–') || val.value
          : (val ?? (typeof salary === 'number' || typeof salary === 'string' ? salary : ''));
      jobs.push({
        company: clean(v.hiringOrganization?.name),
        position: clean(v.title),
        location: loc,
        workArrangement: arrangement(v.jobLocationType ?? ''),
        employmentType: employment(String(v.employmentType ?? '')),
        salaryRange: amount
          ? clean(`${salary.currency ?? ''} ${amount} ${val?.unitText ?? ''}`)
          : '',
        jobUrl: canonical(v.url || location.href),
        source,
        description: text(v.description),
        extraction: 'Structured job posting',
      });
    } else Object.values(v).forEach((x) => visit(x, depth + 1));
  };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      visit(JSON.parse(s.textContent));
    } catch {}
  });
  const root =
    [
      ...document.querySelectorAll(
        '.jobs-search__job-details--container,.jobs-details,[data-testid="jobsearch-ViewjobPaneWrapper"],.jobsearch-ViewJobLayout,[data-automation-id="jobPostingPage"]',
      ),
    ].find(visible) || document;
  let position = pick(root, [
    '.job-details-jobs-unified-top-card__job-title h1',
    '.job-details-jobs-unified-top-card__job-title',
    '.top-card-layout__title',
    '.jobs-unified-top-card__job-title',
    '[data-testid="jobsearch-JobInfoHeader-title"]',
    '.jobsearch-JobInfoHeader-title',
    '[data-automation-id="jobPostingHeader"]',
    '.posting-headline h2',
    'h1.app-title',
    'h1',
  ]);
  let company =
    pick(root, [
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name',
      '.topcard__org-name-link',
      '[data-testid="inlineHeader-companyName"]',
      '[data-testid="company-name"]',
      '.company-name',
      '[data-automation-id="companyName"]',
    ]) ||
    (/(^|\.)greenhouse\.io$/.test(location.hostname)
      ? clean(document.querySelector('.job-post .logo img')?.alt).replace(/\s+logo$/i, '')
      : '');
  const locationText = pick(root, [
    '.job-details-jobs-unified-top-card__tertiary-description-container',
    '[data-testid="inlineHeader-companyLocation"]',
    '[data-automation-id="locations"]',
    '.posting-categories .location',
    '.job__location',
    '.location',
  ]);
  let description = pick(root, [
    '#job-details',
    '.show-more-less-html__markup',
    '#jobDescriptionText',
    '[data-automation-id="jobPostingDescription"]',
    '.posting-page .content',
    '.section-wrapper',
    '#content .content',
    '.job-description',
    '.job__description',
    '[itemprop="description"]',
  ]);
  // LinkedIn's newer search-results view uses job links and semantic headings,
  // rather than the legacy jobs-details class names. Stay within posting content.
  if (source === 'LinkedIn') {
    const currentId =
      new URL(location.href).searchParams.get('currentJobId') ||
      location.pathname.match(/\/jobs\/view\/(\d+)/)?.[1];
    const titleLink = currentId
      ? [...document.querySelectorAll('a[href]')].find(
          (e) =>
            visible(e) &&
            !e.closest('form,[role="dialog"]') &&
            new URL(e.href, location.href).pathname.replace(/\/$/, '') ===
              `/jobs/view/${currentId}`,
        )
      : null;
    if (titleLink) {
      position = text(titleLink.innerHTML) || position;
      if (!company) {
        const links = [...document.querySelectorAll('a[href*="/company/"]')].filter(
          (e) =>
            visible(e) &&
            !e.closest('form,[role="dialog"]') &&
            e.compareDocumentPosition(titleLink) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
        company = text(links.at(-1)?.innerHTML || '');
      }
    }
    if (!description) {
      const heading = [...document.querySelectorAll('h1,h2,h3,[role="heading"]')].find(
        (e) =>
          visible(e) &&
          clean(e.textContent) === 'About the job' &&
          !e.closest('form,[role="dialog"]'),
      );
      if (heading) {
        let section = heading;
        for (let i = 0; i < 3 && section; i++, section = section.parentElement) {
          const next = section.nextElementSibling;
          if (
            next &&
            visible(next) &&
            !next.matches('form,aside,nav') &&
            !next.querySelector('form,input,textarea,select') &&
            clean(next.textContent)
          ) {
            description = text(next.innerHTML);
            break;
          }
        }
      }
    }
    // Selected detail content takes precedence over stale structured data in SPA navigation.
    if (titleLink && (company || description))
      return [
        {
          company,
          position,
          location: locationText,
          workArrangement: arrangement(locationText),
          employmentType: '',
          salaryRange: '',
          jobUrl: canonical(location.href),
          source,
          description,
          extraction: 'Selected LinkedIn posting',
        },
      ];
  }
  if (jobs.length === 1) return jobs;
  if (jobs.length > 1) {
    const match = jobs.filter(
      (j) => position && clean(j.position).toLowerCase() === position.toLowerCase(),
    );
    return match.length === 1 ? match : jobs;
  }
  return [
    {
      company,
      position,
      location: locationText,
      workArrangement: arrangement(locationText),
      employmentType: employment(
        pick(root, ['.posting-categories .commitment', '[data-automation-id="timeType"]']),
      ),
      salaryRange: pick(root, [
        '#salaryInfoAndJobType',
        '[data-testid="salaryInfoAndJobType"]',
        '.salary',
      ]),
      jobUrl: canonical(location.href),
      source,
      description,
      extraction: 'Page text — review missing fields',
    },
  ];
}
if (typeof module !== 'undefined') module.exports = { extractJobs };
