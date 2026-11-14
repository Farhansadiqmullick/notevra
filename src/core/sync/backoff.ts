/**
 * Exponential backoff with jitter, capped (ARCHITECTURE.md §6.4).
 *
 * Jitter matters more than the exponent: without it, every client that lost connection at the same
 * moment retries at the same moment, and the server gets a stampede exactly when it's least able to
 * take one. `rng` is injectable so the tests can assert exact delays.
 */
export interface BackoffOptions {
  /** first retry delay in ms */
  baseMs?: number;
  /** multiplier per attempt */
  factor?: number;
  /** never wait longer than this */
  capMs?: number;
  /** ± this fraction of the delay, spread randomly (0.2 = ±20%) */
  jitter?: number;
  rng?: () => number;
}

export const DEFAULT_BACKOFF: Required<Omit<BackoffOptions, 'rng'>> = {
  baseMs: 1_000,
  factor: 2,
  capMs: 60_000,
  jitter: 0.2,
};

/**
 * Delay before retry number `attempt` (1 = the first retry).
 * 1s, 2s, 4s, 8s… capped at a minute, each ±20%.
 */
export function backoffDelay(attempt: number, opts: BackoffOptions = {}): number {
  const { baseMs, factor, capMs, jitter } = { ...DEFAULT_BACKOFF, ...opts };
  const rng = opts.rng ?? Math.random;

  const raw = baseMs * factor ** Math.max(0, attempt - 1);
  const capped = Math.min(raw, capMs);
  const spread = capped * jitter;
  // rng() in [0,1) → offset in [-spread, +spread)
  const delay = capped + (rng() * 2 - 1) * spread;
  return Math.max(0, Math.round(delay));
}
