import { useMemo, useState } from 'react';
import {
  EMPLOYMENT_TYPES,
  SOURCES,
  STATUSES,
  WORK_ARRANGEMENTS,
  type JobApplication,
  type NewJobApplication,
  type Resume,
} from '../types/application';
import { isValidUrl } from '../utils/format';

type FormValues = Omit<NewJobApplication, 'followUpCompleted'>;
interface Props {
  initial?: JobApplication;
  resumes?: Resume[];
  defaultResumeId?: number | null;
  locationSuggestions?: string[];
  submitting: boolean;
  onSubmit: (value: NewJobApplication) => Promise<void>;
  onCancel: () => void;
}
const empty: FormValues = {
  company: '',
  position: '',
  status: 'Interested',
  location: null,
  workArrangement: null,
  employmentType: null,
  jobUrl: null,
  salaryRange: null,
  contactName: null,
  contactEmail: null,
  dateApplied: null,
  followUpDate: null,
  interviewDate: null,
  source: null,
  notes: null,
  resumeId: null,
};
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ApplicationForm({
  initial,
  resumes = [],
  defaultResumeId = null,
  locationSuggestions = [],
  submitting,
  onSubmit,
  onCancel,
}: Props) {
  const [values, setValues] = useState<FormValues>(
    initial
      ? {
          company: initial.company,
          position: initial.position,
          status: initial.status,
          location: initial.location,
          workArrangement: initial.workArrangement,
          employmentType: initial.employmentType,
          jobUrl: initial.jobUrl,
          salaryRange: initial.salaryRange,
          contactName: initial.contactName,
          contactEmail: initial.contactEmail,
          dateApplied: initial.dateApplied,
          followUpDate: initial.followUpDate,
          interviewDate: initial.interviewDate,
          source: initial.source,
          notes: initial.notes,
          resumeId: initial.resumeId,
        }
      : { ...empty, resumeId: defaultResumeId },
  );
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const errors = useMemo(
    () => ({
      company: values.company.trim() ? '' : 'Company name is required.',
      position: values.position.trim() ? '' : 'Position title is required.',
      contactEmail:
        values.contactEmail && !emailPattern.test(values.contactEmail)
          ? 'Enter a valid email address.'
          : '',
      jobUrl:
        values.jobUrl && !isValidUrl(values.jobUrl)
          ? 'Enter a complete http:// or https:// URL.'
          : '',
    }),
    [values],
  );
  const valid = Object.values(errors).every((error) => !error);
  const update = (key: keyof FormValues, value: string) =>
    setValues((current) => ({
      ...current,
      [key]: key === 'company' || key === 'position' ? value : value || null,
    }));
  const input = (key: keyof FormValues, label: string, type = 'text', placeholder = '') => (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={String(values[key] ?? '')}
        placeholder={placeholder}
        onChange={(e) => update(key, e.target.value)}
        onBlur={() => setTouched((t) => ({ ...t, [key]: true }))}
        aria-invalid={Boolean(touched[key] && errors[key as keyof typeof errors])}
      />
      {touched[key] && errors[key as keyof typeof errors] && (
        <small className="field-error">{errors[key as keyof typeof errors]}</small>
      )}
    </label>
  );
  const locationInput = (
    <label className="field">
      <span>Location</span>
      <input
        type="text"
        list="saved-locations"
        value={values.location ?? ''}
        placeholder="e.g. Chicago, IL"
        onChange={(event) => update('location', event.target.value)}
      />
      <datalist id="saved-locations">
        {locationSuggestions.map((location) => (
          <option key={location} value={location} />
        ))}
      </datalist>
    </label>
  );
  const select = (
    key: keyof FormValues,
    label: string,
    options: readonly string[],
    required = false,
  ) => (
    <label className="field">
      <span>
        {label}
        {required && ' *'}
      </span>
      <select value={String(values[key] ?? '')} onChange={(e) => update(key, e.target.value)}>
        {!required && <option value="">Select…</option>}
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setTouched({ company: true, position: true, contactEmail: true, jobUrl: true });
    if (!valid) return;
    await onSubmit({
      ...values,
      company: values.company.trim(),
      position: values.position.trim(),
      followUpCompleted: initial?.followUpCompleted ?? false,
    });
  };

  return (
    <form className="application-form" onSubmit={submit} noValidate>
      <section className="form-section">
        <div className="section-heading">
          <h2>Role details</h2>
          <p>The essentials about this opportunity.</p>
        </div>
        <div className="form-grid">
          {input('company', 'Company name *', 'text', 'e.g. Contoso')}
          {input('position', 'Position title *', 'text', 'e.g. Product Designer')}
          {select('status', 'Status', STATUSES, true)}
          {locationInput}
          {select('workArrangement', 'Work arrangement', WORK_ARRANGEMENTS)}
          {select('employmentType', 'Employment type', EMPLOYMENT_TYPES)}
          {input('salaryRange', 'Salary range', 'text', 'e.g. $90,000–$110,000')}
          {select('source', 'Source', SOURCES)}
        </div>
      </section>
      <section className="form-section">
        <div className="section-heading">
          <h2>Timeline</h2>
          <p>
            Record the application date here. Interviews and follow-ups now live in the activity
            timeline and Tasks.
          </p>
        </div>
        <div className="form-grid">{input('dateApplied', 'Date applied', 'date')}</div>
      </section>
      <section className="form-section">
        <div className="section-heading">
          <h2>Contact & link</h2>
          <p>Useful details for your next conversation.</p>
        </div>
        <div className="form-grid">
          {input('contactName', 'Contact name')}
          {input('contactEmail', 'Contact email', 'email', 'name@company.com')}
          {input('jobUrl', 'Job posting URL', 'url', 'https://…')}
        </div>
      </section>
      <section className="form-section">
        <div className="section-heading">
          <h2>Notes</h2>
          <p>Capture context, preparation, and next steps.</p>
        </div>
        <label className="field full">
          <span>Notes</span>
          <textarea
            rows={6}
            value={values.notes ?? ''}
            onChange={(e) => update('notes', e.target.value)}
            placeholder="Add anything you want to remember…"
          />
        </label>
      </section>
      <section className="form-section">
        <div className="section-heading">
          <h2>Resume</h2>
          <p>Record the resume version used for this application.</p>
        </div>
        <label className="field full">
          <span>Resume used</span>
          <select
            value={values.resumeId ?? ''}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                resumeId: event.target.value ? Number(event.target.value) : null,
              }))
            }
          >
            <option value="">No resume selected</option>
            {initial?.resumeDeleted && initial.resumeId && (
              <option value={initial.resumeId}>{initial.resumeName} (deleted)</option>
            )}
            {resumes.map((resume) => (
              <option key={resume.id} value={resume.id}>
                {resume.name}
                {resume.isCurrent ? ' (current)' : ''}
              </option>
            ))}
          </select>
        </label>
      </section>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className="button primary" disabled={!valid || submitting}>
          {submitting ? 'Saving…' : initial ? 'Save changes' : 'Add application'}
        </button>
      </div>
    </form>
  );
}
