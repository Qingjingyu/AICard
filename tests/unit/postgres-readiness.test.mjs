import { describe, expect, it } from 'vitest';

import { createStableReadinessTracker } from '../../scripts/postgres-readiness.mjs';

describe('createStableReadinessTracker', () => {
  it('does not accept the temporary bootstrap server as ready', () => {
    const tracker = createStableReadinessTracker(3);

    expect(tracker.observe(0)).toBe(false);
    expect(tracker.observe(1)).toBe(false);
    expect(tracker.observe(0)).toBe(false);
    expect(tracker.observe(0)).toBe(false);
    expect(tracker.observe(0)).toBe(true);
  });
});
