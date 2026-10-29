import { useEffect, useRef, type ReactNode } from 'react';
import { AlertCircle, Inbox, LoaderCircle, X } from 'lucide-react';
import type { ApplicationStatus } from '../types/application';

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span className={`status-badge status-${status.toLowerCase().replaceAll(' ', '-')}`}>
      {status}
    </span>
  );
}
export function SummaryCard({
  label,
  value,
  icon,
  tone = 'blue',
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone?: string;
}) {
  return (
    <article className="summary-card">
      <span className={`summary-icon ${tone}`}>{icon}</span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </article>
  );
}
export function LoadingIndicator({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state-box">
      <LoaderCircle className="spin" size={24} />
      <span>{label}</span>
    </div>
  );
}
export function ErrorMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-message" role="alert">
      <AlertCircle size={19} />
      <span>{message}</span>
      {onRetry && (
        <button className="text-button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Inbox size={28} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function ConfirmationDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <Dialog title={title} onClose={onCancel} alert>
      <p>{message}</p>
      <div className="dialog-actions">
        <button className="button secondary" onClick={onCancel}>
          Cancel
        </button>
        <button className={`button ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

export function Dialog({
  title,
  onClose,
  children,
  alert = false,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  alert?: boolean;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement),
  );
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const root = ref.current;
    const focusable = () =>
      Array.from(
        root?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]',
        ) ?? [],
      );
    if (!root?.contains(document.activeElement)) focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
      if (event.key === 'Tab') {
        const items = focusable();
        if (!items.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous.current?.focus();
    };
  }, []);
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={ref}
        className={`dialog ${wide ? 'dialog-wide' : ''}`}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="icon-button dialog-close" onClick={onClose} aria-label="Close">
          <X size={19} />
        </button>
        <h2 id="dialog-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Toast({
  message,
  tone,
  onClose,
  action,
}: {
  message: string;
  tone: 'success' | 'error';
  onClose: () => void;
  action?: ReactNode;
}) {
  return (
    <div
      className={`toast ${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span>{message}</span>
      {action}
      <button onClick={onClose} aria-label="Dismiss">
        <X size={17} />
      </button>
    </div>
  );
}
