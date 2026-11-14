import { create } from 'zustand';
import { api } from '../api/client';
import { EP } from '../api/endpoints';
import { session } from '../api/session';
import type { AuthTokens, UserInfo } from '../api/types';
import { useCartStore } from './cartStore';
import { ensurePrefs, resetPrefs } from './prefsStore';

/**
 * Preferences and the cart are per-account data. Wipe both (memory + persisted
 * copies) whenever the session changes so account B never inherits A's
 * allergens or basket (AC-021/022/023).
 */
function resetAccountScopedState(): void {
  resetPrefs();
  useCartStore.getState().reset();
}

type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

interface AuthState {
  status: AuthStatus;
  user: UserInfo | null;
  login: (email: string, password: string) => Promise<UserInfo>;
  register: (email: string, password: string, displayName?: string) => Promise<UserInfo>;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: session.getUser(),

  async login(email, password) {
    const env = await api.post<AuthTokens>(EP.login, { email, password }, { auth: false });
    session.setAuth(env.data);
    set({ status: 'authenticated', user: env.data.user });
    // Fresh session: drop the previous account's cached prefs/cart and reload
    // preferences for the new user instead of trusting persisted values.
    resetAccountScopedState();
    void ensurePrefs();
    return env.data.user;
  },

  async register(email, password, displayName) {
    await api.post<{ id: number; email: string; role: string }>(
      EP.register,
      { email, password, ...(displayName ? { displayName } : {}) },
      { auth: false },
    );
    return get().login(email, password);
  },

  async logout() {
    const rt = session.getRefreshToken();
    if (rt) {
      try {
        await api.post(EP.logout, { refreshToken: rt });
      } catch {
        /* logout is best-effort */
      }
    }
    session.clear();
    resetAccountScopedState();
    set({ status: 'anonymous', user: null });
  },

  async bootstrap() {
    if (!session.hasRefreshToken()) {
      resetAccountScopedState();
      set({ status: 'anonymous', user: null });
      return;
    }
    const ok = await session.refresh();
    if (!ok) {
      session.clear();
      resetAccountScopedState();
      set({ status: 'anonymous', user: null });
      return;
    }
    try {
      const env = await api.get<UserInfo>(EP.me);
      session.setUser(env.data);
      set({ status: 'authenticated', user: env.data });
    } catch {
      session.clear();
      resetAccountScopedState();
      set({ status: 'anonymous', user: null });
    }
  },
}));

export const isAdmin = (user: UserInfo | null): boolean => user?.role === 'ADMIN';
