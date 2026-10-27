const test = require('node:test');
const assert = require('node:assert/strict');
const { assessReportQuality, withReportQuality } = require('../reportQuality');

test('report quality flags incomplete animal reports', () => {
  const quality = assessReportQuality({
    disease: 'Brucellosis',
    sector: 'animal',
    location: 'Jaipur',
    cases: 2,
    mortality: 3,
    sourceType: 'csv',
  });

  assert.ok(quality.dataQualityScore < 75);
  assert.deepEqual(quality.qualityFlags.sort(), [
    'lab_pending',
    'missing_block_or_village',
    'missing_coordinates',
    'missing_farm_or_holding',
    'missing_species',
    'mortality_exceeds_cases',
    'unknown_vaccination',
  ].sort());
});

test('report quality attaches provenance and scores complete reports highly', () => {
  const report = withReportQuality({
    disease: 'Avian influenza',
    sector: 'animal',
    location: 'Guwahati',
    cases: 4,
    latitude: 26.14,
    longitude: 91.74,
    species: 'Poultry',
    mortality: 1,
    vaccinationStatus: 'vaccinated',
    confirmationStatus: 'lab_confirmed',
    farmId: 'GHY-08',
    block: 'Dispur',
  }, {
    sourceType: 'manual',
    sourceName: 'Manual report form',
    sourceUploadedBy: 'analyst',
  });

  assert.equal(report.sourceType, 'manual');
  assert.equal(report.sourceName, 'Manual report form');
  assert.equal(report.sourceUploadedBy, 'analyst');
  assert.ok(report.sourceUploadedAt instanceof Date);
  assert.equal(report.qualityFlags.length, 0);
  assert.ok(report.dataQualityScore >= 90);
});

test('report quality preserves dataset identity during CSV imports', () => {
  const report = withReportQuality({ disease: 'Dengue', sector: 'human', location: 'Delhi', cases: 2 }, {
    datasetId: 'dataset-a',
    sourceType: 'csv',
    sourceName: 'a.csv',
  });
  assert.equal(report.datasetId, 'dataset-a');
});
