export function createStableReadinessTracker(requiredSuccesses) {
  let consecutiveSuccesses = 0;

  return {
    observe(status) {
      consecutiveSuccesses = status === 0 ? consecutiveSuccesses + 1 : 0;
      return consecutiveSuccesses >= requiredSuccesses;
    },
  };
}
