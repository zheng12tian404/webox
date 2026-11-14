import { useEffect } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { t } from '../../i18n/en';
import { EP } from '../../api/endpoints';
import type { DashboardData } from '../../api/types';
import { useApiQuery } from '../../hooks/useApiQuery';
import { formatMoney } from '../../utils/money';
import { ErrorState, SkeletonRows } from '../../components/ui/Feedback';

export function DashboardPage() {
  const dashboard = useApiQuery<DashboardData>(EP.dashboard, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') dashboard.reload();
    }, 60000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (dashboard.loading) return <SkeletonRows count={4} />;
  if (dashboard.error) return <ErrorState error={dashboard.error} onRetry={dashboard.reload} />;
  if (!dashboard.data) return null;
  const d = dashboard.data;

  const topData = d.topDishes.map((x) => ({ name: x.name, sold: x.soldQty }));
  const mealData = [{ name: 'Meals', Lunch: d.mealSplit.lunch, Dinner: d.mealSplit.dinner }];
  const trendData = d.trend.map((x) => ({ date: x.date, orders: x.orders, revenue: Math.round(x.revenueCents / 100) }));

  return (
    <div>
      <div className="console-top">
        <div>
          <h1 style={{ fontSize: 23 }}>{t('console.dashboard')}</h1>
          <p className="page-sub">Counts exclude cancelled orders · low stock is 0–3 available.</p>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={dashboard.reload} data-testid="dashboard-refresh">
          {t('console.refresh')}
        </button>
      </div>

      <div className="tiles" data-testid="dashboard-tiles">
        <div className="card tile">
          <div className="tile-label">{t('console.todayOrders')}</div>
          <div className="tile-value" data-testid="tile-orders">{d.today.orders}</div>
        </div>
        <div className="card tile">
          <div className="tile-label">{t('console.todayRevenue')}</div>
          <div className="tile-value">{formatMoney(d.today.revenueCents)}</div>
        </div>
        <div className="card tile">
          <div className="tile-label">{t('console.completed')}</div>
          <div className="tile-value">{d.today.completed}</div>
        </div>
        <div className="card tile">
          <div className="tile-label">{t('console.pending')}</div>
          <div className="tile-value">{d.today.pending}</div>
        </div>
        <div className="card tile">
          <div className="tile-label">{t('console.cancelled')}</div>
          <div className="tile-value">{d.today.cancelled}</div>
        </div>
      </div>

      <div className="chart-grid" style={{ marginTop: 18 }}>
        <section className="card chart-card">
          <div className="chart-title">{t('console.topDishes')}</div>
          <div className="chart-note">Sold quantity, cancelled excluded.</div>
          {topData.length === 0 ? (
            <p className="muted small" style={{ padding: '30px 0' }}>{t('console.noData')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={topData} margin={{ top: 8, right: 8, left: -18, bottom: 36 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={56} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="sold" fill="#0f766e" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </section>

        <section className="card chart-card">
          <div className="chart-title">{t('console.mealSplit')}</div>
          <div className="chart-note">Non-cancelled orders.</div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={mealData} margin={{ top: 8, right: 8, left: -18, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="Lunch" fill="#0f766e" radius={[5, 5, 0, 0]} />
              <Bar dataKey="Dinner" fill="#f59e0b" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </section>
      </div>

      <div className="chart-grid" style={{ marginTop: 18 }}>
        <section className="card chart-card" data-testid="dashboard-trend">
          <div className="chart-title">{t('console.trend')}</div>
          <div className="chart-note">Orders and revenue (¥) per day.</div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trendData} margin={{ top: 8, right: 12, left: -18, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line yAxisId="left" type="monotone" dataKey="orders" stroke="#0f766e" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="revenue" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </section>

        <section className="card card-pad" data-testid="dashboard-lowstock">
          <div className="chart-title">{t('console.lowStock')}</div>
          <div className="chart-note">0 ≤ available ≤ 3.</div>
          {d.lowStock.length === 0 ? (
            <p className="muted small" style={{ padding: '22px 0' }}>No low-stock dishes.</p>
          ) : (
            <div className="stack-sm" style={{ marginTop: 10 }}>
              {d.lowStock.map((x) => (
                <div className="row" key={x.dishId} style={{ justifyContent: 'space-between' }}>
                  <span>{x.name}</span>
                  <span className="badge badge-orange">{x.available} left</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
