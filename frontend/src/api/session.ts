import type { AuthTokens, UserInfo } from './types';

const STORAGE_KEY = 'webox.auth.v1';
export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

interface Persisted {
  refreshToken: string | null;
  user: UserInfo | null;
}

let accessToken: string | null = null;
let persist: Persisted = { refreshToken: null, user: null };
let refreshPromise: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    persist = {
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
      user: parsed.user && typeof parsed.user === 'object' ? (parsed.user as UserInfo) : null,
    };
  } catch {
    persist = { refreshToken: null, user: null };
  }
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
  } catch {
    /* storage unavailable: keep in memory */
  }
}

function emit(): void {
  listeners.forEach((fn) => fn());
}

load();

export const session = {
  getAccessToken: (): string | null => accessToken,
  getRefreshToken: (): string | null => persist.refreshToken,
  getUser: (): UserInfo | null => persist.user,
  hasRefreshToken: (): boolean => Boolean(persist.refreshToken),
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  setAuth(tokens: AuthTokens): void {
    accessToken = tokens.accessToken;
    persist = { refreshToken: tokens.refreshToken, user: tokens.user };
    save();
    emit();
  },
  setTokens(tokens: { accessToken: string; refreshToken?: string }): void {
    accessToken = tokens.accessToken;
    if (tokens.refreshToken) persist.refreshToken = tokens.refreshToken;
    save();
    emit();
  },
  setUser(user: UserInfo): void {
    persist.user = user;
    save();
    emit();
  },
  clear(): void {
    accessToken = null;
    persist = { refreshToken: null, user: null };
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    emit();
  },
  /** Single-flight refresh. Returns true when a new access token is available. */
  async refresh(): Promise<boolean> {
    if (!persist.refreshToken) return false;
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: persist.refreshToken }),
        });
        if (!res.ok) return false;
        const env = (await res.json()) as { code?: string; data?: { accessToken: string; refreshToken?: string } };
        if (!env.data?.accessToken) return false;
        session.setTokens({ accessToken: env.data.accessToken, refreshToken: env.data.refreshToken });
        return true;
      } catch {
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  },
};
