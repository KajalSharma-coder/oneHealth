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

// Evaluate a persisted historical dataset against its own dates. Each anchor
// uses the same 30-day window and thresholds as the live detector; alert_label
// and other CSV labels are deliberately not consulted.
detect.historical = async (reports) => {
  enginePromise ??= import('../shared/anomalyEngine.mjs');
  const { DEFAULT_CORRIDORS, DEFAULT_ENV, computeAlerts, alertDiagnostics } = await enginePromise;
  const dates = reports
    .map((row) => new Date(row.date))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a - b);
  if (!dates.length) return { alerts: [], diagnostics: [{ code: 'no_data', message: 'No dated records are available in the selected dataset.' }], windows: 0, referenceDate: new Date() };

  const DAY = 24 * 60 * 60 * 1000;
  const firstAnchor = new Date(dates[0].getTime() + 29 * DAY);
  const latest = dates[dates.length - 1];
  const anchors = [];
  for (let anchor = firstAnchor.getTime(); anchor <= latest.getTime(); anchor += 7 * DAY) anchors.push(new Date(anchor));
  if (!anchors.length || anchors.at(-1).getTime() !== latest.getTime()) anchors.push(latest);

  const candidates = [];
  for (const anchor of anchors) {
    const start = new Date(anchor.getTime() - 29 * DAY);
    const window = reports.filter((row) => {
      const date = new Date(row.date);
      return !Number.isNaN(date.getTime()) && date >= start && date <= anchor;
    });
    const windowAlerts = computeAlerts(window, { now: anchor, env: DEFAULT_ENV, corridors: DEFAULT_CORRIDORS });
    windowAlerts.forEach((alert) => candidates.push({
      ...alert,
      analysisDate: anchor.toISOString(),
      analysisMode: 'historical',
      analysisWindowStart: start.toISOString(),
      analysisWindowEnd: anchor.toISOString(),
    }));
  }

  // Overlapping weekly windows can describe the same location/disease event.
  // Keep the strongest verified event per location and disease for display.
  const strongest = new Map();
  candidates.forEach((alert) => {
    const key = `${alert.location}|${alert.disease}`;
    const current = strongest.get(key);
    if (!current || alert.risk > current.risk || (alert.risk === current.risk && alert.analysisDate > current.analysisDate)) strongest.set(key, alert);
  });
  const diagnostics = candidates.length ? [] : alertDiagnostics(reports.filter((row) => {
    const date = new Date(row.date);
    return !Number.isNaN(date.getTime()) && date >= new Date(latest.getTime() - 29 * DAY) && date <= latest;
  }), { now: latest });
  return { alerts: [...strongest.values()].sort((a, b) => new Date(b.analysisDate) - new Date(a.analysisDate) || b.risk - a.risk), diagnostics, windows: anchors.length, referenceDate: latest };
};

module.exports = detect;
