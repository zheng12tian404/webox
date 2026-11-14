import { useEffect, useState } from 'react';
import { t } from '../../i18n/en';
import { EP } from '../../api/endpoints';
import { api } from '../../api/client';
import type { MenuFilters, Preferences } from '../../api/types';
import { useApiQuery } from '../../hooks/useApiQuery';
import { usePrefsStore } from '../../store/prefsStore';
import { notify } from '../../store/uiStore';
import { centsToYuanInput, parseYuanToCents } from '../../utils/money';
import { normalizePreferences, SPICE_OPTIONS, TASTE_OPTIONS } from '../../utils/preferences';

const ALLERGENS = ['Peanuts', 'Dairy', 'Egg', 'Gluten', 'Soy', 'Fish', 'Shellfish'];
const CATEGORIES = ['Chinese', 'Western', 'Japanese', 'Light Meal', 'Korean', 'Southeast Asian'];

const EMPTY: Preferences = {
  allergens: [],
  preferredCategories: [],
  spicePreference: 'None',
  tastePreference: 'Medium',
  budgetMinCents: null,
  budgetMaxCents: null,
  recommendEnabled: false,
};

export function PreferencesPage() {
  const stored = usePrefsStore((s) => s.prefs);
  const setStored = usePrefsStore((s) => s.setPrefs);
  const prefsQuery = useApiQuery<Preferences>(EP.prefs, []);
  const filters = useApiQuery<MenuFilters>(EP.filters, []);
  const initial = normalizePreferences(stored ?? EMPTY);
  const [form, setForm] = useState<Preferences>(initial);
  const [minYuan, setMinYuan] = useState(centsToYuanInput(initial.budgetMinCents));
  const [maxYuan, setMaxYuan] = useState(centsToYuanInput(initial.budgetMaxCents));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (prefsQuery.data) {
      const p = normalizePreferences(prefsQuery.data);
      setForm(p);
      setMinYuan(centsToYuanInput(p.budgetMinCents));
      setMaxYuan(centsToYuanInput(p.budgetMaxCents));
      setStored(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsQuery.data]);

  const toggle = (key: 'allergens' | 'preferredCategories', value: string) => {
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(value) ? f[key].filter((x) => x !== value) : [...f[key], value],
    }));
  };

  const save = async () => {
    setError('');
    const minRaw = minYuan.trim();
    const maxRaw = maxYuan.trim();
    let min: number | null = null;
    let max: number | null = null;
    if (minRaw === '' && maxRaw === '') {
      // No budget configured: the contract expects null/null, not 0/0.
      min = null;
      max = null;
    } else if (minRaw === '' || maxRaw === '') {
      setError(t('prefs.budgetRequiredBoth'));
      return;
    } else {
      min = parseYuanToCents(minRaw);
      max = parseYuanToCents(maxRaw);
      if (min === null || max === null) {
        setError(t('prefs.budgetFormat'));
        return;
      }
      if (min <= 0 || min > max) {
        setError(t('prefs.budgetInvalid'));
        return;
      }
    }
    setBusy(true);
    try {
      const payload: Preferences = {
        ...form,
        allergens: form.allergens,
        preferredCategories: form.preferredCategories,
        spicePreference: form.spicePreference || 'None',
        tastePreference: form.tastePreference || 'Medium',
        budgetMinCents: min,
        budgetMaxCents: max,
      };
      const env = await api.put<Preferences>(EP.prefs, payload);
      const p = normalizePreferences(env.data);
      setForm(p);
      setMinYuan(centsToYuanInput(p.budgetMinCents));
      setMaxYuan(centsToYuanInput(p.budgetMaxCents));
      setStored(p);
      setSaved(true);
      notify.success(t('prefs.saved'));
      window.setTimeout(() => setSaved(false), 4000);
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };

  const categories = filters.data?.categories?.length ? filters.data.categories : CATEGORIES;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t('prefs.title')}</h1>
          <p className="page-sub">Allergies are always filtered in AI recommendations; the menu shows a warning.</p>
        </div>
      </div>

      {saved ? (
        <div className="banner banner-success" style={{ marginBottom: 14 }} data-testid="pref-saved-toast">
          {t('prefs.saved')}
        </div>
      ) : null}

      <div className="stack">
        <section className="card card-pad">
          <h2 style={{ fontSize: 17, marginBottom: 12 }}>{t('prefs.allergens')}</h2>
          <div className="chips">
            {ALLERGENS.map((a) => (
              <button
                key={a}
                type="button"
                className="chip"
                aria-pressed={form.allergens.includes(a)}
                onClick={() => toggle('allergens', a)}
                data-testid={`pref-allergen-${a}`}
              >
                {a}
              </button>
            ))}
          </div>
        </section>

        <section className="card card-pad">
          <h2 style={{ fontSize: 17, marginBottom: 12 }}>{t('prefs.categories')}</h2>
          <div className="chips">
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                className="chip"
                aria-pressed={form.preferredCategories.includes(c)}
                onClick={() => toggle('preferredCategories', c)}
                data-testid={`pref-category-${c.replace(/\s+/g, '-')}`}
              >
                {c}
              </button>
            ))}
          </div>
        </section>

        <section className="card card-pad">
          <div className="form-grid">
            <div className="field">
              <label className="label" htmlFor="pref-spice">{t('prefs.spice')}</label>
              <select
                id="pref-spice"
                className="select"
                value={form.spicePreference ?? 'None'}
                onChange={(e) => setForm({ ...form, spicePreference: e.target.value })}
              >
                {SPICE_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="pref-taste">{t('prefs.taste')}</label>
              <select
                id="pref-taste"
                className="select"
                value={form.tastePreference ?? 'Medium'}
                onChange={(e) => setForm({ ...form, tastePreference: e.target.value })}
                data-testid="pref-taste"
              >
                {TASTE_OPTIONS.map((s) => (
                  <option key={s} value={s}>{t(`prefs.taste.${s}`)}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="label" htmlFor="pref-budget-min">{t('prefs.budgetMin')} (¥)</label>
              <input
                id="pref-budget-min"
                className="input tabular"
                inputMode="decimal"
                placeholder={t('prefs.budgetUnset')}
                value={minYuan}
                onChange={(e) => setMinYuan(e.target.value)}
                aria-invalid={Boolean(error)}
                data-testid="pref-budget-min"
              />
            </div>
            <div className="field">
              <label className="label" htmlFor="pref-budget-max">{t('prefs.budgetMax')} (¥)</label>
              <input
                id="pref-budget-max"
                className="input tabular"
                inputMode="decimal"
                placeholder={t('prefs.budgetUnset')}
                value={maxYuan}
                onChange={(e) => setMaxYuan(e.target.value)}
                aria-invalid={Boolean(error)}
                data-testid="pref-budget-max"
              />
            </div>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>{t('prefs.budgetHint')}</p>
          <label className="check-row" style={{ marginTop: 16 }}>
            <input
              type="checkbox"
              checked={form.recommendEnabled}
              onChange={(e) => setForm({ ...form, recommendEnabled: e.target.checked })}
              data-testid="pref-recommend-toggle"
            />
            {t('prefs.recommendEnabled')}
          </label>
          {error ? (
            <p className="error-text" role="alert" style={{ marginTop: 10 }} data-testid="pref-error">{error}</p>
          ) : null}
        </section>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy} data-testid="pref-save">
            {busy ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}