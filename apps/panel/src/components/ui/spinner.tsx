import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

interface SpinnerProps {
  className?: string;
  /** Accessible label announced to screen readers. */
  label?: string;
}

/** Accessible loading spinner: role=status + sr-only label. */
export function Spinner({ className, label = 'Loading' }: SpinnerProps) {
  return (
    <span role="status" className={cn('inline-flex', className)}>
      <Loader2 aria-hidden="true" className="h-full w-full animate-spin" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Full-area centered spinner for page/section loading states. */
export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-16">
      <Spinner className="h-10 w-10 text-primary" label={label} />
    </div>
  );
}
