import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { ApiError } from '../api/errors';

interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
}

export function useApiQuery<T>(path: string | null, deps: unknown[] = []) {
  const [state, setState] = useState<QueryState<T>>({ data: null, loading: Boolean(path), error: null });
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(deps);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!path) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .get<T>(path, { signal: controller.signal })
      .then((env) => {
        if (!controller.signal.aborted) setState({ data: env.data, loading: false, error: null });
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setState({ data: null, loading: false, error: e as ApiError });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}
