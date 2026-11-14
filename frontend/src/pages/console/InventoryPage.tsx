import { useState } from 'react';
import { t } from '../../i18n/en';
import { EP } from '../../api/endpoints';
import { api } from '../../api/client';
import type { ReconcileResult } from '../../api/types';
import { useApiQuery } from '../../hooks/useApiQuery';
import { notify } from '../../store/uiStore';
import { ErrorState, SkeletonRows } from '../../components/ui/Feedback';
import { ConfirmReasonModal } from '../../components/console/ConfirmReasonModal';

const today = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function InventoryPage() {
  const [date, setDate] = useState(today());
  const [dishId, setDishId] = useState('');
  const [delta, setDelta] = useState('');
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const result = useApiQuery<ReconcileResult>(`${EP.reconcile}?date=${encodeURIComponent(date)}`, [date]);

  const submitAdjust = async (reason: string) => {
    setBusy(true);
    try {
      await api.post(EP.adjust, {
        dishId: Number(dishId),
        serveDate: date,
        delta: Number(delta),
        confirm: true,
        reason,
      });
      notify.success('Stock adjusted.');
      setAdjustOpen(false);
      setDishId('');
      setDelta('');
      result.reload();
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
          <h1 style={{ fontSize: 23 }}>{t('console.inventory')}</h1>
          <p className="page-sub">Compare book availability against the inventory ledger.</p>
        </div>
      </div>

      <div className="card card-pad console-toolbar" style={{ marginBottom: 16 }}>
        <div className="field">
          <label className="label" htmlFor="inv-date">{t('console.date')}</label>
          <input id="inv-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <button type="button" className="btn btn-primary" onClick={result.reload} data-testid="inventory-drift">
          {t('console.reconcile')}
        </button>
      </div>

      {result.loading ? (
        <SkeletonRows />
      ) : result.error ? (
        <ErrorState error={result.error} onRetry={result.reload} />
      ) : result.data ? (
        <div className="card card-pad stack-sm" data-testid="reconcile-result">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="muted small">Checked {result.data.checked} dishes on {result.data.date}</span>
            <span className={`badge ${result.data.drift.length ? 'badge-red' : 'badge-green'}`}>
              {result.data.drift.length ? `${result.data.drift.length} drift` : t('console.driftZero')}
            </span>
          </div>
          {result.data.drift.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Dish ID</th><th>Book available</th><th>Ledger derived</th><th>Drift</th></tr>
                </thead>
                <tbody>
                  {result.data.drift.map((row) => (
                    <tr key={row.dishId} className="drift-row">
                      <td>{row.dishId}</td>
                      <td>{row.bookAvailable}</td>
                      <td>{row.ledgerDerived}</td>
                      <td>{row.bookAvailable - row.ledgerDerived}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      <section className="card card-pad" style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 17, marginBottom: 12 }}>{t('console.adjust')}</h2>
        <div className="form-grid">
          <div className="field">
            <label className="label" htmlFor="inv-dish">Dish ID</label>
            <input id="inv-dish" className="input tabular" inputMode="numeric" value={dishId} onChange={(e) => setDishId(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="inv-delta">{t('console.delta')} (+/−)</label>
            <input id="inv-delta" className="input tabular" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} />
          </div>
        </div>
        <button
          type="button"
          className="btn btn-outline"
          style={{ marginTop: 14 }}
          disabled={!dishId || !delta || !Number.isInteger(Number(delta))}
          onClick={() => setAdjustOpen(true)}
          data-testid="inventory-adjust"
        >
          {t('console.adjust')}
        </button>
      </section>

      <ConfirmReasonModal
        open={adjustOpen}
        title={t('console.adjust')}
        description={`Adjust dish #${dishId} stock by ${delta} on ${date}. This writes an inventory ledger entry and an audit record.`}
        onClose={() => setAdjustOpen(false)}
        onConfirm={(reason) => void submitAdjust(reason)}
        busy={busy}
        confirmLabel={t('console.adjust')}
      />
    </div>
  );
}
