import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { t } from '../../i18n/en';
import { EP } from '../../api/endpoints';
import type { DishDetail, OptionGroup } from '../../api/types';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useCartStore } from '../../store/cartStore';
import { useStockStore } from '../../store/stockStore';
import { notify } from '../../store/uiStore';
import { formatMoney } from '../../utils/money';
import { resolveImage } from '../../utils/image';
import { ImageWithFallback } from '../../components/ui/ImageWithFallback';
import { ErrorState } from '../../components/ui/Feedback';
import { useAddToCart } from '../../hooks/useAddToCart';

export function DishDetailPage() {
  const { dishId } = useParams();
  const id = Number(dishId);
  const navigate = useNavigate();
  const dish = useApiQuery<DishDetail>(Number.isFinite(id) ? EP.dish(id) : null, [id]);
  const totalQty = useCartStore((s) => s.lines.reduce((sum, l) => sum + l.qty, 0));
  const stockOverride = useStockStore((s) => (Number.isFinite(id) ? s.available[id] : undefined));
  const { requestAdd, modal: allergenModal } = useAddToCart();

  const [selected, setSelected] = useState<Record<number, number[]>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const groups = dish.data?.optionGroups ?? [];
  const chosenOptions = useMemo(() => {
    if (!dish.data) return [];
    const out: { optionId: number; name: string; priceDeltaCents: number }[] = [];
    for (const group of dish.data.optionGroups) {
      for (const optId of selected[group.groupId] ?? []) {
        const opt = group.options.find((o) => o.optionId === optId);
        if (opt) out.push({ optionId: opt.optionId, name: opt.name, priceDeltaCents: opt.priceDeltaCents });
      }
    }
    return out;
  }, [dish.data, selected]);

  const missingGroups = useMemo(
    () =>
      groups
        .filter((g) => g.required && (selected[g.groupId]?.length ?? 0) < Math.max(1, g.minSelect))
        .map((g) => g.name),
    [groups, selected],
  );

  const soldOut = dish.data
    ? typeof stockOverride === 'number'
      ? stockOverride <= 0
      : !dish.data.available
    : false;
  const availableQty = typeof stockOverride === 'number' ? stockOverride : dish.data?.availableQty ?? 0;
  const unitPriceCents = (dish.data?.priceCents ?? 0) + chosenOptions.reduce((sum, o) => sum + o.priceDeltaCents, 0);

  const toggleOption = (group: OptionGroup, optionId: number) => {
    setSelected((prev) => {
      const current = prev[group.groupId] ?? [];
      if (group.maxSelect === 1) return { ...prev, [group.groupId]: [optionId] };
      if (current.includes(optionId)) return { ...prev, [group.groupId]: current.filter((x) => x !== optionId) };
      if (current.length >= group.maxSelect) return prev;
      return { ...prev, [group.groupId]: [...current, optionId] };
    });
  };

  const handleAdd = async () => {
    if (!dish.data || busyRef.current || soldOut) return;
    if (totalQty >= 5) {
      notify.raw(t('menu.orderLimit'), 'ORDER_LIMIT_EXCEEDED');
      return;
    }
    if (missingGroups.length > 0) {
      notify.raw(t('detail.pleaseSelect', { groups: missingGroups.join(', ') }), 'VALIDATION_OPTION_REQUIRED');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    const outcome = await requestAdd({
      dishId: dish.data.dishId,
      name: dish.data.name,
      imageUrl: dish.data.imageUrl,
      basePriceCents: dish.data.priceCents,
      options: chosenOptions,
      allergens: dish.data.allergens,
    });
    busyRef.current = false;
    // When the allergen modal opens the user has not confirmed yet: restore the
    // normal button label instead of showing a loading state (FR-m2).
    if (outcome === 'allergen') setBusy(false);
    else window.setTimeout(() => setBusy(false), 300);
  };

  if (dish.loading) {
    return (
      <div className="stack">
        <div className="skeleton" style={{ height: 28, width: 180 }} />
        <div className="detail-grid">
          <div className="skeleton" style={{ aspectRatio: '4 / 3', borderRadius: 14 }} />
          <div className="stack-sm">
            <div className="skeleton" style={{ height: 60 }} />
            <div className="skeleton" style={{ height: 120 }} />
          </div>
        </div>
      </div>
    );
  }
  if (dish.error || !dish.data) return <ErrorState error={dish.error} onRetry={dish.reload} />;

  const d = dish.data;
  return (
    <div data-testid="dish-detail">
      <div className="row small" style={{ marginBottom: 14 }}>
        <Link to="/menu">← {t('nav.menu')}</Link>
      </div>
      <div className="detail-grid">
        <div className="detail-media">
          <ImageWithFallback src={resolveImage(d.imageUrl)} alt={d.name} eager />
        </div>
        <div className="stack">
          <div>
            <div className="row-wrap" style={{ marginBottom: 8 }}>
              <span className="badge">{d.category}</span>
              <span className="badge badge-orange">{d.spiceLevel}</span>
              {soldOut ? <span className="badge badge-red">{t('menu.soldOut')}</span> : availableQty <= 3 ? <span className="badge badge-orange">{t('menu.onlyLeft', { count: availableQty })}</span> : null}
            </div>
            <h1 style={{ fontSize: 28 }}>{d.name}</h1>
            <p className="muted" style={{ marginTop: 8 }}>{d.description}</p>
            <div className="price price-lg tabular" style={{ marginTop: 12 }} data-testid="dish-price">
              {formatMoney(unitPriceCents)}
            </div>
          </div>

          {d.optionGroups.map((group) => {
            const chosen = selected[group.groupId] ?? [];
            return (
              <fieldset key={group.groupId} className="option-group" style={{ border: 0, padding: 0, margin: 0 }} data-testid={`option-group-${group.groupId}`}>
                <div className="option-group-head">
                  <div>
                    <span style={{ fontWeight: 700 }}>{group.name}</span>{' '}
                    <span className={`badge ${group.required ? 'badge-orange' : ''}`}>
                      {group.required ? t('detail.required') : t('detail.optional')}
                    </span>
                  </div>
                  {group.maxSelect > 1 ? <span className="hint">{t('detail.selectUpTo', { count: group.maxSelect })}</span> : null}
                </div>
                <div className="stack-sm">
                  {group.options.map((opt) => {
                    const on = chosen.includes(opt.optionId);
                    return (
                      <label key={opt.optionId} className={`option-row${on ? ' on' : ''}`}>
                        <input
                          type={group.maxSelect === 1 ? 'radio' : 'checkbox'}
                          name={`group-${group.groupId}`}
                          checked={on}
                          disabled={!on && group.maxSelect > 1 && chosen.length >= group.maxSelect}
                          onChange={() => toggleOption(group, opt.optionId)}
                          data-testid={`option-${opt.optionId}`}
                        />
                        <span>{opt.name}</span>
                        {opt.priceDeltaCents !== 0 ? (
                          <span className="option-delta">+{formatMoney(opt.priceDeltaCents)}</span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}

          <div className="row-wrap small muted">
            {d.protein ? <span><strong>{t('detail.protein')}:</strong> {d.protein}</span> : null}
            {d.allergens.length > 0 ? (
              <span><strong>{t('detail.allergens')}:</strong> {d.allergens.join(', ')}</span>
            ) : null}
          </div>

          {missingGroups.length > 0 ? (
            <p className="hint">{t('detail.pleaseSelect', { groups: missingGroups.join(', ') })}</p>
          ) : null}

          <div className="detail-footer">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="small muted">{t('cart.total')}</div>
                <div className="price tabular">{formatMoney(unitPriceCents)}</div>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleAdd}
                disabled={soldOut || busy || missingGroups.length > 0}
                data-testid="detail-add-to-cart"
              >
                {soldOut ? t('menu.soldOut') : busy ? t('common.loading') : t('detail.addToCart')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {allergenModal}
    </div>
  );
}
