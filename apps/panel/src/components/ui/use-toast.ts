'use client';

import * as React from 'react';

import type { ToastVariant } from './toast';

export interface ToastOptions {
  title?: string;
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss duration in ms. Defaults to 5000. */
  duration?: number;
}

export interface ToastRecord extends Required<Pick<ToastOptions, 'variant'>> {
  id: string;
  title?: string;
  description?: string;
  duration: number;
  open: boolean;
}

type Listener = (toasts: ToastRecord[]) => void;

const TOAST_LIMIT = 4;
const DEFAULT_DURATION = 5000;
// Time the exit animation needs before the record is removed from the array.
const REMOVE_DELAY = 250;

let toasts: ToastRecord[] = [];
const listeners = new Set<Listener>();
const removalTimers = new Map<string, ReturnType<typeof setTimeout>>();

let counter = 0;
function genId(): string {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return `toast-${Date.now()}-${counter}`;
}

function emit() {
  for (const listener of listeners) listener(toasts);
}

function scheduleRemoval(id: string) {
  if (removalTimers.has(id)) return;
  const timer = setTimeout(() => {
    removalTimers.delete(id);
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, REMOVE_DELAY);
  removalTimers.set(id, timer);
}

export function dismissToast(id: string) {
  toasts = toasts.map((t) => (t.id === id ? { ...t, open: false } : t));
  emit();
  scheduleRemoval(id);
}

/**
 * Imperative toast API. Safe to call from event handlers, catch blocks, or
 * anywhere else — it pushes onto a singleton store that <Toaster/> subscribes to.
 */
export function toast(options: ToastOptions): { id: string; dismiss: () => void } {
  const id = genId();
  const record: ToastRecord = {
    id,
    title: options.title,
    description: options.description,
    variant: options.variant ?? 'default',
    duration: options.duration ?? DEFAULT_DURATION,
    open: true,
  };

  toasts = [record, ...toasts].slice(0, TOAST_LIMIT);
  emit();

  return { id, dismiss: () => dismissToast(id) };
}

/** Subscribe a React component to the toast store. */
export function useToast() {
  const [state, setState] = React.useState<ToastRecord[]>(toasts);

  React.useEffect(() => {
    const listener: Listener = (next) => setState(next);
    listeners.add(listener);
    setState(toasts);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return { toasts: state, toast, dismiss: dismissToast };
}
