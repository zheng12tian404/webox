import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { t } from '../../i18n/en';
import { useCartStore, MAX_TOTAL_QTY } from '../../store/cartStore';
import { notify } from '../../store/uiStore';
import { formatMoney } from '../../utils/money';
import { resolveImage } from '../../utils/image';
import { ImageWithFallback } from '../../components/ui/ImageWithFallback';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/Feedback';

export function CartPage() {
  const lines = useCartStore((s) => s.lines);
  const inc = useCartStore((s) => s.inc);
  const dec = useCartStore((s) => s.dec);
  const remove = useCartStore((s) => s.remove);
  const clear = useCartStore((s) => s.clear);
  const totalQty = lines.reduce((sum, l) => sum + l.qty, 0);
  const totalCents = lines.reduce((sum, l) => sum + l.unitPriceCents * l.qty, 0);
  const [confirmClear, setConfirmClear] = useState(false);
  const navigate = useNavigate();

  return (
    <div data-testid="cart-page">
      <div className="page-head">
        <div>
          <h1>{t('cart.title')}</h1>
          <p className="page-sub">Max 5 items per order · stock is reserved when you place the order.</p>
        </div>
        {lines.length > 0 ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(true)}>
            {t('cart.clear')}
          </button>
        ) : null}
      </div>

      {lines.length === 0 ? (
        <div className="card" data-testid="cart-empty">
          <EmptyState
            title={t('cart.empty')}
            action={<Link to="/menu" className="btn btn-primary btn-sm">{t('cart.browseMenu')}</Link>}
          />
        </div>
      ) : (
        <div className="cart-layout">
          <div className="card card-pad">
            <div className="cart-lines">
              {lines.map((line) => (
                <div className="cart-line" key={line.lineId} data-testid={`cart-line-${line.lineId}`}>
                  <ImageWithFallback src={resolveImage(line.imageUrl)} alt={line.name} className="cart-thumb" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                      <strong>{line.name}</strong>
                      <span className="price tabular" style={{ fontSize: 16 }}>{formatMoney(line.unitPriceCents * line.qty)}</span>
                    </div>
                    {line.options.length > 0 ? (
                      <div className="small muted" style={{ marginTop: 4 }}>
                        {line.options
                          .map((o) => `${o.name}${o.priceDeltaCents ? ` (+${formatMoney(o.priceDeltaCents)})` : ''}`)
                          .join(' · ')}
                      </div>
                    ) : (
                      <div className="small muted" style={{ marginTop: 4 }}>Standard</div>
                    )}
                    <div className="row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
                      <div className="qty-control">
                        <button
                          type="button"
                          onClick={() => dec(line.lineId)}
                          aria-label={`Decrease ${line.name}`}
                          data-testid="cart-qty-minus"
                        >
                          −
                        </button>
                        <span className="qty-value" data-testid="cart-qty">{line.qty}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const res = inc(line.lineId);
                            if (res === 'limit') notify.raw(t('menu.orderLimit'), 'ORDER_LIMIT_EXCEEDED');
                          }}
                          disabled={totalQty >= MAX_TOTAL_QTY}
                          aria-label={`Increase ${line.name}`}
                          data-testid="cart-qty-plus"
                        >
                          +
                        </button>
                      </div>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(line.lineId)} data-testid="cart-remove">
                        {t('cart.remove')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <aside className="card card-pad summary">
            <h2 style={{ fontSize: 17, marginBottom: 10 }}>{t('cart.subtotal')}</h2>
            <div className="summary-row"><span className="muted">Items</span><span className="tabular">{totalQty}</span></div>
            <div className="summary-row"><span className="muted">{t('cart.subtotal')}</span><span className="tabular">{formatMoney(totalCents)}</span></div>
            <div className="summary-row summary-total"><span>{t('cart.total')}</span><span className="tabular" data-testid="cart-total">{formatMoney(totalCents)}</span></div>
            <button
              type="button"
              className="btn btn-primary btn-block"
              style={{ marginTop: 14 }}
              onClick={() => navigate('/checkout')}
              data-testid="cart-checkout"
            >
              {t('cart.checkout')}
            </button>
            <p className="hint" style={{ marginTop: 10 }}>
              {totalQty >= MAX_TOTAL_QTY ? t('menu.orderLimit') : 'Prices and stock are confirmed on the checkout page.'}
            </p>
          </aside>
        </div>
      )}

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={t('cart.clear')}
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setConfirmClear(false)}>{t('common.cancel')}</button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                clear();
                setConfirmClear(false);
                notify.info(t('cart.empty'));
              }}
            >
              {t('cart.clear')}
            </button>
          </>
        }
      >
        <p>Remove all items from your cart?</p>
      </Modal>
    </div>
  );
}
