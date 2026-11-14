import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { t } from '../../i18n/en';
import { EP } from '../../api/endpoints';
import { api, pageQuery } from '../../api/client';
import type { AdminOrderRow, OrderStatus, Paged } from '../../api/types';
import { useApiQuery } from '../../hooks/useApiQuery';
import { notify } from '../../store/uiStore';
import { formatMoney } from '../../utils/money';
import { formatDateTime } from '../../utils/datetime';
import { EmptyState, ErrorState, SkeletonRows, StatusBadge } from '../../components/ui/Feedback';
import { Pagination } from '../../components/ui/Pagination';
import { ConfirmReasonModal } from '../../components/console/ConfirmReasonModal';

const NEXT_STATUS: Record<string, Array<'Confirmed' | 'Completed' | 'Cancelled'>> = {
  Pending: ['Confirmed', 'Cancelled'],
  Confirmed: ['Completed'],
  Completed: [],
  Cancelled: [],
};

export function ConsoleOrdersPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const status = params.get('status') ?? '';
  const date = params.get('date') ?? '';
  const path = `${EP.adminOrders}${pageQuery({ page, size: 20, status: status || undefined, date: date || undefined })}`;
  const orders = useApiQuery<Paged<AdminOrderRow>>(path, [path]);
  const [target, setTarget] = useState<{ order: AdminOrderRow; next: 'Confirmed' | 'Completed' | 'Cancelled' } | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (patch: Record<string, string>) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: true },
    );
  };

  const applyStatus = async (reason: string) => {
    if (!target) return;
    setBusy(true);
    try {
      await api.patch(EP.adminOrderStatus(target.order.orderId), {
        toStatus: target.next,
        confirm: true,
        reason,
      });
      notify.success(`Order ${target.order.orderNo} → ${target.next}`);
      setTarget(null);
      orders.reload();
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };

  const items = orders.data?.items ?? [];

  return (
    <div>
      <div className="console-top">
        <div>
          <h1 style={{ fontSize: 23 }}>{t('console.orders')}</h1>
          <p className="page-sub">Pending → Confirmed → Completed; Pending can be cancelled. Addresses are masked.</p>
        </div>
      </div>

      <div className="card card-pad console-toolbar" style={{ marginBottom: 16 }}>
        <div className="field">
          <label className="label" htmlFor="order-status-filter">{t('console.statusFilter')}</label>
          <select
            id="order-status-filter"
            className="select"
            value={status}
            onChange={(e) => update({ status: e.target.value, page: '1' })}
          >
            <option value="">All</option>
            {(['Pending', 'Confirmed', 'Completed', 'Cancelled'] as OrderStatus[]).map((s) => (
              <option key={s} value={s}>{t(`order.status.${s}`)}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="order-date-filter">{t('console.date')}</label>
          <input
            id="order-date-filter"
            className="input"
            type="date"
            value={date}
            onChange={(e) => update({ date: e.target.value, page: '1' })}
          />
        </div>
        <button type="button" className="btn btn-outline" onClick={orders.reload}>{t('console.refresh')}</button>
      </div>

      {orders.loading ? (
        <SkeletonRows />
      ) : orders.error ? (
        <ErrorState error={orders.error} onRetry={orders.reload} />
      ) : items.length === 0 ? (
        <div className="card"><EmptyState title="No orders found." /></div>
      ) : (
        <div className="card table-wrap">
          <table className="console-table-cards" data-testid="console-orders">
            <thead>
              <tr>
                <th>{t('orders.orderNo')}</th>
                <th>{t('console.status')}</th>
                <th>{t('orders.total')}</th>
                <th>{t('orders.items')}</th>
                <th>{t('orders.delivery')}</th>
                <th>{t('orders.createdAt')}</th>
                <th>{t('console.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((order) => {
                const allowed = NEXT_STATUS[order.status] ?? [];
                return (
                  <tr key={order.orderId}>
                    <td data-label={t('orders.orderNo')}>
                      <Link to={`/orders/${order.orderId}`} className="tabular cell-strong">{order.orderNo}</Link>
                    </td>
                    <td data-label={t('console.status')}><StatusBadge status={order.status} /></td>
                    <td data-label={t('orders.total')} className="tabular">{formatMoney(order.totalCents)}</td>
                    <td data-label={t('orders.items')} className="tabular">{order.itemCount}</td>
                    <td data-label={t('orders.delivery')} className="small tabular">{order.mealType} · {order.deliveryDate}</td>
                    <td data-label={t('orders.createdAt')} className="small tabular">{formatDateTime(order.createdAt)}</td>
                    <td data-label={t('console.actions')}>
                      {allowed.length === 0 ? (
                        <span className="small muted">—</span>
                      ) : (
                        <div className="actions-cell">
                          {allowed.map((next) => (
                            <button
                              key={next}
                              type="button"
                              className={`btn btn-sm ${next === 'Cancelled' ? 'btn-danger' : 'btn-outline'}`}
                              onClick={() => setTarget({ order, next })}
                              data-testid={`admin-order-status-${order.orderId}`}
                            >
                              {next === 'Confirmed' ? t('common.confirm') : next === 'Completed' ? 'Complete' : t('orders.cancel')}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} size={20} total={orders.data?.total ?? 0} onChange={(p) => update({ page: String(p) })} />

      <ConfirmReasonModal
        open={Boolean(target)}
        title={t('console.adminOrderStatus')}
        description={target ? `Move ${target.order.orderNo} from ${target.order.status} to ${target.next}. Inventory side effects follow the state machine.` : undefined}
        danger={target?.next === 'Cancelled'}
        busy={busy}
        onClose={() => setTarget(null)}
        onConfirm={(reason) => void applyStatus(reason)}
        confirmLabel={t('console.adminOrderStatus')}
      />
    </div>
  );
}
