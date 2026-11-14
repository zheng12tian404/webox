import { useEffect, useState } from 'react';
import { t } from '../../i18n/en';
import { EP } from '../../api/endpoints';
import { api } from '../../api/client';
import type { DailyMenuRow } from '../../api/types';
import { useApiQuery } from '../../hooks/useApiQuery';
import { notify } from '../../store/uiStore';
import { addDays } from '../../utils/datetime';
import { EmptyState, ErrorState, SkeletonRows } from '../../components/ui/Feedback';
import { ConfirmReasonModal } from '../../components/console/ConfirmReasonModal';

const todayStr = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

interface RowEdit {
  totalQty: number;
  published: boolean;
}

export function DailyMenuPage() {
  const [date, setDate] = useState(() => addDays(todayStr(), 1));
  const rows = useApiQuery<DailyMenuRow[]>(`${EP.dailyMenu}?date=${encodeURIComponent(date)}`, [date]);
  const [edits, setEdits] = useState<Record<number, RowEdit>>({});
  const [publishOpen, setPublishOpen] = useState(false);
  const [rowTarget, setRowTarget] = useState<DailyMenuRow | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!rows.data) return;
    const next: Record<number, RowEdit> = {};
    for (const row of rows.data) next[row.dishId] = { totalQty: row.totalQty, published: row.published };
    setEdits(next);
  }, [rows.data]);

  const setRow = (dishId: number, patch: Partial<RowEdit>) => {
    setEdits((prev) => ({
      ...prev,
      [dishId]: { ...(prev[dishId] ?? { totalQty: 0, published: false }), ...patch },
    }));
  };

  const publish = async (reason: string) => {
    setBusy(true);
    try {
      const items = (rows.data ?? []).map((row) => ({
        dishId: row.dishId,
        published: edits[row.dishId]?.published ?? row.published,
        totalQty: edits[row.dishId]?.totalQty ?? row.totalQty,
        inventoryMode: row.inventoryMode,
      }));
      const totalQty = items.reduce((sum, it) => sum + it.totalQty, 0);
      await api.put(EP.dailyMenu, { serveDate: date, totalQty, items, confirm: true, reason });
      notify.success(t('console.menuPublished'));
      setPublishOpen(false);
      rows.reload();
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };

  const saveRow = async (reason: string) => {
    if (!rowTarget) return;
    setBusy(true);
    try {
      const totalQty = edits[rowTarget.dishId]?.totalQty ?? rowTarget.totalQty;
      await api.put(EP.dailyMenuStock(date, rowTarget.dishId), { totalQty, confirm: true, reason });
      notify.success(t('console.stockUpdated'));
      setRowTarget(null);
      rows.reload();
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="console-top">
        <div>
          <h1 style={{ fontSize: 23 }}>{t('console.dailyMenu')}</h1>
          <p className="page-sub">Publish dishes and set daily stock. Employees see changes immediately.</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setPublishOpen(true)}
          disabled={!rows.data?.length}
          data-testid="daily-menu-publish"
        >
          {t('console.publish')}
        </button>
      </div>

      <div className="card card-pad console-toolbar" style={{ marginBottom: 16 }}>
        <div className="field">
          <label className="label" htmlFor="daily-date">{t('console.serveDate')}</label>
          <input
            id="daily-date"
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            data-testid="daily-menu-date"
          />
        </div>
        <button type="button" className="btn btn-outline" onClick={rows.reload}>{t('console.refresh')}</button>
      </div>

      {rows.loading ? (
        <SkeletonRows count={6} />
      ) : rows.error ? (
        <ErrorState error={rows.error} onRetry={rows.reload} />
      ) : (rows.data?.length ?? 0) === 0 ? (
        <div className="card"><EmptyState title="No dishes configured for this date." /></div>
      ) : (
        <div className="card table-wrap">
          <table className="console-table-cards">
            <thead>
              <tr>
                <th>Dish</th>
                <th>{t('console.totalQty')}</th>
                <th>{t('console.reserved')}</th>
                <th>{t('console.sold')}</th>
                <th>{t('console.available')}</th>
                <th>{t('console.inventoryMode')}</th>
                <th>{t('console.published')}</th>
                <th>{t('console.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.data?.map((row) => (
                <tr key={row.dishId} data-testid={`daily-menu-row-${row.dishId}`}>
                  <td data-label="Dish">
                    <div className="cell-strong">{row.dishName}</div>
                    <div className="small muted">#{row.dishId}</div>
                  </td>
                  <td data-label={t('console.totalQty')}>
                    <input
                      className="input tabular"
                      style={{ width: 92 }}
                      inputMode="numeric"
                      value={String(edits[row.dishId]?.totalQty ?? row.totalQty)}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^\d]/g, '');
                        setRow(row.dishId, { totalQty: v ? Number(v) : 0 });
                      }}
                      data-testid="daily-menu-qty"
                    />
                  </td>
                  <td data-label={t('console.reserved')} className="tabular">{row.reservedQty}</td>
                  <td data-label={t('console.sold')} className="tabular">{row.soldQty}</td>
                  <td data-label={t('console.available')}>
                    <span className={`badge ${row.available <= 0 ? 'badge-red' : row.lowStock ? 'badge-orange' : 'badge-green'}`}>
                      {row.available <= 0 ? t('console.soldOut') : row.available}
                    </span>
                  </td>
                  <td data-label={t('console.inventoryMode')}>
                    <span className="badge badge-blue">{row.inventoryMode}</span>
                  </td>
                  <td data-label={t('console.published')}>
                    <label className="check-row" style={{ margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={edits[row.dishId]?.published ?? row.published}
                        onChange={(e) => setRow(row.dishId, { published: e.target.checked })}
                      />
                      <span className="small">{edits[row.dishId]?.published ?? row.published ? t('console.published') : t('console.unpublished')}</span>
                    </label>
                  </td>
                  <td data-label={t('console.actions')}>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setRowTarget(row)}>
                      {t('common.save')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmReasonModal
        open={publishOpen}
        title={t('console.publish')}
        description={`Publish the menu for ${date}. This affects what employees can order.`}
        busy={busy}
        onClose={() => setPublishOpen(false)}
        onConfirm={(reason) => void publish(reason)}
        confirmLabel={t('console.publish')}
      />

      <ConfirmReasonModal
        open={Boolean(rowTarget)}
        title={t('console.stockUpdated')}
        description={rowTarget ? `Set total quantity for ${rowTarget.dishName} on ${date}. It cannot go below reserved + sold (${rowTarget.reservedQty + rowTarget.soldQty}).` : undefined}
        busy={busy}
        onClose={() => setRowTarget(null)}
        onConfirm={(reason) => void saveRow(reason)}
        confirmLabel={t('common.save')}
      />
    </div>
  );
}
