import { CheckCircle2, FilePlus2, FileText, Pencil, Star, Trash2 } from 'lucide-react';
import type { Resume } from '../types/application';
import { EmptyState } from '../components/ui';
import { formatDate } from '../utils/format';

interface Props {
  resumes: Resume[];
  busy: boolean;
  onAdd: () => void;
  onOpen: (resume: Resume) => void;
  onEdit: (resume: Resume) => void;
  onCurrent: (resume: Resume) => void;
  onDelete: (resume: Resume) => void;
}

export function ResumesPage({ resumes, busy, onAdd, onOpen, onEdit, onCurrent, onDelete }: Props) {
  return (
    <>
      <header className="page-header">
        <div>
          <p className="eyebrow">Document library</p>
          <h1>Resumes</h1>
          <p>Keep every resume version organized and ready for your next application.</p>
        </div>
        <button className="button primary" disabled={busy} onClick={onAdd}>
          <FilePlus2 size={17} />
          Add resume
        </button>
      </header>
      {resumes.length === 0 ? (
        <section className="panel">
          <EmptyState
            title="No resumes yet"
            description="Add a PDF or Word resume. JobTrack will keep a private managed copy."
            action={
              <button className="button primary" onClick={onAdd}>
                <FilePlus2 size={17} />
                Add your first resume
              </button>
            }
          />
        </section>
      ) : (
        <div className="resume-grid">
          {resumes.map((resume) => (
            <article
              className={`panel resume-card ${resume.isCurrent ? 'current' : ''}`}
              key={resume.id}
            >
              <div className="resume-card-top">
                <span className="resume-file-icon">
                  <FileText size={22} />
                </span>
                <div className="resume-card-title">
                  <div>
                    <h2>{resume.name}</h2>
                    {resume.isCurrent && (
                      <span className="current-badge">
                        <CheckCircle2 size={13} />
                        Current
                      </span>
                    )}
                  </div>
                  <p>{resume.originalFileName}</p>
                </div>
              </div>
              <p className="resume-notes">{resume.notes || 'No notes added.'}</p>
              <div className="resume-meta">
                <span>Added {formatDate(resume.createdAt, true)}</span>
                <span>
                  {resume.usageCount} application{resume.usageCount === 1 ? '' : 's'}
                </span>
                <span className={resume.fileExists ? 'file-ready' : 'file-missing'}>
                  {resume.fileExists ? 'File ready' : 'File missing'}
                </span>
              </div>
              <div className="resume-actions">
                <button
                  className="button secondary small"
                  disabled={!resume.fileExists}
                  onClick={() => onOpen(resume)}
                >
                  Open
                </button>
                {!resume.isCurrent && (
                  <button className="button ghost small" onClick={() => onCurrent(resume)}>
                    <Star size={15} />
                    Set current
                  </button>
                )}
                <span />
                <button
                  className="icon-button"
                  onClick={() => onEdit(resume)}
                  aria-label={`Edit ${resume.name}`}
                >
                  <Pencil size={16} />
                </button>
                <button
                  className="icon-button danger-text"
                  onClick={() => onDelete(resume)}
                  aria-label={`Delete ${resume.name}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
