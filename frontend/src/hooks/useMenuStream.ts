import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { EP } from '../api/endpoints';
import { openSse, parseEventJson } from '../api/sse';
import type { MenuItem, Paged, StockEvent } from '../api/types';
import { useStockStore } from '../store/stockStore';

export type StockMode = 'off' | 'live' | 'polling';

/** Subscribe to /menu/stream; after 3 consecutive failures fall back to 5s polling. */
export function useMenuStream(enabled: boolean): StockMode {
  const [mode, setMode] = useState<StockMode>('off');

  useEffect(() => {
    if (!enabled) {
      setMode('off');
      return;
    }
    let stopped = false;
    let failures = 0;
    let controller: AbortController | null = null;
    let pollTimer = 0;
    let retryTimer = 0;

    const store = useStockStore.getState();

    const startPolling = () => {
      if (stopped) return;
      setMode('polling');
      store.setLive(false);
      const poll = async () => {
        if (stopped) return;
        try {
          const env = await api.get<Paged<MenuItem>>(`${EP.menu}${`?page=1&size=100`}`);
          for (const item of env.data.items) {
            useStockStore.getState().setStock(item.dishId, item.availableQty);
          }
        } catch {
          /* keep polling */
        }
        if (!stopped) pollTimer = window.setTimeout(poll, Number(import.meta.env.VITE_SSE_POLL_MS ?? 5000));
      };
      void poll();
    };

    const connect = async () => {
      if (stopped) return;
      controller = new AbortController();
      try {
        setMode('live');
        store.setLive(true);
        await openSse(EP.stream, {
          signal: controller.signal,
          onEvent: (event, data) => {
            if (event === 'snapshot') {
              const items = parseEventJson<StockEvent[]>(data);
              if (Array.isArray(items)) useStockStore.getState().setSnapshot(items);
            } else if (event === 'stock') {
              const item = parseEventJson<StockEvent>(data);
              if (item && typeof item.dishId === 'number') {
                useStockStore.getState().setStock(item.dishId, item.available);
              }
            }
          },
        });
        if (!stopped) {
          failures += 1;
          if (failures >= 3) startPolling();
          else retryTimer = window.setTimeout(connect, 3000);
        }
      } catch {
        if (stopped || controller.signal.aborted) return;
        failures += 1;
        if (failures >= 3) startPolling();
        else retryTimer = window.setTimeout(connect, 3000);
      }
    };

    void connect();

    return () => {
      stopped = true;
      controller?.abort();
      window.clearTimeout(pollTimer);
      window.clearTimeout(retryTimer);
      useStockStore.getState().setLive(false);
    };
  }, [enabled]);

  return mode;
}
