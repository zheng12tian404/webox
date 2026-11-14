import { create } from 'zustand';
import type { StockEvent } from '../api/types';

interface StockState {
  available: Record<number, number>;
  live: boolean;
  setSnapshot: (items: StockEvent[]) => void;
  setStock: (dishId: number, available: number) => void;
  setLive: (live: boolean) => void;
  reset: () => void;
}

export const useStockStore = create<StockState>((set) => ({
  available: {},
  live: false,
  setSnapshot(items) {
    const next: Record<number, number> = {};
    for (const it of items) {
      if (typeof it.dishId === 'number' && typeof it.available === 'number') next[it.dishId] = it.available;
    }
    set({ available: next });
  },
  setStock(dishId, available) {
    set((s) => ({ available: { ...s.available, [dishId]: available } }));
  },
  setLive(live) {
    set({ live });
  },
  reset() {
    set({ available: {}, live: false });
  },
}));
