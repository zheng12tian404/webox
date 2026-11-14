import { memo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { t } from '../../i18n/en';
import { api } from '../../api/client';
import { EP } from '../../api/endpoints';
import { ApiError } from '../../api/errors';
import type { DishDetail, MenuItem } from '../../api/types';
import { useCartStore, MAX_TOTAL_QTY } from '../../store/cartStore';
import { useStockStore } from '../../store/stockStore';
import { notify } from '../../store/uiStore';
import { formatMoney } from '../../utils/money';
import { resolveImage } from '../../utils/image';
import { ImageWithFallback } from '../ui/ImageWithFallback';
import { useAddToCart } from '../../hooks/useAddToCart';

export const DishCard = memo(function DishCard({ item }: { item: MenuItem }) {
  const navigate = useNavigate();
  const stockOverride = useStockStore((s) => s.available[item.dishId]);
  const totalQty = useCartStore((s) => s.lines.reduce((sum, l) => sum + l.qty, 0));
  const { requestAdd, modal: allergenModal } = useAddToCart();
  const addLock = useRef(false);
  const [busy, setBusy] = useState(false);

  const qty = typeof stockOverride === 'number' ? stockOverride : item.availableQty;
  const soldOut = typeof stockOverride === 'number' ? qty <= 0 : item.soldOut;
  const low = qty > 0 && qty <= 3;
  const limitReached = totalQty >= MAX_TOTAL_QTY;

  const handleAdd = async () => {
    if (busy || soldOut || addLock.current) return;
    if (item.hasRequiredOptions || (item.hasOptions && item.hasRequiredOptions !== false)) {
      navigate(`/dishes/${item.dishId}`);
      return;
    }
    if (limitReached) {
      notify.raw(t('menu.orderLimit'), 'ORDER_LIMIT_EXCEEDED');
      return;
    }
    addLock.current = true;
    setBusy(true);
    try {
      // The menu list does not carry allergens: fetch the dish snapshot so the
      // shared allergen guard can judge this shortcut add (D11/AC-021).
      const env = await api.get<DishDetail>(EP.dish(item.dishId));
      await requestAdd({
        dishId: env.data.dishId,
        name: env.data.name,
        imageUrl: env.data.imageUrl,
        basePriceCents: env.data.priceCents,
        options: [],
        allergens: env.data.allergens,
      });
    } catch (e) {
      if (e instanceof ApiError) notify.error(e);
      else notify.raw(t('error.network'), 'NETWORK_ERROR');
    } finally {
      addLock.current = false;
      window.setTimeout(() => setBusy(false), 350);
    }
  };

  const stockLabel = soldOut
    ? t('menu.soldOut')
    : typeof stockOverride === 'number'
      ? low
        ? t('menu.onlyLeft', { count: qty })
        : t('menu.available', { count: qty })
      : item.lowStock
        ? t('menu.lowStock')
        : t('menu.available', { count: item.availableQty });

  return (
    <article className={`card dish-card${item.forYou ? ' for-you' : ''}`} data-testid={`menu-card-${item.dishId}`}>
      <div className="dish-media">
        <Link to={`/dishes/${item.dishId}`} aria-label={item.name}>
          <ImageWithFallback src={resolveImage(item.imageUrl)} alt={item.name} />
        </Link>
        <div className="media-badges">
          {item.forYou ? <span className="badge badge-teal" data-testid={`for-you-${item.dishId}`}>{t('menu.forYouBadge')}</span> : null}
          {item.spiceLevel && item.spiceLevel !== 'None' ? <span className="badge badge-orange">{item.spiceLevel}</span> : null}
        </div>
        {soldOut ? <div className="sold-out-overlay">{t('menu.soldOut')}</div> : null}
      </div>
      <div className="dish-body">
        <h3 className="dish-name">
          <Link to={`/dishes/${item.dishId}`} data-testid={`dish-name-${item.dishId}`}>{item.name}</Link>
        </h3>
        <p className="dish-desc">{item.description}</p>
        <div className="dish-meta">
          <span className="badge">{item.category}</span>
          <span
            className={`badge ${soldOut ? 'badge-red' : low ? 'badge-orange' : 'badge-green'}`}
            data-testid={`stock-badge-${item.dishId}`}
          >
            {stockLabel}
          </span>
        </div>
        <div className="dish-foot">
          <span className="price tabular" data-testid={`dish-price-${item.dishId}`}>{formatMoney(item.priceCents)}</span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleAdd}
            disabled={soldOut || busy || limitReached}
            title={limitReached ? t('menu.orderLimit') : soldOut ? t('menu.soldOut') : t('menu.addToCart')}
            data-testid={`add-to-cart-${item.dishId}`}
          >
            {soldOut ? t('menu.soldOut') : limitReached ? t('menu.orderLimit') : busy ? t('common.loading') : t('menu.addToCart')}
          </button>
        </div>
      </div>
      {allergenModal}
    </article>
  );
});
