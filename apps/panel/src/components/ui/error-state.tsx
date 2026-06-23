import { AlertCircle, RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
}

/** Reusable error panel with a Retry button for failed data fetches. */
export function ErrorState({
  title = 'Something went wrong',
  message = 'We could not load this data. Please try again.',
  onRetry,
  retrying = false,
}: ErrorStateProps) {
  return (
    <Card className="bg-card">
      <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/15">
          <AlertCircle aria-hidden="true" className="h-7 w-7 text-destructive" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{message}</p>
        </div>
        {onRetry && (
          <Button variant="outline" onClick={onRetry} disabled={retrying} className="gap-2">
            <RotateCw className={retrying ? 'animate-spin' : undefined} />
            {retrying ? 'Retrying…' : 'Retry'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
