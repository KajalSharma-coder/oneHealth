import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateCasesBySector, aggregateDiseaseCases, calculateDashboardMetrics, filterReportsByPeriod, periodAvailability } from '../../shared/reportAnalytics.mjs';

test('period filtering uses record dates, excludes future rows, and aggregates cases by supported sector', () => {
  const rows = [
    { date: '2021-01-10', sector: 'human', cases: 4 },
    { date: '2021-01-04', sector: 'animal', cases: 3 },
    { date: '2021-01-11', sector: 'unknown', cases: 100 },
    { date: '2021-01-12', sector: 'human', cases: 50 },
  ];

  const selected = filterReportsByPeriod(rows, '2021-01-10', 7);
  assert.deepEqual(selected.map((row) => row.date), ['2021-01-10', '2021-01-04']);
  assert.deepEqual(aggregateCasesBySector(selected), { human: 4, animal: 3, environment: 0 });
});

test('all-period filtering preserves records with missing dates for legacy demo rows', () => {
  const selected = filterReportsByPeriod([{ day: 2, sector: 'human', cases: 2 }], '2021-01-10', 'all');
  assert.equal(selected.length, 1);
});

test('period availability explains an empty recent period for historical data', () => {
  const status = periodAvailability([{ date: '2022-01-01', sector: 'human', cases: 2 }], '2025-12-31', 7);
  assert.equal(status.empty, true);
  assert.equal(status.hasHistoricalData, true);
  assert.equal(status.earliest.toISOString(), '2022-01-01T00:00:00.000Z');
});

test('dashboard metrics distinguish cases, report rows, climate observations, and unavailable animal data', () => {
  const rows = [
    { date: '2022-06-29', sec: 'human', dis: 'Malaria', n: 51225, temperatureCelsius: 29 },
    { date: '2022-06-28', sec: 'human', dis: 'Dengue', n: 3, precipitationMm: 1.2 },
    { date: '2022-06-27', sec: 'unknown', dis: 'Cholera', n: 9 },
  ];
  assert.deepEqual(calculateDashboardMetrics(rows), { humanCases: 51228, animalReports: null, climateObservations: 2 });
  assert.equal(aggregateDiseaseCases(rows).Malaria.cases, 51225);
});
