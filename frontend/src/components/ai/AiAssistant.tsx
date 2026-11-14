import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t } from '../../i18n/en';
import { EP } from '../../api/endpoints';
import { api } from '../../api/client';
import { openSse, parseEventJson } from '../../api/sse';
import type { DishDetail } from '../../api/types';
import { useAddToCart } from '../../hooks/useAddToCart';
import { Modal } from '../ui/Modal';
import { formatMoney } from '../../utils/money';
import { resolveImage } from '../../utils/image';
import { ImageWithFallback } from '../ui/ImageWithFallback';
import { MAX_PROMPT } from '../../utils/validation';

interface AiDish {
  dishId: number;
  name: string;
  priceCents: number;
  priceDisplay?: string;
  category: string;
  available: boolean | number;
  imageUrl?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const QUICK = [
  { key: 'ai.quick.light', text: 'Something light' },
  { key: 'ai.quick.protein', text: 'High protein' },
  { key: 'ai.quick.notYesterday', text: 'Not what I had yesterday' },
  { key: 'ai.quick.spicy', text: 'Something spicy' },
];

const SESSION_KEY = 'webox.ai.session';

function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random())).slice(0, 36);
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return '';
  }
}

export function AiAssistant({ open, onClose }: Props) {
  const navigate = useNavigate();
  const { requestAdd, modal: allergenModal } = useAddToCart();
  const [prompt, setPrompt] = useState('');
  const [dishes, setDishes] = useState<AiDish[]>([]);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [fallback, setFallback] = useState(false);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      controllerRef.current?.abort();
      controllerRef.current = null;
      setLoading(false);
    }
  }, [open]);

  const run = async (text: string) => {
    if (loading) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_PROMPT) {
      setError(t('ai.promptTooLong'));
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError('');
    setDishes([]);
    setReasons({});
    setFallback(false);
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Number(import.meta.env.VITE_AI_TIMEOUT_MS ?? 25000));

    try {
      await openSse(EP.aiRecommend, {
        method: 'POST',
        body: { prompt: trimmed, sessionId: getSessionId() },
        signal: controller.signal,
        onEvent: (event, data) => {
          if (event === 'meta') {
            const meta = parseEventJson<{ fallback?: boolean; sessionId?: string; model?: string }>(data);
            if (meta?.fallback) setFallback(true);
            if (meta?.sessionId) {
              try {
                sessionStorage.setItem(SESSION_KEY, meta.sessionId);
              } catch {
                /* ignore */
              }
            }
          } else if (event === 'dish') {
            const dish = parseEventJson<AiDish>(data);
            if (dish && typeof dish.dishId === 'number') {
              setDishes((prev) => (prev.some((d) => d.dishId === dish.dishId) ? prev : [...prev, dish]));
            }
          } else if (event === 'reason') {
            const payload = parseEventJson<{ dishId: number; text: string }>(data);
            if (payload) setReasons((prev) => ({ ...prev, [payload.dishId]: payload.text }));
          } else if (event === 'done') {
            setLoading(false);
          }
        },
      });
      setLoading(false);
    } catch (e) {
      if (timedOut) setError(t('ai.timeout'));
      else if (controller.signal.aborted) return;
      else {
        const err = e as { status?: number };
        setError(err.status === 429 ? t('ai.rateLimited') : t('ai.offline'));
      }
      setLoading(false);
    } finally {
      window.clearTimeout(timer);
    }
  };

  const handleAdd = async (dish: AiDish) => {
    if (addingId !== null) return;
    setAddingId(dish.dishId);
    try {
      // The AI payload has no allergens: fetch the snapshot and run the same
      // guard as the menu card and detail page (three entries, one rule).
      const env = await api.get<DishDetail>(EP.dish(dish.dishId));
      if (env.data.optionGroups.some((g) => g.required)) {
        onClose();
        navigate(`/dishes/${dish.dishId}`);
        return;
      }
      await requestAdd({
        dishId: env.data.dishId,
        name: env.data.name,
        imageUrl: env.data.imageUrl,
        basePriceCents: env.data.priceCents,
        options: [],
        allergens: env.data.allergens,
      });
    } catch {
      setError(t('error.network'));
    } finally {
      setAddingId(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('ai.title')} drawer>
      {allergenModal}
      <div className="stack-sm">
        <p className="muted small">Describe what you feel like eating. Recommendations respect your allergies and stock.</p>
        <div className="field">
          <label className="label" htmlFor="ai-input">{t('ai.placeholder')}</label>
          <textarea
            id="ai-input"
            className="textarea"
            maxLength={MAX_PROMPT}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('ai.placeholder')}
            data-testid="ai-input"
          />
          <span className="hint">{prompt.length} / {MAX_PROMPT}</span>
        </div>
        <div className="ai-quick">
          {QUICK.map((q) => (
            <button key={q.key} type="button" onClick={() => { setPrompt(q.text); void run(q.text); }}>
              {t(q.key)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={loading || !prompt.trim()}
          onClick={() => void run(prompt)}
          data-testid="ai-send"
        >
          {loading ? t('ai.thinking') : t('ai.send')}
        </button>
        {fallback ? (
          <span className="badge badge-orange" data-testid="ai-fallback-badge">{t('ai.fallback')}</span>
        ) : null}
        {error ? (
          <div className="banner banner-danger" role="alert" data-testid="ai-error">{error}</div>
        ) : null}
        {loading ? (
          <div className="ai-thinking">
            <span className="spinner" aria-hidden="true" />
            {t('ai.thinking')}
          </div>
        ) : null}
        <div className="stack-sm" aria-live="polite">
          {dishes.map((dish) => (
            <div key={dish.dishId} className="ai-card" data-testid={`ai-card-${dish.dishId}`}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <ImageWithFallback
                  src={resolveImage(dish.imageUrl ?? null)}
                  alt={dish.name}
                  className="cart-thumb"
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 650 }}>{dish.name}</div>
                  <div className="row small" style={{ gap: 8, marginTop: 4 }}>
                    <span className="badge">{dish.category}</span>
                    <span className="price" style={{ fontSize: 15 }}>{formatMoney(dish.priceCents)}</span>
                  </div>
                </div>
              </div>
              {reasons[dish.dishId] ? (
                <div className="ai-reason" data-testid={`ai-reason-${dish.dishId}`}>{reasons[dish.dishId]}</div>
              ) : null}
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => void handleAdd(dish)}
                disabled={addingId !== null || !dish.available}
                data-testid={`ai-add-${dish.dishId}`}
              >
                {addingId === dish.dishId ? t('common.loading') : t('ai.addToCart')}
              </button>
            </div>
          ))}
          {!loading && !error && dishes.length === 0 && prompt ? (
            <div className="empty-state" style={{ padding: '24px 10px' }}>
              <p className="muted small">{t('ai.empty')}</p>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
