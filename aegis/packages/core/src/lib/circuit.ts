import { m } from "./metrics.js";

/**
 * Circuit breakers (docs/PERFORMANCE.md). After `threshold` consecutive failures a circuit opens for
 * `openMs`: calls are refused at once instead of waiting on a system that is down. After that one trial
 * call is let through (half open); success closes the circuit, failure opens it again. State is per
 * process, so each replica protects itself; it never lets a call through that would otherwise be refused.
 */
export interface CircuitOptions {
  threshold: number;
  openMs: number;
}

type State = { failures: number; openedAt: number | null; trial: boolean };

export class CircuitBreaker {
  private states = new Map<string, State>();
  constructor(
    readonly kind: string,
    private readonly opts: CircuitOptions = { threshold: 5, openMs: 30_000 },
    private readonly now: () => number = Date.now,
  ) {}

  /** Whether a call for this key may go ahead now. */
  allow(key: string): boolean {
    const s = this.states.get(key);
    if (!s || s.openedAt === null) return true;
    if (this.now() - s.openedAt < this.opts.openMs) {
      m.circuitRejected.inc({ kind: this.kind });
      return false;
    }
    if (s.trial) {
      m.circuitRejected.inc({ kind: this.kind });
      return false;
    }
    s.trial = true;
    return true;
  }

  success(key: string) {
    this.states.delete(key);
  }

  failure(key: string) {
    const s = this.states.get(key) ?? { failures: 0, openedAt: null, trial: false };
    s.failures += 1;
    if (s.trial || (s.openedAt === null && s.failures >= this.opts.threshold)) {
      s.openedAt = this.now();
      s.trial = false;
      m.circuitOpen.inc({ kind: this.kind });
    }
    this.states.set(key, s);
  }

  state(key: string): "closed" | "open" | "half_open" {
    const s = this.states.get(key);
    if (!s || s.openedAt === null) return "closed";
    return this.now() - s.openedAt < this.opts.openMs ? "open" : "half_open";
  }

  openKeys(): string[] {
    return [...this.states.entries()].filter(([, s]) => s.openedAt !== null && this.now() - s.openedAt < this.opts.openMs).map(([k]) => k);
  }
}

/** One breaker per kind of outbound call, shared by the whole process. */
export const breakers = {
  execution: new CircuitBreaker("execution"),
  destination: new CircuitBreaker("destination", { threshold: 5, openMs: 60_000 }),
};
