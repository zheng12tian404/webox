import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { t } from '../../i18n/en';
import { EP } from '../../api/endpoints';
import { pageQuery } from '../../api/client';
import type { OrderStatus, OrderSummary, Paged } from '../../api/types';
import { useApiQuery } from '../../hooks/useApiQuery';
import { formatMoney } from '../../utils/money';
import { formatDateTime } from '../../utils/datetime';
import { EmptyState, ErrorState, SkeletonRows, StatusBadge } from '../../components/ui/Feedback';
import { Pagination } from '../../components/ui/Pagination';

const STATUSES: Array<OrderStatus | 'All'> = ['All', 'Pending', 'Confirmed', 'Completed', 'Cancelled'];

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const size = 20;
  const status = (params.get('status') ?? 'All') as OrderStatus | 'All';
  const path = `${EP.orders}${pageQuery({ page, size, status: status === 'All' ? undefined : status })}`;
  const orders = useApiQuery<Paged<OrderSummary>>(path, [path]);

  const setStatus = (s: string) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (s === 'All') next.delete('status');
        else next.set('status', s);
        next.set('page', '1');
        return next;
      },
      { replace: true },
    );
  };

  const setPage = (p: number) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('page', String(p));
        return next;
      },
      { replace: true },
    );
  };

  const items = orders.data?.items ?? [];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t('orders.title')}</h1>
          <p className="page-sub">Track your meal orders and cancel while pending.</p>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={status === s}
            className={`tab${status === s ? ' active' : ''}`}
            onClick={() => setStatus(s)}
            data-testid={`orders-tab-${s}`}
          >
            {s === 'All' ? t('orders.all') : t(`order.status.${s}`)}
          </button>
        ))}
      </div>

      {orders.loading ? (
        <SkeletonRows />
      ) : orders.error ? (
        <ErrorState error={orders.error} onRetry={orders.reload} />
      ) : items.length === 0 ? (
        <div className="card" data-testid="orders-empty">
          <EmptyState
            title={t('orders.empty')}
            action={<Link to="/menu" className="btn btn-primary btn-sm">{t('cart.browseMenu')}</Link>}
          />
        </div>
      ) : (
        <div className="stack-sm" data-testid="orders-list">
          {items.map((o) => (
            <div className="card order-card" key={o.orderId} data-testid={`order-row-${o.orderNo}`}>
              <div>
                <div className="row" style={{ gap: 10 }}>
                  <Link to={`/orders/${o.orderId}`} className="cell-strong tabular">{o.orderNo}</Link>
                  <StatusBadge status={o.status} />
                </div>
                <div className="order-meta" style={{ marginTop: 8 }}>
                  <span>{o.mealType} · {o.deliveryDate}</span>
                  <span>{o.itemCount} item{o.itemCount === 1 ? '' : 's'}</span>
                  <span>{t('orders.createdAt')}: {formatDateTime(o.createdAt)}</span>
                </div>
              </div>
              <div className="row">
                <strong className="price tabular">{formatMoney(o.totalCents)}</strong>
                <Link to={`/orders/${o.orderId}`} className="btn btn-outline btn-sm">{t('orders.view')}</Link>
              </div>
            </div>
          ))}
        </div>
      )}

      <Pagination page={page} size={size} total={orders.data?.total ?? 0} onChange={setPage} />
    </div>
  );
}
