import { describe, it, expect } from 'vitest';
import { backoffDelay } from './backoff';

// rng() = 0.5 → no jitter offset, so the raw curve is assertable
const noJitter = () => 0.5;

describe('backoffDelay', () => {
  it('doubles each attempt', () => {
    expect(backoffDelay(1, { rng: noJitter })).toBe(1000);
    expect(backoffDelay(2, { rng: noJitter })).toBe(2000);
    expect(backoffDelay(3, { rng: noJitter })).toBe(4000);
    expect(backoffDelay(4, { rng: noJitter })).toBe(8000);
  });

  it('caps, so a long outage never schedules a retry hours away', () => {
    expect(backoffDelay(20, { rng: noJitter })).toBe(60_000);
  });

  it('spreads retries either side of the delay — clients that failed together must not return together', () => {
    const earliest = backoffDelay(3, { rng: () => 0 });
    const latest = backoffDelay(3, { rng: () => 0.999 });
    expect(earliest).toBe(3200); // 4000 - 20%
    expect(latest).toBeGreaterThan(4700); // 4000 + ~20%
    expect(earliest).toBeLessThan(latest);
  });

  it('never returns a negative delay', () => {
    expect(backoffDelay(1, { jitter: 5, rng: () => 0 })).toBe(0);
  });
});
