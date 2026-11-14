import { useUiStore } from '../../store/uiStore';
import { t } from '../../i18n/en';

export function ToastHost() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismiss);
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast ${toast.kind}`}
          data-testid={toast.kind === 'error' ? 'toast-error' : 'toast'}
          data-error-code={toast.kind === 'error' ? toast.code : undefined}
          data-request-id={toast.requestId || undefined}
          role={toast.kind === 'error' ? 'alert' : 'status'}
        >
          <div style={{ flex: 1 }}>
            <div>{toast.message}</div>
            {toast.requestId ? (
              <div className="toast-meta tabular">{t('error.requestId', { id: toast.requestId })}</div>
            ) : null}
          </div>
          <button type="button" className="toast-close" onClick={() => dismiss(toast.id)} aria-label={t('common.close')}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
