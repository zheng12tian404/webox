import { useState, type ReactNode } from 'react';
import { t } from '../i18n/en';
import { useCartStore, type CartOption } from '../store/cartStore';
import { ensurePrefs } from '../store/prefsStore';
import { notify } from '../store/uiStore';
import { Modal } from '../components/ui/Modal';

export type AddOutcome = 'added' | 'limit' | 'allergen';

export interface AddToCartInput {
  dishId: number;
  name: string;
  imageUrl?: string | null;
  basePriceCents: number;
  options: CartOption[];
  /** Dish allergens; when omitted the guard cannot judge and lets the add through. */
  allergens?: string[];
}

interface PendingAdd {
  input: AddToCartInput;
  flagged: string[];
}

/**
 * The single add-to-cart entry point. Allergen judgement + confirmation modal
 * live here so the menu card, dish detail and AI recommendation entries cannot
 * bypass the warning (D11 / AC-021).
 */
export function useAddToCart() {
  const add = useCartStore((s) => s.add);
  const [pending, setPending] = useState<PendingAdd | null>(null);

  const commit = (input: AddToCartInput): AddOutcome => {
    const result = add({
      dishId: input.dishId,
      name: input.name,
      imageUrl: input.imageUrl,
      basePriceCents: input.basePriceCents,
      options: input.options,
    });
    if (result === 'limit') {
      notify.raw(t('menu.orderLimit'), 'ORDER_LIMIT_EXCEEDED');
      return 'limit';
    }
    notify.success(t('menu.added'));
    return 'added';
  };

  const requestAdd = async (input: AddToCartInput): Promise<AddOutcome> => {
    const prefs = await ensurePrefs();
    const flagged = (prefs?.allergens ?? []).filter((a) => (input.allergens ?? []).includes(a));
    if (flagged.length > 0) {
      setPending({ input, flagged });
      return 'allergen';
    }
    return commit(input);
  };

  const confirm = () => {
    if (pending) commit(pending.input);
    setPending(null);
  };

  const cancel = () => setPending(null);

  const modal: ReactNode = (
    <Modal open={pending !== null} onClose={cancel} title={t('allergen.title')}>
      <div data-testid="allergen-modal" className="stack-sm">
        <p>{t('allergen.message', { allergens: (pending?.flagged ?? []).join(', ') })}</p>
      </div>
      <div className="modal-foot">
        <button type="button" className="btn btn-outline" onClick={cancel} data-testid="allergen-cancel">
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn-primary" onClick={confirm} data-testid="allergen-add-anyway">
          {t('allergen.addAnyway')}
        </button>
      </div>
    </Modal>
  );

  return { requestAdd, confirm, cancel, modal, pending };
}