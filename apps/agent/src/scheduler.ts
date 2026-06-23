/**
 * Self-scheduling scheduler.
 *
 * Unlike a fixed setInterval, this schedules the NEXT tick only after the
 * current callback has fully resolved, which guarantees the callback can never
 * run concurrently with itself (no re-entrancy / overlap). Each delay is
 * jittered to avoid thundering-herd alignment across many agents.
 */
export class IntervalScheduler {
  private timeoutId: NodeJS.Timeout | null = null;
  private running = false;
  // Tracks the currently in-flight callback invocation so callers (e.g. the
  // agent's graceful stop) can await it before exiting.
  private inFlight: Promise<void> | null = null;

  constructor(private intervalMs: number) {}

  start(callback: () => void | Promise<void>) {
    if (this.running) return;

    this.running = true;

    // Run immediately on start, then chain the next tick once it settles.
    void this.tick(callback);
  }

  stop() {
    this.running = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Resolves once any in-flight callback invocation has settled. Safe to call
   * when nothing is running (resolves immediately).
   */
  async drain(): Promise<void> {
    if (this.inFlight) {
      await this.inFlight;
    }
  }

  private async tick(callback: () => void | Promise<void>): Promise<void> {
    // Run the callback to completion before scheduling the next tick. Because
    // scheduling happens only here, after the awaited callback settles, two
    // invocations can never overlap.
    this.inFlight = this.runCallback(callback);
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }

    if (!this.running) return;

    const delay = this.intervalMs * (0.85 + Math.random() * 0.3);
    this.timeoutId = setTimeout(() => {
      void this.tick(callback);
    }, delay);
  }

  private async runCallback(callback: () => void | Promise<void>): Promise<void> {
    try {
      await callback();
    } catch (error) {
      console.error('Scheduler callback error:', error);
    }
  }

  isRunning(): boolean {
    return this.running;
  }
}
