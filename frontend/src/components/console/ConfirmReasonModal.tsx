import { useState, type ReactNode } from 'react';
import { t } from '../../i18n/en';
import { MAX_REASON } from '../../utils/validation';
import { Modal } from '../ui/Modal';

interface Props {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

export function ConfirmReasonModal({ open, title, description, confirmLabel, danger, busy, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState('');

  const close = () => {
    setReason('');
    setChecked(false);
    setError('');
    onClose();
  };

  const submit = () => {
    if (!reason.trim()) {
      setError(t('console.reasonRequired'));
      return;
    }
    if (!checked) {
      setError('Please confirm you understand this action.');
      return;
    }
    setError('');
    onConfirm(reason.trim());
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={close}>{t('common.cancel')}</button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={submit}
            disabled={busy}
            data-testid="confirm-submit"
          >
            {busy ? t('common.loading') : confirmLabel ?? t('common.confirm')}
          </button>
        </>
      }
    >
      {description ? <div className="banner banner-warn">{description}</div> : null}
      <div className="field">
        <label className="label" htmlFor="confirm-reason">{t('console.reason')}</label>
        <textarea
          id="confirm-reason"
          className="textarea"
          maxLength={MAX_REASON}
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON))}
          data-testid="confirm-reason"
          aria-invalid={Boolean(error)}
        />
        <span className="hint">{reason.length}/{MAX_REASON}</span>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          data-testid="confirm-risk-check"
        />
        {t('console.confirmRisk')}
      </label>
      {error ? <p className="error-text" role="alert">{error}</p> : null}
    </Modal>
  );
}
