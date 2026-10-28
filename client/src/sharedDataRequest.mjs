const DEFAULT_TIMEOUT_MS = 30_000;

export function createRequestCoordinator(timeoutMs = DEFAULT_TIMEOUT_MS) {
  let generation = 0;

  return {
    begin() {
      const requestGeneration = ++generation;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new DOMException('Shared data request timed out', 'TimeoutError')), timeoutMs);
      return {
        signal: controller.signal,
        isCurrent: () => requestGeneration === generation,
        invalidate: () => { generation += 1; },
        finish: () => clearTimeout(timer),
      };
    },
    invalidate() {
      generation += 1;
    },
  };
}

export function responseWasNotModified(response) {
  return response?.status === 304;
}
