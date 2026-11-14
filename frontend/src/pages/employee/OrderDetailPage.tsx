import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { t } from '../../i18n/en';
import { EP } from '../../api/endpoints';
import { api } from '../../api/client';
import type { OrderDetail } from '../../api/types';
import { useApiQuery } from '../../hooks/useApiQuery';
import { notify } from '../../store/uiStore';
import { formatMoney } from '../../utils/money';
import { formatDateTime } from '../../utils/datetime';
import { MAX_REASON } from '../../utils/validation';
import { ErrorState, SkeletonRows, StatusBadge } from '../../components/ui/Feedback';
import { Modal } from '../../components/ui/Modal';

export function OrderDetailPage() {
  const { orderId } = useParams();
  const id = Number(orderId);
  const order = useApiQuery<OrderDetail>(Number.isFinite(id) ? EP.order(id) : null, [id]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const doCancel = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.post(EP.cancel(id), reason.trim() ? { reason: reason.trim().slice(0, MAX_REASON) } : {});
      notify.success(t('orders.cancelled'));
      setCancelOpen(false);
      setReason('');
      order.reload();
    } catch (e) {
      notify.error(e);
      order.reload();
    } finally {
      setBusy(false);
    }
  };

  if (order.loading) return <SkeletonRows count={3} />;
  if (order.error || !order.data) return <ErrorState error={order.error} onRetry={order.reload} />;

  const o = order.data;
  return (
    <div data-testid="order-detail">
      <div className="row small" style={{ marginBottom: 14 }}>
        <Link to="/orders">← {t('orders.title')}</Link>
      </div>
      <div className="page-head">
        <div>
          <h1 className="tabular">{o.orderNo}</h1>
          <div className="row" style={{ marginTop: 8 }}>
            <StatusBadge status={o.status} />
            <span className="muted small">{t('orders.createdAt')}: {formatDateTime(o.createdAt)}</span>
          </div>
        </div>
        {o.status === 'Pending' ? (
          <button type="button" className="btn btn-danger" onClick={() => setCancelOpen(true)} data-testid="order-cancel">
            {t('orders.cancel')}
          </button>
        ) : null}
      </div>

      <div className="cart-layout">
        <div className="card card-pad">
          <h2 style={{ fontSize: 17, marginBottom: 6 }}>{t('orders.detail')}</h2>
          <div className="order-items">
            {(o.items ?? []).map((item, idx) => (
              <div className="order-item" key={`${item.dishId}-${idx}`}>
                <div>
                  <div style={{ fontWeight: 600 }}>{item.dishName} × {item.qty}</div>
                  {item.options.length > 0 ? (
                    <div className="small muted">
                      {item.options.map((opt) => `${opt.name}${opt.priceDeltaCents ? ` (+${formatMoney(opt.priceDeltaCents)})` : ''}`).join(' · ')}
                    </div>
                  ) : null}
                  <div className="small muted">Unit {formatMoney(item.unitPriceCents)}</div>
                </div>
                <span className="tabular">{formatMoney(item.subtotalCents)}</span>
              </div>
            ))}
          </div>
          <div className="summary-row summary-total">
            <span>{t('cart.total')}</span>
            <span className="tabular">{formatMoney(o.totalCents)}</span>
          </div>
        </div>

        <aside className="card card-pad">
          <h2 style={{ fontSize: 17, marginBottom: 10 }}>Delivery</h2>
          <dl className="kv">
            <dt>{t('orders.delivery')}</dt>
            <dd className="tabular">{o.mealType} · {o.deliveryDate}</dd>
            <dt>{t('checkout.address')}</dt>
            <dd>{o.address}</dd>
            <dt>{t('orders.status')}</dt>
            <dd data-testid="order-status">{t(`order.status.${o.status}`)}</dd>
            {o.cancelledAt ? (
              <>
                <dt>Cancelled at</dt>
                <dd>{formatDateTime(o.cancelledAt)}</dd>
              </>
            ) : null}
            {o.cancelReason ? (
              <>
                <dt>Reason</dt>
                <dd>{o.cancelReason}</dd>
              </>
            ) : null}
          </dl>
        </aside>
      </div>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t('orders.cancel')}
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setCancelOpen(false)}>{t('common.cancel')}</button>
            <button type="button" className="btn btn-danger" onClick={() => void doCancel()} disabled={busy} data-testid="cancel-confirm">
              {busy ? t('common.loading') : t('orders.cancel')}
            </button>
          </>
        }
      >
        <p className="muted small">Stock will be released when the order is cancelled. This cannot be undone.</p>
        <div className="field">
          <label className="label" htmlFor="cancel-reason">{t('orders.cancelReason')}</label>
          <textarea
            id="cancel-reason"
            className="textarea"
            maxLength={MAX_REASON}
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, MAX_REASON))}
          />
          <span className="hint">{reason.length}/{MAX_REASON}</span>
        </div>
      </Modal>
    </div>
  );
}
