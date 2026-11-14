import { useState } from 'react';
import { t } from '../../i18n/en';
import { EP } from '../../api/endpoints';
import { pageQuery } from '../../api/client';
import type { AuditRow, Paged } from '../../api/types';
import { useApiQuery } from '../../hooks/useApiQuery';
import { formatDateTime } from '../../utils/datetime';
import { EmptyState, ErrorState, SkeletonRows } from '../../components/ui/Feedback';
import { Pagination } from '../../components/ui/Pagination';

export function AuditPage() {
  const [action, setAction] = useState('');
  const [objectType, setObjectType] = useState('');
  const [page, setPage] = useState(1);
  const path = `${EP.audit}${pageQuery({ page, size: 20, action: action || undefined, objectType: objectType || undefined })}`;
  const logs = useApiQuery<Paged<AuditRow>>(path, [path]);
  const items = logs.data?.items ?? [];

  const apply = () => {
    setPage(1);
    logs.reload();
  };

  return (
    <div>
      <div className="console-top">
        <div>
          <h1 style={{ fontSize: 23 }}>{t('console.audit')}</h1>
          <p className="page-sub">Every high-risk action is recorded with before/after values.</p>
        </div>
      </div>

      <div className="card card-pad console-toolbar" style={{ marginBottom: 16 }}>
        <div className="field">
          <label className="label" htmlFor="audit-action">{t('console.auditAction')}</label>
          <input
            id="audit-action"
            className="input"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="e.g. DISH_UPDATE"
            data-testid="audit-filter-action"
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="audit-object">{t('console.auditObject')}</label>
          <input id="audit-object" className="input" value={objectType} onChange={(e) => setObjectType(e.target.value)} placeholder="e.g. DISH" />
        </div>
        <button type="button" className="btn btn-primary" onClick={apply}>{t('console.apply')}</button>
      </div>

      {logs.loading ? (
        <SkeletonRows />
      ) : logs.error ? (
        <ErrorState error={logs.error} onRetry={logs.reload} />
      ) : items.length === 0 ? (
        <div className="card"><EmptyState title="No audit records." /></div>
      ) : (
        <div className="card table-wrap">
          <table className="console-table-cards" data-testid="audit-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>{t('console.auditAction')}</th>
                <th>{t('console.auditObject')}</th>
                <th>{t('console.reason')}</th>
                <th>IP</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row, idx) => (
                <tr key={row.id ?? idx}>
                  <td data-label="Time" className="small tabular">{formatDateTime(row.createdAt)}</td>
                  <td data-label="Actor" className="small">{row.actorEmail ?? row.actorId ?? '—'}</td>
                  <td data-label={t('console.auditAction')}><span className="badge">{row.action ?? '—'}</span></td>
                  <td data-label={t('console.auditObject')} className="small">{row.objectType ?? '—'} {row.objectId ?? ''}</td>
                  <td data-label={t('console.reason')} className="small">{row.reason ?? '—'}</td>
                  <td data-label="IP" className="small">{row.ip ?? '—'}</td>
                  <td data-label="Details">
                    <details>
                      <summary className="small">before / after</summary>
                      <div className="small muted" style={{ marginTop: 6 }}>{t('console.before')}</div>
                      <pre className="pre-json">{JSON.stringify(row.before ?? null, null, 2)}</pre>
                      <div className="small muted">{t('console.after')}</div>
                      <pre className="pre-json">{JSON.stringify(row.after ?? null, null, 2)}</pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} size={20} total={logs.data?.total ?? 0} onChange={setPage} />
    </div>
  );
}
