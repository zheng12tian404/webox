import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { t } from '../../i18n/en';
import { EP } from '../../api/endpoints';
import { api } from '../../api/client';
import { ApiError, errorMessage } from '../../api/errors';
import type { Address, CartItemPayload, CreatedOrder, MenuFilters, OrderPreview } from '../../api/types';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useIdempotencyKey } from '../../hooks/useIdempotencyKey';
import { useCartStore } from '../../store/cartStore';
import { ensurePrefs, usePrefsStore } from '../../store/prefsStore';
import { notify } from '../../store/uiStore';
import { formatMoney } from '../../utils/money';
import { formatTime } from '../../utils/datetime';
import { MAX_ADDRESS } from '../../utils/validation';
import { Spinner } from '../../components/ui/Feedback';

interface StockIssue {
  dishId: number;
  requested: number;
  available: number;
}

export function CheckoutPage() {
  const lines = useCartStore((s) => s.lines);
  const clearCart = useCartStore((s) => s.clear);
  const prefs = usePrefsStore((s) => s.prefs);
  const navigate = useNavigate();

  const filters = useApiQuery<MenuFilters>(EP.filters, []);
  const addressBook = useApiQuery<Address[]>(EP.addresses, []);

  const [date, setDate] = useState('');
  const [meal, setMeal] = useState<'Lunch' | 'Dinner'>('Lunch');
  const [address, setAddress] = useState('');
  const [selectedAddressId, setSelectedAddressId] = useState<number | null>(null);
  const [saveAddress, setSaveAddress] = useState(true);

  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitCode, setSubmitCode] = useState('');
  const [existingOrderId, setExistingOrderId] = useState<number | null>(null);
  const [stockIssues, setStockIssues] = useState<StockIssue[]>([]);
  const [rateLimited, setRateLimited] = useState(0);
  // Synchronous in-flight latch: React state updates are async, so two triggers
  // in the same tick would both pass a `submitting` check and send 2 POSTs.
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!prefs) void ensurePrefs();
  }, [prefs]);

  const items: CartItemPayload[] = useMemo(
    () => lines.map((l) => ({ dishId: l.dishId, qty: l.qty, optionIds: l.options.map((o) => o.optionId) })),
    [lines],
  );
  const itemsKey = useMemo(() => JSON.stringify(items), [items]);

  useEffect(() => {
    if (!date && filters.data?.dates?.length) {
      const published = filters.data.dates.find((d) => d.published) ?? filters.data.dates[0];
      if (published) setDate(published.date);
    }
  }, [filters.data, date]);

  useEffect(() => {
    if (addressBook.data?.length && !address && selectedAddressId === null) {
      setSelectedAddressId(addressBook.data[0]?.id ?? null);
      setAddress(addressBook.data[0]?.address ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressBook.data]);

  const cartTotal = lines.reduce((sum, l) => sum + l.unitPriceCents * l.qty, 0);

  useEffect(() => {
    if (!itemsKey || items.length === 0 || !date) return;
    const controller = new AbortController();
    setPreviewLoading(true);
    setPreviewError('');
    api
      .post<OrderPreview>(
        EP.preview,
        { items, deliveryDate: date, mealType: meal },
        { signal: controller.signal },
      )
      .then((env) => {
        setPreview(env.data);
        setExistingOrderId(env.data.existingOrderId ?? null);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setPreview(null);
        setPreviewError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPreviewLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, date, meal]);

  useEffect(() => {
    if (rateLimited <= 0) return;
    const timer = window.setInterval(() => setRateLimited((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [rateLimited]);

  const canonical = useMemo(
    () =>
      JSON.stringify({
        items: [...items].sort((a, b) => a.dishId - b.dishId),
        date,
        meal,
        address: address.trim(),
      }),
    [items, date, meal, address],
  );
  const { key: idempotencyKey, reset: resetIdempotency } = useIdempotencyKey(canonical);

  if (lines.length === 0 && !submitting) {
    return (
      <div className="card card-pad" data-testid="checkout-empty">
        <h1 style={{ fontSize: 22 }}>{t('checkout.title')}</h1>
        <p className="muted" style={{ margin: '10px 0 16px' }}>{t('checkout.empty')}</p>
        <Link to="/menu" className="btn btn-primary">{t('cart.browseMenu')}</Link>
      </div>
    );
  }

  const lookupActiveOrder = async (): Promise<number | null> => {
    const d = preview?.effectiveDate ?? date;
    const m = preview?.effectiveMeal ?? meal;
    if (!d || !m) return null;
    try {
      const env = await api.get<{ orderId: number } | null>(
        `${EP.activeOrder}?date=${encodeURIComponent(d)}&mealType=${encodeURIComponent(String(m))}`,
      );
      return env.data?.orderId ?? null;
    } catch {
      return null;
    }
  };

  const submit = async () => {
    if (inFlightRef.current || existingOrderId) return;
    inFlightRef.current = true;
    const addr = address.trim();
    if (addr.length < 1 || addr.length > MAX_ADDRESS) {
      inFlightRef.current = false;
      setSubmitError(t('checkout.addressRequired'));
      setSubmitCode('VALIDATION_ADDRESS_LENGTH');
      return;
    }
    if (!date) {
      inFlightRef.current = false;
      setSubmitError(t('checkout.dateUnavailable'));
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    setSubmitCode('');
    setStockIssues([]);
    try {
      if (saveAddress && selectedAddressId === null) {
        try {
          await api.post(EP.addresses, { address: addr });
        } catch {
          /* duplicate address is fine */
        }
      }
      const env = await api.post<CreatedOrder>(
        EP.orders,
        { items, deliveryDate: date, mealType: meal, address: addr, confirmAutoSwitch: true },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      );
      // Only a confirmed success clears the cart.
      clearCart();
      resetIdempotency();
      navigate(`/order-success/${env.data.orderId}`, { replace: true, state: { order: env.data } });
    } catch (e) {
      const err = e as ApiError;
      setSubmitCode(err.code ?? '');
      if (err instanceof ApiError) {
        const data = err.data as {
          existingOrderId?: number;
          details?: StockIssue[];
        } | null;
        const duplicate = err.code === 'ORDER_DUPLICATE' || err.code === 'IDEMPOTENCY_CONFLICT';
        const maybeCreated =
          duplicate ||
          err.code === 'INTERNAL' ||
          err.code === 'NETWORK' ||
          err.code === 'NETWORK_ERROR' ||
          err.status >= 500 ||
          err.code.startsWith('HTTP_5');
        if (maybeCreated) {
          // The order may already exist server-side: surface it instead of
          // inviting a retry that would only hit the idempotency conflict again.
          let existing = data?.existingOrderId ?? null;
          if (!existing) existing = await lookupActiveOrder();
          if (existing) {
            setExistingOrderId(existing);
            setSubmitError(t('checkout.duplicateRecovered'));
          } else if (duplicate) {
            setSubmitError(t('checkout.duplicateCheckOrders'));
          } else {
            setSubmitError(t('checkout.maybeCreated'));
          }
        }
        if (err.code === 'STOCK_INSUFFICIENT' && data?.details) {
          setStockIssues(data.details);
        }
        if (err.code === 'RATE_LIMITED') setRateLimited(30);
        if (err.code === 'ORDER_MEAL_UNAVAILABLE') setSubmitError(t('checkout.dateUnavailable'));
        else if (!maybeCreated) setSubmitError(errorMessage(err));
        if (!maybeCreated) notify.error(err);
      } else {
        setSubmitError(t('error.network'));
      }
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  const budgetMax = prefs?.budgetMaxCents ?? 0;
  const showBudget = preview?.budgetExceeded ?? (budgetMax > 0 && (preview?.totalCents ?? cartTotal) > budgetMax);
  const priceChanged = preview !== null && preview.totalCents !== cartTotal;
  const recoveryNeeded =
    !existingOrderId &&
    (submitCode === 'IDEMPOTENCY_CONFLICT' ||
      submitCode === 'ORDER_DUPLICATE' ||
      submitCode === 'INTERNAL' ||
      submitCode === 'NETWORK' ||
      submitCode === 'NETWORK_ERROR' ||
      submitCode.startsWith('HTTP_5'));

  return (
    <div data-testid="checkout-page">
      <div className="page-head">
        <div>
          <h1>{t('checkout.title')}</h1>
          <p className="page-sub">Prices and stock are confirmed by the server when you place the order.</p>
        </div>
      </div>

      <div className="cart-layout">
        <div className="stack">
          <section className="card card-pad">
            <h2 style={{ fontSize: 17, marginBottom: 8 }}>{t('checkout.items')}</h2>
            <div className="order-items">
              {(preview?.items ?? []).map((item, idx) => (
                <div className="order-item" key={`${item.dishName}-${idx}`}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{item.dishName} × {item.qty}</div>
                    {item.options.length > 0 ? (
                      <div className="small muted">
                        {item.options.map((o) => `${o.name}${o.priceDeltaCents ? ` (+${formatMoney(o.priceDeltaCents)})` : ''}`).join(' · ')}
                      </div>
                    ) : null}
                  </div>
                  <span className="tabular">{formatMoney(item.subtotalCents)}</span>
                </div>
              ))}
              {!preview ? (
                items.map((it, idx) => {
                  const line = lines[idx];
                  return line ? (
                    <div className="order-item" key={`${it.dishId}-${idx}`}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{line.name} × {line.qty}</div>
                        {line.options.length > 0 ? (
                          <div className="small muted">{line.options.map((o) => o.name).join(' · ')}</div>
                        ) : null}
                      </div>
                      <span className="tabular">{formatMoney(line.unitPriceCents * line.qty)}</span>
                    </div>
                  ) : null;
                })
              ) : null}
            </div>
          </section>

          <section className="card card-pad stack-sm">
            <h2 style={{ fontSize: 17 }}>Delivery</h2>
            <div className="form-grid">
              <div className="field">
                <label className="label" htmlFor="checkout-date">{t('checkout.deliveryDate')}</label>
                <select
                  id="checkout-date"
                  className="select"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  data-testid="checkout-date"
                >
                  {(filters.data?.dates ?? []).map((d) => (
                    <option key={d.date} value={d.date}>
                      {d.date}{d.published ? '' : ' (not published)'}
                    </option>
                  ))}
                  {!filters.data?.dates?.length ? <option value={date}>{date || '—'}</option> : null}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="checkout-meal">{t('checkout.mealType')}</label>
                <select
                  id="checkout-meal"
                  className="select"
                  value={meal}
                  onChange={(e) => setMeal(e.target.value === 'Dinner' ? 'Dinner' : 'Lunch')}
                  data-testid="checkout-meal"
                >
                  <option value="Lunch">{t('checkout.lunch')}</option>
                  <option value="Dinner">{t('checkout.dinner')}</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label className="label" htmlFor="checkout-address">{t('checkout.address')}</label>
              {addressBook.data && addressBook.data.length > 0 ? (
                <div className="address-list">
                  {addressBook.data.map((a) => (
                    <label key={a.id} className={`address-option${selectedAddressId === a.id ? ' on' : ''}`}>
                      <input
                        type="radio"
                        name="saved-address"
                        checked={selectedAddressId === a.id}
                        onChange={() => {
                          setSelectedAddressId(a.id);
                          setAddress(a.address);
                        }}
                      />
                      <span>{a.address}</span>
                    </label>
                  ))}
                  <label className={`address-option${selectedAddressId === null ? ' on' : ''}`}>
                    <input
                      type="radio"
                      name="saved-address"
                      checked={selectedAddressId === null}
                      onChange={() => {
                        setSelectedAddressId(null);
                        setAddress('');
                      }}
                    />
                    <span>{t('checkout.newAddress')}</span>
                  </label>
                </div>
              ) : null}
              <input
                id="checkout-address"
                className="input"
                maxLength={MAX_ADDRESS}
                value={address}
                placeholder="e.g. Building A, 12F"
                onChange={(e) => setAddress(e.target.value.slice(0, MAX_ADDRESS))}
                data-testid="checkout-address"
                aria-invalid={submitCode === 'VALIDATION_ADDRESS_LENGTH'}
              />
              <span className="hint">{address.length}/{MAX_ADDRESS}</span>
              {selectedAddressId === null ? (
                <label className="check-row">
                  <input type="checkbox" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} />
                  {t('checkout.saveAddress')}
                </label>
              ) : null}
            </div>
          </section>
        </div>

        <aside className="card card-pad summary">
          <h2 style={{ fontSize: 17, marginBottom: 10 }}>Summary</h2>

          {previewLoading ? <Spinner label={t('common.loading')} /> : null}
          {previewError ? <div className="banner banner-danger" role="alert">{previewError}</div> : null}

          {preview?.autoSwitched ? (
            <div className="banner banner-info" data-testid="auto-switch-banner" style={{ marginBottom: 10 }}>
              {t('checkout.autoSwitched', {
                meal: meal,
                effectiveMeal: preview.effectiveMeal,
                date: preview.effectiveDate,
                cutoff: formatTime(preview.cutoffAt),
              })}
            </div>
          ) : null}

          {priceChanged ? (
            <div className="banner banner-warn" style={{ marginBottom: 10 }} data-testid="price-changed">
              {t('cart.priceUpdated', { total: formatMoney(preview?.totalCents ?? cartTotal) })}
            </div>
          ) : null}

          {showBudget ? (
            <div className="banner banner-warn" data-testid="budget-warning" style={{ marginBottom: 10 }}>
              {t('checkout.budgetExceeded', {
                budget: budgetMax > 0 ? formatMoney(budgetMax) : 'your budget',
              })}
            </div>
          ) : null}

          {stockIssues.length > 0 ? (
            <div className="banner banner-danger" style={{ marginBottom: 10 }} data-testid="stock-issues">
              <div className="stack-sm">
                {stockIssues.map((s) => {
                  const line = lines.find((l) => l.dishId === s.dishId);
                  return (
                    <span key={s.dishId}>
                      {t('checkout.stockInsufficient', { available: s.available, dish: line?.name ?? `#${s.dishId}` })}
                    </span>
                  );
                })}
                <Link to="/cart" className="btn btn-outline btn-sm">{t('checkout.adjustCart')}</Link>
              </div>
            </div>
          ) : null}

          {existingOrderId ? (
            <div className="banner banner-info" style={{ marginBottom: 10 }}>
              An active order already exists for this meal.{' '}
              <Link to={`/orders/${existingOrderId}`} className="btn btn-outline btn-sm" data-testid="checkout-existing-order">
                {t('checkout.viewExistingOrder')}
              </Link>
            </div>
          ) : null}

          <div className="summary-row"><span className="muted">Items</span><span className="tabular">{preview?.itemCount ?? lines.reduce((n, l) => n + l.qty, 0)}</span></div>
          <div className="summary-row"><span className="muted">{t('cart.subtotal')}</span><span className="tabular">{formatMoney(preview?.totalCents ?? cartTotal)}</span></div>
          {preview ? (
            <div className="summary-row"><span className="muted">{t('checkout.cutoffLabel')}</span><span className="tabular">{formatTime(preview.cutoffAt)}</span></div>
          ) : null}
          <div className="summary-row summary-total">
            <span>{t('cart.total')}</span>
            <span className="tabular" data-testid="checkout-total">{formatMoney(preview?.totalCents ?? cartTotal)}</span>
          </div>

          {submitError ? (
            <div className="banner banner-danger" role="alert" data-testid="checkout-error" data-error-code={submitCode} style={{ marginTop: 10 }}>
              {submitError}
            </div>
          ) : null}

          {recoveryNeeded ? (
            <Link
              to="/orders"
              className="btn btn-outline btn-sm"
              style={{ marginTop: 10 }}
              data-testid="checkout-view-orders"
            >
              {t('checkout.viewOrders')}
            </Link>
          ) : null}

          {existingOrderId ? (
            <Link to={`/orders/${existingOrderId}`} className="btn btn-primary btn-block" style={{ marginTop: 12 }}>
              {t('checkout.viewExistingOrder')}
            </Link>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-block"
              style={{ marginTop: 12 }}
              onClick={() => void submit()}
              disabled={submitting || previewLoading || Boolean(previewError) || rateLimited > 0}
              data-testid="checkout-submit"
            >
              {submitting ? t('checkout.placing') : rateLimited > 0 ? `${t('error.rateLimited')} (${rateLimited}s)` : t('checkout.placeOrder')}
            </button>
          )}
          <p className="hint" style={{ marginTop: 10 }}>
            {preview?.effectiveDate ? `${preview.effectiveMeal} · ${preview.effectiveDate}` : 'Stock is reserved only when the order is placed.'}
          </p>
        </aside>
      </div>
    </div>
  );
}
