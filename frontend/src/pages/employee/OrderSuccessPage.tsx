import { Link, useLocation, useParams } from 'react-router-dom';
import { t } from '../../i18n/en';
import { EP } from '../../api/endpoints';
import type { CreatedOrder, OrderDetail } from '../../api/types';
import { useApiQuery } from '../../hooks/useApiQuery';
import { formatMoney } from '../../utils/money';
import { Spinner } from '../../components/ui/Feedback';

export function OrderSuccessPage() {
  const { orderId } = useParams();
  const location = useLocation();
  const stateOrder = (location.state as { order?: CreatedOrder } | null)?.order;
  const id = Number(orderId);
  const detail = useApiQuery<OrderDetail>(!stateOrder && Number.isFinite(id) ? EP.order(id) : null, [id, Boolean(stateOrder)]);

  const order = stateOrder ?? detail.data;

  return (
    <div className="card success-card" data-testid="order-success">
      <div className="success-icon" aria-hidden="true">✓</div>
      <h1 style={{ fontSize: 25 }}>{t('success.title')}</h1>
      <p className="muted" style={{ margin: '8px 0 20px' }}>{t('success.message')}</p>
      {!order ? (
        <Spinner />
      ) : (
        <div className="stack-sm" style={{ textAlign: 'left' }}>
          <div className="summary-row">
            <span className="muted">{t('success.orderNo')}</span>
            <strong className="tabular" data-testid="order-no">{order.orderNo}</strong>
          </div>
          <div className="summary-row">
            <span className="muted">{t('orders.delivery')}</span>
            <span className="tabular" data-testid="order-delivery">{order.mealType} · {order.deliveryDate}</span>
          </div>
          {'address' in order && order.address ? (
            <div className="summary-row"><span className="muted">{t('checkout.address')}</span><span>{order.address}</span></div>
          ) : null}
          <div className="summary-row">
            <span className="muted">{t('cart.total')}</span>
            <strong className="tabular">{formatMoney(order.totalCents)}</strong>
          </div>
          {order.estimatedDelivery ? (
            <div className="summary-row"><span className="muted">Estimated</span><span>{order.estimatedDelivery}</span></div>
          ) : null}
        </div>
      )}
      <div className="row" style={{ justifyContent: 'center', marginTop: 22, gap: 10 }}>
        <Link to={`/orders/${order?.orderId ?? id}`} className="btn btn-primary">{t('success.viewOrder')}</Link>
        <Link to="/menu" className="btn btn-outline">{t('success.backToMenu')}</Link>
      </div>
    </div>
  );
}
