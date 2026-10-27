const test = require('node:test');
const assert = require('node:assert/strict');
const { parseReportCsvBuffer } = require('../csvImport');

test('csv import converts compatible rows into Mongo report documents', async () => {
  const csv = [
    'city,sector,disease,cases,date,lat,lon,species,symptoms,mortality,vaccination_status,confirmation_status,farm_id,block',
    'Jaipur,animal,Brucellosis,4,2026-10-12,26.91,75.79,Cattle,"abortion, fever",1,unvaccinated,lab_confirmed,JPR-14,Amber',
    'Delhi,human,Dengue,2,12/10/2026,28.61,77.21',
  ].join('\n');

  const parsed = await parseReportCsvBuffer(Buffer.from(csv));

  assert.equal(parsed.error, undefined);
  assert.equal(parsed.skipped, 0);
  assert.equal(parsed.reports.length, 2);
  assert.deepEqual(parsed.reports[0], {
    disease: 'Brucellosis',
    sector: 'animal',
    location: 'Jaipur',
    cases: 4,
    latitude: 26.91,
    longitude: 75.79,
    species: 'Cattle',
    symptoms: 'abortion, fever',
    mortality: 1,
    deaths: 1,
    vaccinationStatus: 'unvaccinated',
    confirmationStatus: 'lab_confirmed',
    farmId: 'JPR-14',
    block: 'Amber',
    state: undefined,
    district: undefined,
    weekNumber: undefined,
    temperatureCelsius: undefined,
    precipitationMm: undefined,
    sourceDataset: undefined,
    sourceUrl: undefined,
    isSynthetic: false,
    date: new Date('2026-10-12T00:00:00.000Z'),
  });
});

test('csv import adapts historical disease and climate rows without inventing sectors or deaths', async () => {
  const csv = [
    '\ufeffdate,year,week_number,disease,cases,state,district,location,latitude,longitude,temperature_celsius_derived,precipitation_mm_source,source_dataset,is_synthetic',
    '2021-01-04,2021,1,Dengue,"2",Rajasthan,Jaipur,Jaipur,26.91,75.79,18.5,0,public-dataset,false',
    '2021-01-05,2021,1,Rainfall anomaly,1,Rajasthan,Jaipur,Jaipur,26.91,75.79,19.1,12.4,public-dataset,true',
    '2021-01-06,2021,1,Malaria,3,Rajasthan,Jaipur,Jaipur,26.91,75.79,20.1,2.4,EpiClim: Weekly District-Wise All-India Multi-Epidemics Climate-Health Dataset,false',
  ].join('\n');

  const parsed = await parseReportCsvBuffer(Buffer.from(csv));

  assert.equal(parsed.error, undefined);
  assert.equal(parsed.reports.length, 3);
  assert.equal(parsed.reports[0].sector, 'unknown');
  assert.equal(parsed.reports[0].cases, 2);
  assert.equal(parsed.reports[0].deaths, undefined);
  assert.equal(parsed.reports[0].district, 'Jaipur');
  assert.equal(parsed.reports[0].weekNumber, '1');
  assert.equal(parsed.reports[1].sector, 'environment');
  assert.equal(parsed.reports[1].temperatureCelsius, 19.1);
  assert.equal(parsed.reports[1].precipitationMm, 12.4);
  assert.equal(parsed.reports[1].isSynthetic, true);
  assert.equal(parsed.reports[2].sector, 'human');
});

test('csv import reports missing required headers', async () => {
  const parsed = await parseReportCsvBuffer(Buffer.from('city,disease\nJaipur,Dengue'));

  assert.match(parsed.error, /cases\/count\/value/);
  assert.equal(parsed.reports.length, 0);
  assert.equal(parsed.skipped, 1);
});

test('csv import preserves disease case values above the manual-entry limit', async () => {
  const parsed = await parseReportCsvBuffer(Buffer.from('date,disease,cases,latitude,longitude\n2022-06-29,Cholera,51225,22.57,88.36'));
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.reports[0].cases, 51225);
});
