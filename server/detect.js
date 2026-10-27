// Shared multivariate early-warning engine for One Health reports.
// It combines rule thresholds with a lightweight isolation-forest style anomaly score.
let enginePromise;

async function detect(reports, now = new Date(), options = {}) {
  enginePromise ??= import('../shared/anomalyEngine.mjs');
  const { DEFAULT_CORRIDORS, DEFAULT_ENV, computeAlerts } = await enginePromise;

  return computeAlerts(reports, {
    now,
    env: DEFAULT_ENV,
    corridors: DEFAULT_CORRIDORS,
  });
}

detect.diagnostics = async (reports, now = new Date()) => {
  enginePromise ??= import('../shared/anomalyEngine.mjs');
  const { alertDiagnostics } = await enginePromise;
  return alertDiagnostics(reports, { now });
};

module.exports = detect;
