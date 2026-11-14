import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CartOption {
  optionId: number;
  name: string;
  priceDeltaCents: number;
}

export interface CartLine {
  lineId: string;
  dishId: number;
  name: string;
  imageUrl?: string | null;
  basePriceCents: number;
  options: CartOption[];
  unitPriceCents: number;
  qty: number;
  addedAt: number;
}

export const MAX_TOTAL_QTY = 5;

interface AddInput {
  dishId: number;
  name: string;
  imageUrl?: string | null;
  basePriceCents: number;
  options: CartOption[];
}

interface CartState {
  lines: CartLine[];
  totalQty: () => number;
  totalCents: () => number;
  add: (input: AddInput, qty?: number) => 'added' | 'limit';
  inc: (lineId: string) => 'ok' | 'limit';
  dec: (lineId: string) => void;
  remove: (lineId: string) => void;
  clear: () => void;
  /** Clear the cart and its persisted copy (logout / account switch). */
  reset: () => void;
}

const lineKey = (dishId: number, optionIds: number[]): string =>
  `${dishId}|${[...optionIds].sort((a, b) => a - b).join(',')}`;

let seq = 0;
const nextLineId = (): string => {
  seq += 1;
  return `L${seq}-${Math.random().toString(36).slice(2, 8)}`;
};

const isValidLine = (l: unknown): l is CartLine => {
  if (!l || typeof l !== 'object') return false;
  const v = l as Partial<CartLine>;
  return (
    typeof v.dishId === 'number' &&
    typeof v.name === 'string' &&
    typeof v.basePriceCents === 'number' &&
    typeof v.unitPriceCents === 'number' &&
    typeof v.qty === 'number' &&
    v.qty > 0 &&
    Array.isArray(v.options) &&
    typeof v.lineId === 'string'
  );
};

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],

      totalQty: () => get().lines.reduce((sum, l) => sum + l.qty, 0),
      totalCents: () => get().lines.reduce((sum, l) => sum + l.unitPriceCents * l.qty, 0),

      add(input, qty = 1) {
        const currentQty = get().totalQty();
        if (currentQty + qty > MAX_TOTAL_QTY) return 'limit';
        const ids = input.options.map((o) => o.optionId);
        const key = lineKey(input.dishId, ids);
        const existing = get().lines.find((l) => l.lineId.startsWith(`${key}#`));
        if (existing) {
          if (currentQty + qty > MAX_TOTAL_QTY) return 'limit';
          set((s) => ({
            lines: s.lines.map((l) => (l.lineId === existing.lineId ? { ...l, qty: l.qty + qty } : l)),
          }));
          return 'added';
        }
        const unitPriceCents = input.options.reduce((sum, o) => sum + o.priceDeltaCents, input.basePriceCents);
        const line: CartLine = {
          lineId: `${key}#${nextLineId()}`,
          dishId: input.dishId,
          name: input.name,
          imageUrl: input.imageUrl ?? null,
          basePriceCents: input.basePriceCents,
          options: [...input.options].sort((a, b) => a.optionId - b.optionId),
          unitPriceCents,
          qty,
          addedAt: Date.now(),
        };
        set((s) => ({ lines: [...s.lines, line] }));
        return 'added';
      },

      inc(lineId) {
        if (get().totalQty() + 1 > MAX_TOTAL_QTY) return 'limit';
        set((s) => ({ lines: s.lines.map((l) => (l.lineId === lineId ? { ...l, qty: l.qty + 1 } : l)) }));
        return 'ok';
      },

      dec(lineId) {
        const line = get().lines.find((l) => l.lineId === lineId);
        if (!line) return;
        if (line.qty <= 1) {
          set((s) => ({ lines: s.lines.filter((l) => l.lineId !== lineId) }));
        } else {
          set((s) => ({ lines: s.lines.map((l) => (l.lineId === lineId ? { ...l, qty: l.qty - 1 } : l)) }));
        }
      },

      remove(lineId) {
        set((s) => ({ lines: s.lines.filter((l) => l.lineId !== lineId) }));
      },

      clear() {
        set({ lines: [] });
      },

      reset() {
        set({ lines: [] });
        try {
          useCartStore.persist.clearStorage();
        } catch {
          try {
            localStorage.removeItem('webox.cart.v1');
          } catch {
            /* storage unavailable */
          }
        }
      },
    }),
    {
      name: 'webox.cart.v1',
      version: 1,
      partialize: (s) => ({ lines: s.lines }),
      merge: (persisted, current) => {
        const raw = (persisted as { lines?: unknown })?.lines;
        const lines = Array.isArray(raw) ? raw.filter(isValidLine) : [];
        return { ...current, lines };
      },
    },
  ),
);
