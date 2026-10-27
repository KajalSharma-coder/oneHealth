import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ML_MODEL,
  buildCityBuckets,
  cityStats,
  computeAlerts,
  isolationForestScores,
  alertDiagnostics,
} from '../../shared/anomalyEngine.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-12T00:00:00.000Z');

const datedReport = ({ day, location = 'Jaipur', sector = 'animal', disease = 'Brucellosis', cases = 1 }) => ({
  location,
  sector,
  disease,
  cases,
  date: new Date(NOW.getTime() - day * DAY),
});

const uiReport = ({ day, loc = 'Jaipur', sec = 'animal', dis = 'Brucellosis', n = 1 }) => ({
  day,
  loc,
  sec,
  dis,
  n,
});

test('shared buckets accept backend and frontend report shapes', () => {
  const buckets = buildCityBuckets(
    [
      datedReport({ day: 0, cases: 2 }),
      uiReport({ day: 0, n: 3 }),
      datedReport({ day: 31, cases: 99 }),
    ],
    NOW,
  );

  assert.equal(buckets.Jaipur.all[0], 5);
  assert.equal(buckets.Jaipur.sector.animal[0], 5);
});

test('shared alert engine returns the same result for API and UI report data', () => {
  const apiReports = [];
  const uiReports = [];

  for (let day = 7; day < 30; day += 1) {
    apiReports.push(datedReport({ day }));
    uiReports.push(uiReport({ day }));
  }

  for (let day = 0; day < 7; day += 1) {
    apiReports.push(datedReport({ day, cases: 3 }));
    uiReports.push(uiReport({ day, n: 3 }));
  }

  const apiAlerts = computeAlerts(apiReports, { now: NOW });
  const uiAlerts = computeAlerts(uiReports, { now: NOW });

  assert.equal(apiAlerts.length, 1);
  assert.deepEqual(
    apiAlerts.map(({ location, recent, disease, level }) => ({ location, recent, disease, level })),
    uiAlerts.map(({ location, recent, disease, level }) => ({ location, recent, disease, level })),
  );
});

test('isolation forest style score is deterministic and ranks a multivariate outlier higher', () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({
    location: `Normal ${index}`,
    features: [5 + (index % 2), 1.1, 0.2, 1, 0.1, 1, 0.1],
  }));
  rows.push({ location: 'Outlier', features: [50, 4, 5, 3, 4, 8, 5] });

  const first = isolationForestScores(rows);
  const second = isolationForestScores(rows);

  assert.deepEqual(first, second);
  assert.ok(first.Outlier > first['Normal 0']);
  assert.ok(first.Outlier >= 0.66);
});

test('ML score can raise an alert before rule thresholds fully cross', () => {
  const reports = [];
  const add = (loc, day, sec = 'human', cases = 1) => reports.push(uiReport({ loc, day, sec, dis: 'Syndromic signal', n: cases }));

  for (const loc of ['Delhi', 'Mumbai', 'Pune', 'Chennai', 'Kolkata', 'Bengaluru', 'Hyderabad', 'Lucknow']) {
    for (let day = 7; day < 30; day += 1) add(loc, day);
    for (let day = 0; day < 7; day += 1) add(loc, day);
  }

  for (let day = 7; day < 30; day += 1) add('Jaipur', day, 'animal');
  for (let day = 0; day < 5; day += 1) add('Jaipur', day, 'animal', 2);

  const [alert] = computeAlerts(reports, { now: NOW });
  const stats = cityStats(reports, 'Jaipur', NOW);

  assert.ok(stats.z < 2);
  assert.equal(alert.location, 'Jaipur');
  assert.ok(alert.mlScore >= 0.66);
  assert.ok(alert.drivers.some((driver) => driver.startsWith('ML anomaly score')));
  assert.equal(alert.ml.modelVersion, ML_MODEL.version);
  assert.equal(alert.validation.modelVersion, ML_MODEL.version);
  assert.ok(alert.validation.checks.length >= 5);
});

test('climate-only observations affect weather features but cannot create disease alerts', () => {
  const reports = Array.from({ length: 30 }, (_, day) => ({
    location: 'Jaipur', sector: 'environment', disease: 'Weather observation', cases: 0,
    temperatureCelsius: day < 7 ? 40 : 20, precipitationMm: day < 7 ? 0 : 10,
    date: new Date(NOW.getTime() - day * DAY),
  }));
  const alerts = computeAlerts(reports, { now: NOW, env: {} });
  assert.deepEqual(alerts, []);
  assert.match(alertDiagnostics(reports, { now: NOW })[0].message, /baseline coverage|recent disease activity/);
});

test('combined reports from multiple dataset uploads produce one shared alert scope', () => {
  const reports = [];
  for (let day = 7; day < 30; day += 1) reports.push({ datasetId: 'admin-a', ...datedReport({ day, cases: 1 }) });
  for (let day = 0; day < 7; day += 1) reports.push({ datasetId: 'admin-b', ...datedReport({ day, cases: 3 }) });
  const alerts = computeAlerts(reports, { now: NOW });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].location, 'Jaipur');
  assert.equal(alerts[0].recent, 21);
});
