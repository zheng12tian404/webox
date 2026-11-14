import { API_BASE, session } from './session';
import { ApiError } from './errors';
import type { ApiEnvelope } from './types';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  auth?: boolean;
  timeoutMs?: number;
}

const TIMEOUT = Number(import.meta.env.VITE_REQUEST_TIMEOUT_MS ?? 15000);

function buildUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export function pageQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function handleUnauthorized(): void {
  session.clear();
  window.dispatchEvent(new CustomEvent('webox:auth-expired'));
  if (window.location.pathname !== '/login') {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.assign(`/login?next=${next}`);
  }
}

async function doFetch(url: string, init: RequestInit, timeoutMs: number, outer?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  outer?.addEventListener('abort', onAbort);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

async function request<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<ApiEnvelope<T>> {
  const auth = opts.auth !== false;
  const token = auth ? session.getAccessToken() : null;
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (!(opts.body instanceof FormData) && opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await doFetch(
      buildUrl(path),
      {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body === undefined ? undefined : opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body),
      },
      opts.timeoutMs ?? TIMEOUT,
      opts.signal,
    );
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    throw new ApiError(0, 'NETWORK_ERROR', 'Network error', '', null);
  }

  let envelope: ApiEnvelope<T> | null = null;
  let parseFailed = false;
  try {
    envelope = (await res.json()) as ApiEnvelope<T>;
  } catch {
    parseFailed = true;
  }

  if (res.status === 401 && auth) {
    if (!retried) {
      const ok = await session.refresh();
      if (ok) return request<T>(path, { ...opts, headers: { ...opts.headers } }, true);
    }
    handleUnauthorized();
    const body = envelope as ApiEnvelope<unknown> | null;
    throw new ApiError(401, body?.code ?? 'AUTH_UNAUTHORIZED', body?.message ?? 'Unauthorized', body?.requestId ?? '', body?.data ?? null);
  }

  if (!res.ok || parseFailed || (envelope && envelope.code !== 'OK')) {
    const body = envelope as ApiEnvelope<unknown> | null;
    throw new ApiError(
      res.status,
      body?.code ?? (parseFailed ? 'INTERNAL' : `HTTP_${res.status}`),
      body?.message ?? 'Request failed',
      body?.requestId ?? res.headers.get('X-Request-Id') ?? '',
      body?.data ?? null,
    );
  }

  const ok = envelope as ApiEnvelope<T>;
  if (!ok.requestId) ok.requestId = res.headers.get('X-Request-Id') ?? '';
  return ok;
}

export const api = {
  get<T>(path: string, opts?: RequestOptions): Promise<ApiEnvelope<T>> {
    return request<T>(path, { ...opts, method: 'GET' });
  },
  post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<ApiEnvelope<T>> {
    return request<T>(path, { ...opts, method: 'POST', body });
  },
  put<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<ApiEnvelope<T>> {
    return request<T>(path, { ...opts, method: 'PUT', body });
  },
  patch<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<ApiEnvelope<T>> {
    return request<T>(path, { ...opts, method: 'PATCH', body });
  },
  del<T>(path: string, opts?: RequestOptions): Promise<ApiEnvelope<T>> {
    return request<T>(path, { ...opts, method: 'DELETE' });
  },
  request,
};

export { ApiError };
