import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../api/client';
import { EP } from '../api/endpoints';
import { session } from '../api/session';
import type { Preferences } from '../api/types';
import { normalizePreferences } from '../utils/preferences';

const STORAGE_KEY = 'webox.prefs.v1';

interface PrefsState {
  prefs: Preferences | null;
  /** Account that owns the cached payload; null for legacy/unknown provenance. */
  ownerUserId: number | null;
  setPrefs: (p: Preferences | null) => void;
  reset: () => void;
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      prefs: null,
      ownerUserId: null,
      setPrefs: (p) => set({ prefs: p, ownerUserId: p ? (session.getUser()?.id ?? null) : null }),
      reset: () => set({ prefs: null, ownerUserId: null }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      partialize: (s) => ({ prefs: s.prefs, ownerUserId: s.ownerUserId }),
    },
  ),
);

let loadPromise: Promise<Preferences | null> | null = null;
/** Bumped on every reset so a response for a previous account cannot repopulate the cache. */
let generation = 0;

/** Drop cached preferences (memory + localStorage). Used on logout and account switch. */
export function resetPrefs(): void {
  generation += 1;
  loadPromise = null;
  usePrefsStore.getState().reset();
  try {
    usePrefsStore.persist.clearStorage();
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  }
}

/**
 * Single entry point for reading the employee's preferences.
 * Deduplicates concurrent loads, discards payloads owned by another account and
 * normalizes legacy persisted values so the allergen guard never runs against
 * another user's (`Peanuts`) or a stale (`Balanced` / `0/0`) payload.
 */
export function ensurePrefs(): Promise<Preferences | null> {
  const uid = session.getUser()?.id ?? null;
  const state = usePrefsStore.getState();

  if (state.prefs && (uid === null || state.ownerUserId === uid)) {
    return Promise.resolve(normalizePreferences(state.prefs));
  }
  if (state.prefs || state.ownerUserId !== null) {
    // Cached data does not belong to the current account: purge before reloading.
    generation += 1;
    loadPromise = null;
    state.reset();
    try {
      usePrefsStore.persist.clearStorage();
    } catch {
      /* ignore */
    }
  }

  const gen = generation;
  if (!loadPromise) {
    loadPromise = api
      .get<Preferences>(EP.prefs)
      .then((env) => {
        const normalized = normalizePreferences(env.data);
        // Ignore responses that arrive after a logout/account switch.
        if (gen === generation) usePrefsStore.getState().setPrefs(normalized);
        return normalized;
      })
      .catch(() => null)
      .finally(() => {
        if (gen === generation) loadPromise = null;
      });
  }
  return loadPromise;
}