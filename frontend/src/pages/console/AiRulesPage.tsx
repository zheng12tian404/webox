import { useEffect, useState } from 'react';
import { t } from '../../i18n/en';
import { EP } from '../../api/endpoints';
import { api } from '../../api/client';
import type { AiRule } from '../../api/types';
import { useApiQuery } from '../../hooks/useApiQuery';
import { notify } from '../../store/uiStore';
import { formatDateTime } from '../../utils/datetime';
import { ErrorState, SkeletonRows } from '../../components/ui/Feedback';
import { ConfirmReasonModal } from '../../components/console/ConfirmReasonModal';

export function AiRulesPage() {
  const rules = useApiQuery<AiRule>(EP.aiRules, []);
  const [configText, setConfigText] = useState('');
  const [rollback, setRollback] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jsonError, setJsonError] = useState('');

  useEffect(() => {
    if (rules.data) setConfigText(JSON.stringify(rules.data.config, null, 2));
  }, [rules.data]);

  const save = async (reason: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(configText);
    } catch {
      setJsonError('Config must be valid JSON.');
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await api.put(EP.aiRules, {
        configKey: rules.data?.configKey ?? 'default',
        config: parsed,
        confirm: true,
        reason,
        ...(rollback ? { rollbackToVersion: Number(rollback) } : {}),
      });
      notify.success('AI rules saved.');
      setOpen(false);
      setRollback('');
      rules.reload();
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (rules.loading) return <SkeletonRows />;
  if (rules.error) return <ErrorState error={rules.error} onRetry={rules.reload} />;

  return (
    <div>
      <div className="console-top">
        <div>
          <h1 style={{ fontSize: 23 }}>{t('console.aiRules')}</h1>
          <p className="page-sub">
            Version {rules.data?.version} · updated {formatDateTime(rules.data?.updatedAt)}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)} disabled={busy} data-testid="ai-rules-save">
          {t('common.save')}
        </button>
      </div>

      <div className="card card-pad stack-sm">
        <label className="label" htmlFor="ai-rules">{rules.data?.configKey}</label>
        <textarea
          id="ai-rules"
          className="textarea"
          style={{ minHeight: 340, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12.5 }}
          value={configText}
          onChange={(e) => { setConfigText(e.target.value); setJsonError(''); }}
          data-testid="ai-rules-config"
        />
        {jsonError ? <p className="error-text" role="alert">{jsonError}</p> : null}
        <div className="field" style={{ maxWidth: 280 }}>
          <label className="label" htmlFor="ai-rollback">Rollback to version (optional)</label>
          <input
            id="ai-rollback"
            className="input tabular"
            inputMode="numeric"
            value={rollback}
            onChange={(e) => setRollback(e.target.value.replace(/[^\d]/g, ''))}
          />
          <span className="hint">Copies the selected historical version as a new active version.</span>
        </div>
      </div>

      <ConfirmReasonModal
        open={open}
        title={t('console.aiRules')}
        description="Saving new recommendation weights affects AI ranking for employees. A new immutable version is created."
        busy={busy}
        onClose={() => setOpen(false)}
        onConfirm={(reason) => void save(reason)}
        confirmLabel={t('common.save')}
      />
    </div>
  );
}
