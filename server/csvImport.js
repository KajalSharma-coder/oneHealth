const { Readable } = require('stream');
const csv = require('csv-parser');

const SECTORS = new Set(['human', 'animal', 'environment', 'unknown']);
const MAX_ROWS = 20000;

const CSV_HEADERS = {
  location: ['city', 'location', 'district', 'state', 'province', 'region', 'area', 'place', 'address', 'station'],
  signal: [
    'disease',
    'condition',
    'diagnosis',
    'illness',
    'pathogen',
    'virus',
    'syndrome',
    'symptom',
    'label',
    'target',
    'outbreak',
    'event',
    'signal',
    'parameter',
    'metric',
    'variable',
  ],
  sector: ['sector', 'type', 'category', 'report_type'],
  cases: ['cases', 'case_count', 'count', 'total', 'value', 'number', 'num_cases', 'confirmed', 'incidence', 'patients'],
  date: ['date', 'report_date', 'onset_date', 'created_at', 'updated_at', 'observation_date'],
  year: ['year'],
  weekNumber: ['week_number', 'week', 'epi_week'],
  lat: ['lat', 'latitude'],
  lon: ['lon', 'lng', 'long', 'longitude'],
  species: ['species', 'animal_species', 'livestock_species', 'animal_type'],
  symptoms: ['symptoms', 'clinical_signs', 'signs', 'remarks', 'notes'],
  mortality: ['deaths', 'mortality', 'dead', 'fatalities', 'animal_deaths'],
  vaccinationStatus: ['vaccination_status', 'vaccinated', 'vaccine_status', 'immunization_status'],
  confirmationStatus: ['confirmation_status', 'lab_status', 'test_status', 'confirmed_status', 'case_status'],
  farmId: ['farm_id', 'farm', 'premise_id', 'holding_id', 'owner_id'],
  block: ['block', 'tehsil', 'taluka', 'village', 'panchayat'],
  temperature: ['temperature_celsius_derived', 'temperature_celsius', 'temperature', 'temp'],
  precipitation: ['precipitation_mm_source', 'precipitation_mm', 'precipitation', 'rainfall'],
  sourceDataset: ['source_dataset'],
  sourceUrl: ['source_url', 'url'],
  synthetic: ['is_synthetic', 'synthetic'],
};

const norm = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const findKey = (keys, names) =>
  keys.find((key) => key && names.includes(key))
    || keys.find((key) => key && names.some((name) => key.includes(name) || name.includes(key)));

const findKeys = (keys, names) =>
  keys.filter((key) => key && names.some((name) => key === name || key.includes(name) || name.includes(key)));

const cell = (row, key) => (key ? String(row[key] ?? '').trim() : '');
const cleanText = (value, max = 80) => String(value ?? '').trim().slice(0, max);

function parseCases(value) {
  const raw = String(value ?? '').trim();
  const number = Number(raw.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(number) || number < 0 || number > 1000000000) return null;
  return Math.round(number);
}

function parseCount(value, fallback = undefined) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const number = Number(raw.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(number) || number < 0 || number > 500) return null;
  return Math.round(number);
}

function parseMeasurement(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const number = Number(raw.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? number : undefined;
}

function normalizeEnum(value, allowed, fallback) {
  const key = norm(value);
  if (!key) return fallback;
  if (allowed.has(key)) return key;
  if (/full|yes|done|complete/.test(key) && allowed.has('vaccinated')) return 'vaccinated';
  if (/part/.test(key) && allowed.has('partial')) return 'partial';
  if (/no|not|none|unvaccinated/.test(key) && allowed.has('unvaccinated')) return 'unvaccinated';
  if (/lab|confirm|positive/.test(key) && allowed.has('lab_confirmed')) return 'lab_confirmed';
  if (/suspect|probable/.test(key) && allowed.has('suspected')) return 'suspected';
  return fallback;
}

function parseCoord(value, min, max) {
  const number = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) && number >= min && number <= max ? number : undefined;
}

function parseDateValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  if (/^\d{4}$/.test(raw)) return new Date(Number(raw), 0, 1);
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(raw)) {
    const [first, second, third] = raw.split(/[/-]/).map(Number);
    const year = third < 100 ? 2000 + third : third;
    const date = first > 12 ? new Date(year, second - 1, first) : new Date(year, first - 1, second);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (/^\d{5}$/.test(raw)) {
    const excelDate = new Date(Math.round((Number(raw) - 25569) * 864e5));
    if (!Number.isNaN(excelDate.getTime())) return excelDate;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function detectSector(row, sectorKey, diseaseText, sourceDataset = '') {
  const explicit = norm(cell(row, sectorKey));
  if (explicit.includes('animal') || explicit.includes('livestock') || explicit.includes('veterinary')) return 'animal';
  if (explicit.includes('environment') || explicit.includes('weather') || explicit.includes('water') || explicit.includes('climate')) return 'environment';
  if (explicit.includes('human') || explicit.includes('patient') || explicit.includes('hospital')) return 'human';

  const joined = norm(`${diseaseText} ${cell(row, findKey(Object.keys(row), CSV_HEADERS.species))} ${cell(row, findKey(Object.keys(row), CSV_HEADERS.symptoms))}`);
  if (/animal|livestock|cattle|cow|goat|poultry|chicken|avian|veterinary|farm/.test(joined)) return 'animal';
  if (/rain|rainfall|water|temperature|weather|climate|heat|air|pollution|pm2|environment/.test(joined)) return 'environment';
  if (/human|patient|hospital|clinic|people|person|clinical/.test(joined)) return 'human';
  if (/epiclim|disease.?climate|epidemic|health.?dataset/.test(norm(sourceDataset))) return 'human';
  return 'unknown';
}

function validateHeaders(keys) {
  const locationKeys = findKeys(keys, CSV_HEADERS.location);
  const diseaseKey = findKey(keys, CSV_HEADERS.signal);
  const sectorKey = findKey(keys, CSV_HEADERS.sector);
  const caseKey = findKey(keys, CSV_HEADERS.cases);
  const latKey = findKey(keys, CSV_HEADERS.lat);
  const lonKey = findKey(keys, CSV_HEADERS.lon);
  const speciesKey = findKey(keys, CSV_HEADERS.species);
  const symptomsKey = findKey(keys, CSV_HEADERS.symptoms);
  const mortalityKey = findKey(keys, CSV_HEADERS.mortality);
  const vaccinationKey = findKey(keys, CSV_HEADERS.vaccinationStatus);
  const confirmationKey = findKey(keys, CSV_HEADERS.confirmationStatus);
  const farmKey = findKey(keys, CSV_HEADERS.farmId);
  const blockKey = findKey(keys, CSV_HEADERS.block);
  const missing = [];

  if (!locationKeys.length && (!latKey || !lonKey)) missing.push('location/city/district/state or latitude/longitude');
  if (!caseKey) missing.push('cases/count/value');
  if (!diseaseKey && !sectorKey) missing.push('disease/condition/signal/sector');

  return missing.length ? `Invalid CSV. Missing required header: ${missing.join(', ')}` : null;
}

async function readRows(buffer) {
  const rows = [];
  await new Promise((resolve, reject) => {
    Readable.from(buffer)
      .pipe(csv({ mapHeaders: ({ header }) => norm(header) }))
      .on('data', (row) => {
        if (rows.length < MAX_ROWS) rows.push(row);
      })
      .on('error', reject)
      .on('end', resolve);
  });
  return rows;
}

async function parseReportCsvBuffer(buffer) {
  if (!buffer?.length) return { reports: [], skipped: 0, error: 'Upload a non-empty CSV file.' };

  const rows = await readRows(buffer);
  if (!rows.length) return { reports: [], skipped: 0, error: 'Invalid CSV. Add a header row and at least one data row.' };

  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const headerError = validateHeaders(keys);
  if (headerError) return { reports: [], skipped: rows.length, error: headerError };

  const locationKeys = findKeys(keys, CSV_HEADERS.location);
  const diseaseKey = findKey(keys, CSV_HEADERS.signal);
  const sectorKey = findKey(keys, CSV_HEADERS.sector);
  const caseKey = findKey(keys, CSV_HEADERS.cases);
  const dateKey = findKey(keys, CSV_HEADERS.date);
  const yearKey = findKey(keys, CSV_HEADERS.year);
  const weekNumberKey = findKey(keys, CSV_HEADERS.weekNumber);
  const latKey = findKey(keys, CSV_HEADERS.lat);
  const lonKey = findKey(keys, CSV_HEADERS.lon);
  const speciesKey = findKey(keys, CSV_HEADERS.species);
  const symptomsKey = findKey(keys, CSV_HEADERS.symptoms);
  const mortalityKey = findKey(keys, CSV_HEADERS.mortality);
  const vaccinationKey = findKey(keys, CSV_HEADERS.vaccinationStatus);
  const confirmationKey = findKey(keys, CSV_HEADERS.confirmationStatus);
  const farmKey = findKey(keys, CSV_HEADERS.farmId);
  const blockKey = findKey(keys, CSV_HEADERS.block);
  const temperatureKey = findKey(keys, CSV_HEADERS.temperature);
  const precipitationKey = findKey(keys, CSV_HEADERS.precipitation);
  const sourceDatasetKey = findKey(keys, CSV_HEADERS.sourceDataset);
  const sourceUrlKey = findKey(keys, CSV_HEADERS.sourceUrl);
  const syntheticKey = findKey(keys, CSV_HEADERS.synthetic);
  const stateKey = findKey(keys, ['state']);
  const districtKey = findKey(keys, ['district']);

  const reports = [];
  let skipped = 0;

  rows.forEach((row, index) => {
    if (!Object.values(row).some((value) => String(value ?? '').trim())) {
      skipped += 1;
      return;
    }

    const latitude = parseCoord(cell(row, latKey), -90, 90);
    const longitude = parseCoord(cell(row, lonKey), -180, 180);
    const location = cleanText(
      cell(row, findKey(keys, ['location']))
        || cell(row, findKey(keys, ['city']))
        || cell(row, districtKey)
        || cell(row, stateKey)
        || (latitude !== undefined && longitude !== undefined ? `Point ${index + 1}` : ''),
    );
    const cases = parseCases(cell(row, caseKey));
    const mortality = parseCount(cell(row, mortalityKey), undefined);
    const date = parseDateValue(cell(row, dateKey)) || parseDateValue(cell(row, yearKey));
    const disease = cleanText(cell(row, diseaseKey) || 'Imported CSV signal');
    const sourceDataset = cleanText(cell(row, sourceDatasetKey), 120);
    const sector = detectSector(row, sectorKey, disease, sourceDataset);

    const hasClimateObservation = sector === 'environment'
      && (Number.isFinite(parseMeasurement(cell(row, temperatureKey))) || Number.isFinite(parseMeasurement(cell(row, precipitationKey))));
    if (!location || cases === null || (cases === 0 && !hasClimateObservation) || mortality === null || !date || !SECTORS.has(sector)) {
      skipped += 1;
      return;
    }

    reports.push({
      disease,
      sector,
      location,
      cases,
      latitude,
      longitude,
      species: cleanText(cell(row, speciesKey), 60) || undefined,
      symptoms: cleanText(cell(row, symptomsKey), 240) || undefined,
      mortality,
      deaths: mortality,
      vaccinationStatus: normalizeEnum(cell(row, vaccinationKey), new Set(['unknown', 'vaccinated', 'partial', 'unvaccinated']), 'unknown'),
      confirmationStatus: normalizeEnum(cell(row, confirmationKey), new Set(['suspected', 'lab_confirmed']), 'suspected'),
      farmId: cleanText(cell(row, farmKey), 80) || undefined,
      block: cleanText(cell(row, blockKey), 80) || undefined,
      state: cleanText(cell(row, stateKey), 80) || undefined,
      district: cleanText(cell(row, districtKey), 80) || undefined,
      weekNumber: cleanText(cell(row, weekNumberKey), 20) || undefined,
      temperatureCelsius: parseMeasurement(cell(row, temperatureKey)),
      precipitationMm: parseMeasurement(cell(row, precipitationKey)),
      sourceDataset: sourceDataset || undefined,
      sourceUrl: cleanText(cell(row, sourceUrlKey), 500) || undefined,
      isSynthetic: /^(true|1|yes)$/i.test(cell(row, syntheticKey)),
      date,
    });
  });

  if (!reports.length) return { reports, skipped, error: 'No valid report rows found in this CSV.' };
  return { reports, skipped: skipped + Math.max(0, rows.length - MAX_ROWS) };
}

module.exports = { parseReportCsvBuffer };
