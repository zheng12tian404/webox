import type { ReactNode } from 'react';
import { t } from '../../i18n/en';
import type { ApiError } from '../../api/errors';
import { errorMessage } from '../../api/errors';

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty-state" data-testid="empty-state">
      <div className="empty-icon" aria-hidden="true">◎</div>
      <h3>{title}</h3>
      {hint ? <p className="muted small">{hint}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError | null; onRetry?: () => void }) {
  const message = error ? errorMessage(error) : t('error.network');
  return (
    <div className="empty-state" role="alert">
      <div className="empty-icon" aria-hidden="true">!</div>
      <h3>{message}</h3>
      {error?.requestId ? <p className="muted small tabular">{t('error.requestId', { id: error.requestId })}</p> : null}
      {error?.code ? <p className="muted small">{error.code}</p> : null}
      {onRetry ? (
        <button type="button" className="btn btn-primary btn-sm" onClick={onRetry}>
          {t('common.retry')}
        </button>
      ) : null}
    </div>
  );
}

export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="dish-grid" aria-busy="true" aria-label={t('common.loading')}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton skeleton-card" />
      ))}
    </div>
  );
}

export function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="stack-sm" aria-busy="true" aria-label={t('common.loading')}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: 44 }} />
      ))}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row small muted" role="status">
      <span className="spinner" aria-hidden="true" />
      {label ?? t('common.loading')}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'Completed'
      ? 'badge-green'
      : status === 'Confirmed'
        ? 'badge-blue'
        : status === 'Cancelled'
          ? 'badge-red'
          : 'badge-orange';
  return <span className={`badge ${cls}`}>{t(`order.status.${status}`) === `order.status.${status}` ? status : t(`order.status.${status}`)}</span>;
}
