'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  id: number;
  open: boolean;
  resolve: (value: boolean) => void;
}

type Listener = (state: ConfirmState | null) => void;

let current: ConfirmState | null = null;
const listeners = new Set<Listener>();
let counter = 0;

function emit() {
  for (const listener of listeners) listener(current);
}

/**
 * Imperative confirm dialog. Returns a Promise that resolves to `true` when the
 * user confirms and `false` when they cancel / dismiss (Esc, overlay, X).
 *
 * Usage:
 *   if (!(await confirm({ title: 'Delete node?', destructive: true }))) return;
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // If a dialog is already open, resolve it as cancelled before replacing.
    if (current) current.resolve(false);
    counter += 1;
    current = { ...options, id: counter, open: true, resolve };
    emit();
  });
}

function settle(value: boolean) {
  if (!current) return;
  current.resolve(value);
  // Keep the record but mark closed so the exit animation can play.
  current = { ...current, open: false, resolve: () => {} };
  emit();
}

/** Mounted once (in the dashboard layout / root) to render confirm dialogs. */
export function ConfirmDialogHost() {
  const [state, setState] = React.useState<ConfirmState | null>(current);

  React.useEffect(() => {
    const listener: Listener = (next) => setState(next);
    listeners.add(listener);
    setState(current);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const handleOpenChange = (open: boolean) => {
    if (!open) settle(false);
  };

  return (
    <Dialog open={state?.open ?? false} onOpenChange={handleOpenChange}>
      <DialogContent showClose={false} className="max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            {state?.destructive && (
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive/15">
                <AlertTriangle
                  aria-hidden="true"
                  className="h-5 w-5 text-destructive"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <DialogTitle>{state?.title}</DialogTitle>
              {state?.description && (
                <DialogDescription>{state.description}</DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => settle(false)}>
            {state?.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={state?.destructive ? 'destructive' : 'default'}
            onClick={() => settle(true)}
            autoFocus
          >
            {state?.confirmLabel ?? 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
