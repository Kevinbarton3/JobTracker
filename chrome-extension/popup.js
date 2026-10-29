const $ = (id) => document.getElementById(id),
  fields = [
    'company',
    'position',
    'location',
    'workArrangement',
    'employmentType',
    'salaryRange',
    'jobUrl',
    'source',
    'description',
    'resumeId',
  ];
let tabId,
  draftKey,
  requestId = crypto.randomUUID(),
  savedId,
  pendingMode,
  requestMode,
  embeddedUrl;
const message = (s) => ($('message').textContent = s);
const native = async (payload) => {
  const r = await chrome.runtime.sendNativeMessage('com.jobtrack.capture', {
    version: 1,
    ...payload,
  });
  if (!r?.ok) throw Error(r?.error || 'JobTracker did not confirm the request.');
  return r.data;
};
/** @returns {import('./contracts').CapturePreview} */
const values = () => Object.fromEntries(fields.map((f) => [f, $(f).value]));
async function persist() {
  await chrome.storage.local.set({
    [draftKey]: { ...values(), requestId, savedId, requestMode, capturedAt: Date.now() },
  });
}
function fill(v) {
  fields.forEach((f) => ($(f).value = v[f] ?? ''));
  requestId = v.requestId || crypto.randomUUID();
  savedId = v.savedId;
  requestMode = v.requestMode;
  $('open').hidden = !savedId;
}
function busy(v) {
  document.querySelectorAll('button').forEach((b) => (b.disabled = v));
  $('save').disabled = v || !!embeddedUrl;
  $('applied').disabled = v || !!embeddedUrl;
}
function embeddedPosting(url) {
  try {
    const u = new URL(url);
    if (
      ['www.enthought.com', 'enthought.com'].includes(u.hostname) &&
      u.pathname.replace(/\/$/, '') === '/careers' &&
      u.searchParams.get('job')
    ) {
      const target = new URL('https://careers.enthought.com/careers.html');
      target.searchParams.set('job', u.searchParams.get('job'));
      return target.href;
    }
  } catch {}
  return undefined;
}
function showEmbedded(url) {
  embeddedUrl = url;
  $('embeddedNotice').hidden = !url;
  if (url) {
    message(
      'Open the actual Enthought posting below, then use the extension on that new tab. Your previous preview is kept until you capture again.',
    );
    busy(false);
  }
  return !!url;
}
async function capture() {
  const button = $('refresh');
  button.textContent = 'Reading current posting…';
  busy(true);
  message('Reading the selected job posting…');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!/^https?:/.test(tab?.url || ''))
      throw Error('Open a job posting on an ordinary website first.');
    if (showEmbedded(embeddedPosting(tab.url))) return;
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractJobs,
    });
    const raw = result[0]?.result || [];
    if (showEmbedded(raw.find((j) => j.embeddedUrl)?.embeddedUrl)) return;
    const jobs = raw.filter((j) => j.position || j.company || j.description);
    if (!jobs.length)
      throw Error(
        'No job details found. On LinkedIn, select a job and wait for its description to load. If Easy Apply is open, return to the job description.',
      );
    tabId = tab.id;
    draftKey = `draft:${tabId}:${tab.url}`;
    $('choices').replaceChildren();
    jobs.forEach((j, i) => {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = `${j.company || 'Unknown company'} — ${j.position || 'Unknown position'}`;
      $('choices').append(o);
    });
    $('choicesLabel').hidden = jobs.length < 2;
    $('choices').onchange = () => {
      fill(jobs[Number($('choices').value)]);
      void persist().catch((e) => message(e.message));
    };
    fill(jobs[0]);
    $('duplicates').hidden = true;
    await persist();
    message(
      jobs.length > 1
        ? 'Captured multiple postings. Choose one and review the fields.'
        : `Captured ${jobs[0].position || 'available job details'}. Review the fields, then choose Save job or I applied.`,
    );
  } catch (e) {
    message(`Capture failed: ${e.message} Your existing preview has been kept.`);
  } finally {
    busy(false);
    button.textContent = 'Capture current page again';
  }
}
async function save(mode, allowDuplicate = false, existingId = null) {
  if (embeddedUrl) return;
  if (!$('capture').reportValidity()) return;
  if (requestMode !== mode) {
    requestId = crypto.randomUUID();
    requestMode = mode;
  }
  busy(true);
  try {
    await persist();
    const r = await native({
      action: 'save',
      requestId,
      mode,
      allowDuplicate,
      existingId,
      draft: values(),
    });
    if (r.matches) {
      pendingMode = mode;
      $('duplicates').hidden = false;
      $('matches').replaceChildren();
      for (const m of r.matches) {
        const a = document.createElement('article');
        const t = document.createElement('p');
        t.textContent = `${m.company} â€” ${m.position} (${m.status})`;
        a.append(t);
        const open = document.createElement('button');
        open.textContent = 'Open existing';
        open.onclick = () =>
          void native({ action: 'open', id: m.id }).catch((e) => message(e.message));
        a.append(open);
        if (['Interested', 'Applied'].includes(m.status)) {
          const mark = document.createElement('button');
          mark.textContent = 'Mark applied';
          mark.onclick = () => void save('applied', false, m.id);
          a.append(mark);
        }
        $('matches').append(a);
      }
      $('anyway').hidden = r.matches.some((m) => m.exact);
      message('Review the existing applications before saving.');
      return;
    }
    savedId = r.id;
    $('open').hidden = false;
    $('duplicates').hidden = true;
    await persist();
    message('Saved to JobTracker.');
  } catch (e) {
    message(
      `${e.message}\nYour preview is retained. Retry after checking Settings â†’ Chrome extension.`,
    );
  } finally {
    busy(false);
  }
}
$('embeddedOpen').onclick = () => {
  if (embeddedUrl) void chrome.tabs.create({ url: embeddedUrl }).catch((e) => message(e.message));
};
$('capture').onsubmit = (e) => {
  e.preventDefault();
  void save(e.submitter?.value || 'save');
};
$('anyway').onclick = () => void save(pendingMode, true);
$('open').onclick = () =>
  void native({ action: 'open', id: savedId }).catch((e) => message(e.message));
$('refresh').onclick = () => void capture().catch((e) => message(e.message));
fields.forEach((f) =>
  $(f).addEventListener('input', () => {
    requestId = crypto.randomUUID();
    savedId = null;
    $('open').hidden = true;
    void persist();
  }),
);
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab.id;
    draftKey = `draft:${tabId}:${tab.url}`;
    const saved = (await chrome.storage.local.get(draftKey))[draftKey];
    if (saved) {
      fill(saved);
      message(
        'Restored your previous preview. To read updated job details, choose Capture current page again.',
      );
      showEmbedded(embeddedPosting(tab.url));
    } else await capture();
    try {
      const r = await native({ action: 'resumes' });
      const current = $('resumeId').value;
      for (const resume of r) {
        const o = document.createElement('option');
        o.value = resume.id;
        o.textContent = resume.name;
        $('resumeId').append(o);
      }
      $('resumeId').value = current || saved?.resumeId || '';
    } catch (e) {
      message(`${$('message').textContent}\nDesktop connection: ${e.message}`);
    }
  } catch (e) {
    message(e.message);
  }
})();
