type ProgressCounter = {
  current: number;
  target: number;
};

function incrementProgress(counter: ProgressCounter, delta = 1): ProgressCounter {
  const normalizedCurrent = Math.max(0, counter.current | 0);
  const normalizedTarget = Math.max(1, counter.target | 0);
  const normalizedDelta = Math.max(1, delta | 0);
  return {
    current: Math.min(normalizedTarget, normalizedCurrent + normalizedDelta),
    target: normalizedTarget,
  };
}

function isProgressComplete(counter: ProgressCounter): boolean {
  return Math.max(0, counter.current | 0) >= Math.max(1, counter.target | 0);
}

export {
  incrementProgress,
  isProgressComplete,
};
