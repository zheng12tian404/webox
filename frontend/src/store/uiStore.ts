import { create } from 'zustand';
import { ApiError, errorMessage } from '../api/errors';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  code?: string;
  requestId?: string;
}

interface UiState {
  toasts: ToastItem[];
  push: (kind: ToastKind, message: string, extra?: { code?: string; requestId?: string }) => number;
  dismiss: (id: number) => void;
}

let toastSeq = 0;

export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  push(kind, message, extra) {
    toastSeq += 1;
    const id = toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message, ...extra }] }));
    window.setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, kind === 'error' ? 6000 : 3200);
    return id;
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export const notify = {
  success(message: string): void {
    useUiStore.getState().push('success', message);
  },
  info(message: string): void {
    useUiStore.getState().push('info', message);
  },
  error(err: unknown): void {
    const message = errorMessage(err);
    const code = err instanceof ApiError ? err.code : 'NETWORK_ERROR';
    const requestId = err instanceof ApiError ? err.requestId : '';
    useUiStore.getState().push('error', message, { code, requestId });
  },
  raw(message: string, code = 'ERROR', requestId = ''): void {
    useUiStore.getState().push('error', message, { code, requestId });
  },
};
