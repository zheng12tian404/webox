import { API_BASE, session } from './session';

export interface SseOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  signal: AbortSignal;
  onEvent: (event: string, data: string) => void;
}

/** Consume an SSE endpoint using fetch + ReadableStream (Bearer auth). */
export async function openSse(path: string, opts: SseOptions): Promise<void> {
  const token = session.getAccessToken();
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    ...(opts.headers ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: opts.signal,
  });

  if (!res.ok) {
    let code = `HTTP_${res.status}`;
    try {
      const env = (await res.json()) as { code?: string };
      if (env.code) code = env.code;
    } catch {
      /* ignore */
    }
    const err = new Error(code) as Error & { code: string; status: number };
    err.code = code;
    err.status = res.status;
    throw err;
  }
  if (!res.body) throw new Error('STREAM_UNSUPPORTED');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (frame: string) => {
    let event = 'message';
    const dataLines: string[] = [];
    for (const rawLine of frame.split(/\r?\n/)) {
      if (!rawLine || rawLine.startsWith(':')) continue;
      const idx = rawLine.indexOf(':');
      const field = idx === -1 ? rawLine : rawLine.slice(0, idx);
      let value = idx === -1 ? '' : rawLine.slice(idx + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') dataLines.push(value);
    }
    if (dataLines.length > 0) opts.onEvent(event, dataLines.join('\n'));
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (frame.trim()) dispatch(frame);
      }
    }
    if (buffer.trim()) dispatch(buffer);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

export function parseEventJson<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}
