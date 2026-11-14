import { useRef } from 'react';

const uuid = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

/** Stable key bound to a canonical request body: same body -> same key until reset. */
export function useIdempotencyKey(canonicalBody: string) {
  const ref = useRef<{ body: string; key: string } | null>(null);
  if (!ref.current || ref.current.body !== canonicalBody) {
    ref.current = { body: canonicalBody, key: uuid() };
  }
  const key = ref.current.key;
  const reset = () => {
    ref.current = null;
  };
  return { key, reset };
}
