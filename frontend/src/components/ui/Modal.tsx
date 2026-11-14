import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  large?: boolean;
  drawer?: boolean;
}

export function Modal({ open, onClose, title, children, footer, large, drawer }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className={drawer ? 'overlay drawer-overlay' : 'overlay'} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={drawer ? 'drawer' : `modal${large ? ' modal-lg' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? 'Dialog'}
      >
        <div className="modal-head">
          {title ? <h2 className="modal-title">{title}</h2> : <span />}
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
