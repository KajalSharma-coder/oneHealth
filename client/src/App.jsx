import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { ML_MODEL, cityStats, computeAlerts as computeSharedAlerts } from '../../shared/anomalyEngine.mjs';
import { aggregateDiseaseCases, calculateDashboardMetrics, filterReportsByPeriod, periodAvailability, recordDate } from '../../shared/reportAnalytics.mjs';

const SECTORS = {
  human: 'Human',
  animal: 'Animal',
  environment: 'Environment',
};

const COLORS = {
  human: 'var(--human)',
  animal: 'var(--animal)',
  environment: 'var(--env)',
  alert: 'var(--alert)',
};

const AUTH_STORAGE_KEY = 'onehealth-auth';
const BROWSER_DATASET_STORAGE_KEY = 'onehealth-browser-dataset';
const BROWSER_MODE_STORAGE_KEY = 'onehealth-browser-mode';

function openBrowserDatasetStore() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const request = window.indexedDB.open('onehealth-local-data', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('datasets');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveBrowserDataset(dataset) {
  const db = await openBrowserDatasetStore();
  await new Promise((resolve, reject) => {
    const request = db.transaction('datasets', 'readwrite').objectStore('datasets').put(dataset, BROWSER_DATASET_STORAGE_KEY);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  db.close();
}

async function readBrowserDataset() {
  const db = await openBrowserDatasetStore();
  const dataset = await new Promise((resolve, reject) => {
    const request = db.transaction('datasets', 'readonly').objectStore('datasets').get(BROWSER_DATASET_STORAGE_KEY);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return dataset;
}

async function clearBrowserDataset() {
  try {
    const db = await openBrowserDatasetStore();
    await new Promise((resolve, reject) => {
      const request = db.transaction('datasets', 'readwrite').objectStore('datasets').delete(BROWSER_DATASET_STORAGE_KEY);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
    db.close();
  } catch {
    // Local persistence is optional; server-backed datasets remain unaffected.
  }
}
const can = (auth, permission) => auth?.user?.permissions?.includes(permission);

const DISEASES = {
  human: ['Dengue', 'Leptospirosis', 'Rabies', 'Brucellosis'],
  animal: ['Avian influenza', 'Anthrax', 'Brucellosis', 'Foot-and-mouth'],
  environment: ['Heat index', 'Rainfall anomaly', 'Water contamination'],
};

const SPECIES_OPTIONS = ['Cattle', 'Buffalo', 'Goat', 'Sheep', 'Poultry', 'Pig', 'Mixed herd'];
const VACCINATION_OPTIONS = {
  unknown: 'Unknown',
  vaccinated: 'Vaccinated',
  partial: 'Partial',
  unvaccinated: 'Unvaccinated',
};
const CONFIRMATION_OPTIONS = {
  suspected: 'Suspected',
  lab_confirmed: 'Lab confirmed',
};
const RESPONSE_STATUSES = {
  new: 'New',
  investigating: 'Investigating',
  sample_collected: 'Sample collected',
  contained: 'Contained',
  resolved: 'Resolved',
};
const SOURCE_LABELS = {
  manual: 'Manual entry',
  csv: 'CSV import',
  seed: 'Seed dataset',
  demo: 'Demo dataset',
  csv_browser: 'Browser CSV',
};
const QUALITY_LABELS = {
  missing_coordinates: 'No coordinates',
  missing_species: 'Species missing',
  unknown_vaccination: 'Vaccination unknown',
  lab_pending: 'Lab pending',
  missing_farm_or_holding: 'Farm missing',
  missing_block_or_village: 'Block missing',
  stale_report: 'Stale report',
  mortality_exceeds_cases: 'Deaths exceed cases',
  missing_source: 'Source missing',
};

const CITY_COORDS = {
  Agartala: [23.84, 91.28],
  Agra: [27.18, 78.01],
  Ahmedabad: [23.02, 72.57],
  Aizawl: [23.73, 92.72],
  Ajmer: [26.45, 74.64],
  Amritsar: [31.63, 74.87],
  Bengaluru: [12.97, 77.59],
  Bhopal: [23.26, 77.41],
  Bhubaneswar: [20.3, 85.82],
  Chandigarh: [30.73, 76.78],
  Chennai: [13.08, 80.27],
  Coimbatore: [11.02, 76.96],
  Dehradun: [30.32, 78.03],
  Delhi: [28.61, 77.21],
  Dhanbad: [23.8, 86.43],
  Dispur: [26.14, 91.79],
  Faridabad: [28.41, 77.32],
  Ghaziabad: [28.67, 77.45],
  Goa: [15.49, 73.83],
  Gorakhpur: [26.76, 83.37],
  Guwahati: [26.14, 91.74],
  Gwalior: [26.22, 78.18],
  Hyderabad: [17.39, 78.49],
  Imphal: [24.82, 93.94],
  Indore: [22.72, 75.86],
  Itanagar: [27.08, 93.61],
  Jabalpur: [23.18, 79.99],
  Jaipur: [26.91, 75.79],
  Jammu: [32.73, 74.86],
  Jamshedpur: [22.8, 86.2],
  Jodhpur: [26.24, 73.02],
  Kanpur: [26.45, 80.33],
  Kochi: [9.93, 76.27],
  Kohima: [25.67, 94.11],
  Kolkata: [22.57, 88.36],
  Kota: [25.21, 75.86],
  Kozhikode: [11.26, 75.78],
  Lucknow: [26.85, 80.95],
  Ludhiana: [30.9, 75.86],
  Madurai: [9.93, 78.12],
  Meerut: [28.98, 77.71],
  Mumbai: [19.08, 72.88],
  Mysuru: [12.3, 76.64],
  Nagpur: [21.15, 79.09],
  Nashik: [19.99, 73.79],
  Noida: [28.54, 77.39],
  Panaji: [15.49, 73.83],
  Patna: [25.61, 85.14],
  Puducherry: [11.94, 79.81],
  Pune: [18.52, 73.86],
  Raipur: [21.25, 81.63],
  Rajkot: [22.3, 70.8],
  Ranchi: [23.34, 85.31],
  Shillong: [25.58, 91.89],
  Shimla: [31.1, 77.17],
  Siliguri: [26.73, 88.4],
  Srinagar: [34.08, 74.8],
  Surat: [21.17, 72.83],
  Thiruvananthapuram: [8.52, 76.94],
  Udaipur: [24.59, 73.71],
  Vadodara: [22.31, 73.18],
  Varanasi: [25.32, 82.97],
  Vijayawada: [16.51, 80.64],
  Visakhapatnam: [17.69, 83.22],
};

const LOCATIONS = Object.entries(CITY_COORDS).map(([name, [lat, lon]]) => [name, lon, lat]);

const OUTLINE = [
  [74.5, 37],
  [77.8, 35.5],
  [79, 32.5],
  [81, 30],
  [88, 27.8],
  [88.5, 26.5],
  [92, 27.8],
  [97, 28],
  [96, 26],
  [93, 23.5],
  [89, 22],
  [86.9, 21.2],
  [85, 19.5],
  [82, 16.5],
  [80.3, 15],
  [80.2, 13],
  [79.8, 10.3],
  [77.5, 8.1],
  [76.2, 9.8],
  [75, 12.5],
  [73.8, 15.5],
  [72.8, 19],
  [72.6, 21],
  [70, 20.9],
  [69, 22.3],
  [70.5, 23.2],
  [68.2, 23.7],
  [71, 25],
  [70, 27],
  [72, 29],
  [74.5, 31],
  [74.5, 34],
];

const LEFT_LABELS = new Set(['Mumbai', 'Jaipur', 'Bengaluru', 'Bhopal']);

const ENV = Object.fromEntries(
  LOCATIONS.map(([name], index) => [
    name,
    [Number((((index * 7) % 9) / 4 - 0.6).toFixed(1)), ((index * 13) % 50) - 20],
  ]),
);
ENV.Jaipur = [3.8, -30];
ENV.Guwahati = [1.2, 64];

const CORRIDORS = [
  ['Jaipur', 'Delhi', 1800],
  ['Jaipur', 'Lucknow', 900],
  ['Jaipur', 'Bhopal', 700],
  ['Guwahati', 'Kolkata', 1500],
  ['Guwahati', 'Patna', 800],
  ['Mumbai', 'Pune', 1400],
  ['Bhopal', 'Mumbai', 1100],
  ['Hyderabad', 'Bengaluru', 1300],
  ['Chennai', 'Bengaluru', 900],
  ['Lucknow', 'Delhi', 1200],
  ['Patna', 'Kolkata', 1000],
];

const randFactory = () => {
  let seed = 11;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
};

const pick = (items, rnd) => items[Math.floor(rnd() * items.length)];
const cleanOptional = (value) => String(value ?? '').trim();
const normEnum = (value, allowed, fallback) => {
  const key = norm(value);
  if (allowed.includes(key)) return key;
  if (/full|yes|done|complete/.test(key) && allowed.includes('vaccinated')) return 'vaccinated';
  if (/part/.test(key) && allowed.includes('partial')) return 'partial';
  if (/no|not|none|unvaccinated/.test(key) && allowed.includes('unvaccinated')) return 'unvaccinated';
  if (/lab|confirm|positive/.test(key) && allowed.includes('lab_confirmed')) return 'lab_confirmed';
  if (/suspect|probable/.test(key) && allowed.includes('suspected')) return 'suspected';
  return fallback;
};

function animalDetails(seed = '') {
  let hash = 0;
  const text = seed || 'animal';
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  const optionIndex = hash % SPECIES_OPTIONS.length;
  return {
    species: SPECIES_OPTIONS[optionIndex],
    symptoms: ['fever', 'reduced milk', 'lameness', 'respiratory signs'][optionIndex % 4],
    mortality: optionIndex % 3 === 0 ? 1 : 0,
    vaccinationStatus: optionIndex % 2 === 0 ? 'partial' : 'unvaccinated',
    confirmationStatus: optionIndex % 5 === 0 ? 'lab_confirmed' : 'suspected',
    farmId: `FARM-${100 + optionIndex}`,
    block: ['Amber', 'Sanganer', 'Dispur', 'Barabanki', 'Howrah'][optionIndex % 5],
  };
}

function reportMeta(row) {
  const parts = [];
  if (row.species) parts.push(row.species);
  if (row.mortality) parts.push(`${row.mortality} deaths`);
  if (row.vaccinationStatus && row.vaccinationStatus !== 'unknown') parts.push(VACCINATION_OPTIONS[row.vaccinationStatus] || row.vaccinationStatus);
  if (row.confirmationStatus === 'lab_confirmed') parts.push('Lab confirmed');
  if (row.block) parts.push(row.block);
  return parts.join(' | ');
}

function assessUiQuality(row) {
  const flags = [];
  if (!Number.isFinite(Number(row.lat)) || !Number.isFinite(Number(row.lon))) flags.push('missing_coordinates');
  if (!row.sourceType) flags.push('missing_source');
  if (row.day > 21) flags.push('stale_report');
  if (row.sec === 'animal') {
    if (!row.species) flags.push('missing_species');
    if (!row.vaccinationStatus || row.vaccinationStatus === 'unknown') flags.push('unknown_vaccination');
    if (row.confirmationStatus !== 'lab_confirmed') flags.push('lab_pending');
    if (!row.farmId) flags.push('missing_farm_or_holding');
    if (!row.block) flags.push('missing_block_or_village');
    if (Number(row.mortality || 0) > Number(row.n || 0)) flags.push('mortality_exceeds_cases');
  }
  const penalty = flags.length * 8 + (flags.includes('mortality_exceeds_cases') ? 10 : 0);
  const sourceBonus = row.sourceType === 'manual' ? 4 : row.sourceType === 'csv' || row.sourceType === 'csv_browser' ? 0 : -4;
  return { dataQualityScore: Math.max(0, Math.min(100, 88 - penalty + sourceBonus)), qualityFlags: flags };
}

function decorateUiReport(row, provenance = {}) {
  const next = {
    ...row,
    sourceType: provenance.sourceType || row.sourceType || 'demo',
    sourceName: provenance.sourceName || row.sourceName || 'Demo dataset',
    sourceUploadedBy: provenance.sourceUploadedBy || row.sourceUploadedBy,
  };
  const assessed = assessUiQuality(next);
  return {
    ...next,
    dataQualityScore: Number.isFinite(Number(row.dataQualityScore)) ? Number(row.dataQualityScore) : assessed.dataQualityScore,
    qualityFlags: Array.isArray(row.qualityFlags) ? row.qualityFlags : assessed.qualityFlags,
  };
}

function QualityBadge({ score }) {
  const value = Math.round(Number(score || 0));
  const color = value >= 85 ? 'text-env border-env' : value >= 70 ? 'text-animal border-animal' : 'text-alert border-alert';
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${color}`}>{value}/100</span>;
}

function sourceLabel(row) {
  const type = row.sourceType || 'unknown';
  return `${SOURCE_LABELS[type] || type}${row.sourceName ? `: ${row.sourceName}` : ''}`;
}

function createDemoReports() {
  const rnd = randFactory();
  const reports = [];
  let id = 1;
  const add = (day, loc, sec, dis, n, meta = {}) =>
    reports.push(decorateUiReport({
      id: id++,
      day,
      loc,
      sec,
      dis,
      n,
      ...(sec === 'animal' ? animalDetails(`${loc}-${dis}-${day}`) : {}),
      ...meta,
    }, { sourceType: 'demo', sourceName: 'Built-in demo dataset' }));

  for (let day = 29; day >= 0; day -= 1) {
    for (let k = 0; k < 5; k += 1) {
      const sec = pick(['human', 'human', 'animal', 'animal', 'environment'], rnd);
      add(day, pick(LOCATIONS, rnd)[0], sec, pick(DISEASES[sec], rnd), 1 + Math.floor(rnd() * 3));
    }
  }

  for (let day = 5; day >= 0; day -= 1) {
    add(day, 'Jaipur', 'animal', 'Brucellosis', 3, {
      species: 'Cattle',
      symptoms: 'abortion, fever, reduced milk',
      mortality: day % 3 === 0 ? 1 : 0,
      vaccinationStatus: 'unvaccinated',
      confirmationStatus: day <= 2 ? 'lab_confirmed' : 'suspected',
      farmId: 'JPR-DAIRY-14',
      block: 'Amber',
    });
    add(day, 'Jaipur', 'human', 'Brucellosis', 2);
  }

  for (let day = 3; day >= 0; day -= 1) {
    add(day, 'Guwahati', 'animal', 'Avian influenza', 3, {
      species: 'Poultry',
      symptoms: 'sudden deaths, respiratory signs',
      mortality: 2,
      vaccinationStatus: 'unknown',
      confirmationStatus: day <= 1 ? 'lab_confirmed' : 'suspected',
      farmId: 'GHY-POULTRY-08',
      block: 'Dispur',
    });
  }

  return reports;
}

const DEMO_REPORTS = createDemoReports();
const total = (rows) => rows.reduce((sum, row) => sum + row.n, 0);
const sign = (value) => `${value > 0 ? '+' : ''}${value}`;
const dateLabel = (day) =>
  new Date(Date.now() - day * 864e5).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });

const reportDate = recordDate;
const latestReportDate = (rows) => rows.map(reportDate).filter(Boolean).sort((a, b) => b - a)[0] || null;
const earliestReportDate = (rows) => rows.map(reportDate).filter(Boolean).sort((a, b) => a - b)[0] || null;
const periodText = (rows, end, days) => {
  const latest = end || latestReportDate(rows);
  if (!latest) return 'Selected reporting period';
  const start = days === 'all' ? earliestReportDate(rows) : new Date(latest.getTime() - (Number(days) - 1) * 864e5);
  const format = (date) => date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  return days === 'all' ? `Dataset period: ${format(start)} – ${format(latest)}` : `Reporting period: ${format(start)} – ${format(latest)}`;
};
const periodizeReports = (rows, end, days) => {
  const latest = end || latestReportDate(rows) || new Date();
  return filterReportsByPeriod(rows, latest, days);
};
const formatReportDate = (row) => reportDate(row)?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) || dateLabel(row.day);

const norm = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const hashText = (value) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash;
};

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      if (row.some((item) => item.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((item) => item.trim())) rows.push(row);
  return rows;
}

const findColumn = (headers, names) => {
  const exact = headers.findIndex((header) => header && names.includes(header));
  return exact >= 0 ? exact : headers.findIndex((header) => header && names.some((name) => header.includes(name) || name.includes(header)));
};

const findColumns = (headers, names) =>
  headers
    .map((header, index) => (header && names.some((name) => header === name || header.includes(name) || name.includes(header)) ? index : -1))
    .filter((index) => index >= 0);

const readCell = (row, index) => (index >= 0 ? String(row[index] ?? '').trim() : '');
const cityKey = (value) => norm(value).replace(/_/g, '');
const cityLookup = Object.fromEntries(Object.keys(CITY_COORDS).map((city) => [cityKey(city), city]));
const getKnownCity = (value) => cityLookup[cityKey(value)] ?? null;
const getKnownCoords = (value) => {
  const city = getKnownCity(value);
  return city ? CITY_COORDS[city] : null;
};
const toCoordNumber = (value) => {
  const number = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? number : null;
};

function detectLocationName(row, indexes) {
  const cells = [...indexes.map((index) => readCell(row, index)), ...row.map((cell) => String(cell ?? ''))].filter(Boolean);
  const known = cells.map(getKnownCity).find(Boolean);
  if (known) return known;
  return indexes.map((index) => readCell(row, index)).find(Boolean) || null;
}

function detectLocation(row, indexes) {
  const location = detectLocationName(row, indexes);
  if (location) return location;
  const joined = row.join('|');
  return LOCATIONS[hashText(joined) % LOCATIONS.length][0];
}

function getReportCoords(report) {
  if (Number.isFinite(report.lat) && Number.isFinite(report.lon)) return [report.lat, report.lon];
  return getKnownCoords(report.loc);
}

const getReportLocations = (reports) => [...new Set(reports.map((row) => row.loc).filter(Boolean))].sort((a, b) => a.localeCompare(b));

function detectSector(row, sectorIndex, diseaseText, sourceDataset = '') {
  const explicit = norm(readCell(row, sectorIndex));
  if (explicit.includes('animal') || explicit.includes('livestock') || explicit.includes('veterinary')) return 'animal';
  if (explicit.includes('environment') || explicit.includes('weather') || explicit.includes('water') || explicit.includes('climate')) return 'environment';
  if (explicit.includes('human') || explicit.includes('patient') || explicit.includes('hospital')) return 'human';

  const joined = norm(diseaseText);
  if (/animal|livestock|cattle|cow|goat|poultry|chicken|avian|veterinary|farm/.test(joined)) return 'animal';
  if (/rain|rainfall|water|temperature|weather|climate|heat|air|pollution|pm2|environment/.test(joined)) return 'environment';
  if (/human|patient|hospital|clinic|people|person|clinical/.test(joined)) return 'human';
  if (/epiclim|disease.?climate|epidemic|health.?dataset/.test(norm(sourceDataset))) return 'human';
  return 'unknown';
}

function parseCases(value) {
  const raw = String(value ?? '').trim();
  const number = Number(raw.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.min(1000000000, Math.round(number));
}

function parseOptionalCount(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const number = Number(raw.replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(number) || number < 0) return undefined;
  return Math.max(0, Math.min(500, Math.round(number)));
}

function parseMeasurement(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const number = Number(raw.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? number : undefined;
}

function parseDateValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^\d{4}$/.test(raw)) return new Date(Number(raw), 0, 1);
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(raw)) {
    const [first, second, third] = raw.split(/[/-]/).map(Number);
    const year = third < 100 ? 2000 + third : third;
    if (first > 12) return new Date(year, second - 1, first);
    if (second > 12) return new Date(year, first - 1, second);
  }
  if (/^\d{5}$/.test(raw)) {
    const excelDate = new Date(Math.round((Number(raw) - 25569) * 864e5));
    if (!Number.isNaN(excelDate.getTime())) return excelDate;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

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
  mortality: ['mortality', 'deaths', 'dead', 'fatalities', 'animal_deaths'],
  vaccinationStatus: ['vaccination_status', 'vaccinated', 'vaccine_status', 'immunization_status'],
  confirmationStatus: ['confirmation_status', 'lab_status', 'test_status', 'confirmed_status', 'case_status'],
  farmId: ['farm_id', 'farm', 'premise_id', 'holding_id', 'owner_id'],
  block: ['block', 'tehsil', 'taluka', 'village', 'panchayat'],
  temperature: ['temperature_celsius_derived', 'temperature_celsius', 'temperature', 'temp'],
  precipitation: ['precipitation_mm_source', 'precipitation_mm', 'precipitation', 'rainfall'],
  sourceDataset: ['source_dataset'],
  sourceUrl: ['source_url', 'url'],
  synthetic: ['is_synthetic', 'synthetic'],
  alertLabel: ['alert_label', 'alert', 'warning_label'],
};

function validateCsvHeaders({ locationColumns, diseaseIndex, sectorIndex, caseIndex, latIndex, lonIndex }) {
  const missing = [];
  if (!locationColumns.length && (latIndex < 0 || lonIndex < 0)) missing.push('location/city/district/state or latitude/longitude');
  if (caseIndex < 0) missing.push('cases/count/value');
  if (diseaseIndex < 0 && sectorIndex < 0) missing.push('disease/condition/signal/sector');

  if (!missing.length) return null;
  return `Invalid CSV. Missing required header: ${missing.join(', ')}`;
}

function parseUploadedCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return { reports: [], skipped: 0, error: 'Invalid CSV. Add a header row and at least one data row.' };

  const headers = rows[0].map(norm);
  const body = rows.slice(1);
  const locationColumns = findColumns(headers, CSV_HEADERS.location);
  const locationIndex = findColumn(headers, ['location']);
  const cityIndex = findColumn(headers, ['city']);
  const stateIndex = findColumn(headers, ['state']);
  const districtIndex = findColumn(headers, ['district']);
  const diseaseIndex = findColumn(headers, CSV_HEADERS.signal);
  const sectorIndex = findColumn(headers, CSV_HEADERS.sector);
  const caseIndex = findColumn(headers, CSV_HEADERS.cases);
  const dateIndex = findColumn(headers, CSV_HEADERS.date);
  const yearIndex = findColumn(headers, CSV_HEADERS.year);
  const weekNumberIndex = findColumn(headers, CSV_HEADERS.weekNumber);
  const latIndex = findColumn(headers, CSV_HEADERS.lat);
  const lonIndex = findColumn(headers, CSV_HEADERS.lon);
  const speciesIndex = findColumn(headers, CSV_HEADERS.species);
  const symptomsIndex = findColumn(headers, CSV_HEADERS.symptoms);
  const mortalityIndex = findColumn(headers, CSV_HEADERS.mortality);
  const vaccinationIndex = findColumn(headers, CSV_HEADERS.vaccinationStatus);
  const confirmationIndex = findColumn(headers, CSV_HEADERS.confirmationStatus);
  const farmIndex = findColumn(headers, CSV_HEADERS.farmId);
  const blockIndex = findColumn(headers, CSV_HEADERS.block);
  const temperatureIndex = findColumn(headers, CSV_HEADERS.temperature);
  const precipitationIndex = findColumn(headers, CSV_HEADERS.precipitation);
  const sourceDatasetIndex = findColumn(headers, CSV_HEADERS.sourceDataset);
  const sourceUrlIndex = findColumn(headers, CSV_HEADERS.sourceUrl);
  const syntheticIndex = findColumn(headers, CSV_HEADERS.synthetic);
  const alertLabelIndex = findColumn(headers, CSV_HEADERS.alertLabel);
  const headerError = validateCsvHeaders({ locationColumns, diseaseIndex, sectorIndex, caseIndex, latIndex, lonIndex });
  if (headerError) return { reports: [], skipped: body.length, error: headerError };

  const datedRows = body.map((row) => ({ row, date: parseDateValue(readCell(row, dateIndex)) || parseDateValue(readCell(row, yearIndex)) }));
  const maxDate =
    datedRows
      .map((item) => item.date)
      .filter(Boolean)
      .sort((a, b) => b - a)[0] ?? null;

  const reports = [];
  let skipped = 0;

  datedRows.forEach(({ row, date }, index) => {
    if (!row.some((cell) => String(cell ?? '').trim())) {
      skipped += 1;
      return;
    }

    const lat = toCoordNumber(readCell(row, latIndex));
    const lon = toCoordNumber(readCell(row, lonIndex));
    const location = readCell(row, locationIndex) || readCell(row, cityIndex) || readCell(row, districtIndex) || readCell(row, stateIndex) || (lat !== null && lon !== null ? `Point ${index + 1}` : null);
    const knownCoords = getKnownCoords(location);
    const coords = lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 ? [lat, lon] : knownCoords;
    if (!location || !coords) {
      skipped += 1;
      return;
    }
    const disease = readCell(row, diseaseIndex) || 'Imported CSV signal';
    const sourceDataset = readCell(row, sourceDatasetIndex);
    const sector = detectSector(row, sectorIndex, disease, sourceDataset);
    const cases = parseCases(readCell(row, caseIndex));
    const mortality = parseOptionalCount(readCell(row, mortalityIndex));
    const latestDay = maxDate ? new Date(maxDate).setHours(0, 0, 0, 0) : null;
    const rowDay = date ? new Date(date).setHours(0, 0, 0, 0) : null;
    const day = rowDay && latestDay ? Math.max(0, Math.round((latestDay - rowDay) / 864e5)) : index % 30;

    const temperature = parseMeasurement(readCell(row, temperatureIndex));
    const precipitation = parseMeasurement(readCell(row, precipitationIndex));
    const hasClimateObservation = sector === 'environment' && (Number.isFinite(temperature) || Number.isFinite(precipitation));
    if (cases === null || (cases === 0 && !hasClimateObservation) || !date) { skipped += 1; return; }
    reports.push(decorateUiReport({
      id: index + 1,
      day,
      loc: location,
      lat: coords[0],
      lon: coords[1],
      sec: sector,
      dis: disease.slice(0, 60),
      n: cases,
      date: date.toISOString(),
      state: cleanOptional(readCell(row, stateIndex)) || undefined,
      district: cleanOptional(readCell(row, districtIndex)) || undefined,
      weekNumber: cleanOptional(readCell(row, weekNumberIndex)) || undefined,
      species: cleanOptional(readCell(row, speciesIndex)) || undefined,
      symptoms: cleanOptional(readCell(row, symptomsIndex)) || undefined,
      mortality,
      deaths: mortality,
      temperatureCelsius: temperature,
      precipitationMm: precipitation,
      sourceDataset: cleanOptional(sourceDataset) || undefined,
      sourceUrl: cleanOptional(readCell(row, sourceUrlIndex)) || undefined,
      isSynthetic: /^(true|1|yes)$/i.test(readCell(row, syntheticIndex)),
      alertLabel: cleanOptional(readCell(row, alertLabelIndex), 80) || undefined,
      vaccinationStatus: normEnum(readCell(row, vaccinationIndex), Object.keys(VACCINATION_OPTIONS), 'unknown'),
      confirmationStatus: normEnum(readCell(row, confirmationIndex), Object.keys(CONFIRMATION_OPTIONS), 'suspected'),
      farmId: cleanOptional(readCell(row, farmIndex)) || undefined,
      block: cleanOptional(readCell(row, blockIndex)) || undefined,
    }, { sourceType: 'csv_browser', sourceName: 'Browser CSV upload' }));
  });

  if (!reports.length) {
    return {
      reports,
      skipped,
      error: 'No mappable rows found. Add latitude/longitude columns, or use recognizable city names like Delhi, Jaipur, Mumbai, Pune, Chennai or Bengaluru.',
    };
  }

  return { reports, skipped };
}

function computeAlerts(reports, envByCity = ENV) {
  return computeSharedAlerts(reports, { env: envByCity, corridors: CORRIDORS });
}

const mapX = (lon) => (lon - 67) * 14;
const mapY = (lat) => (38 - lat) * 14;
const locationPoint = (name) => {
  const item = LOCATIONS.find(([loc]) => loc === name);
  return [mapX(item[1]), mapY(item[2])];
};

function Button({ children, variant = 'solid', className = '', ...props }) {
  const base =
    'inline-flex cursor-pointer items-center justify-center rounded-full px-[18px] py-2.5 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-env focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-55';
  const styles =
    variant === 'ghost'
      ? 'border border-ink bg-transparent text-ink hover:bg-ink/5'
      : 'bg-ink text-bg hover:opacity-90';

  return (
    <button className={`${base} ${styles} ${className}`} {...props}>
      {children}
    </button>
  );
}

function CsvUploadButton({ onUpload }) {
  return (
    <label className="inline-flex cursor-pointer items-center justify-center rounded-full border border-ink bg-transparent px-[18px] py-2.5 text-sm font-semibold text-ink outline-none transition hover:bg-ink/5 focus-within:ring-2 focus-within:ring-env focus-within:ring-offset-2 focus-within:ring-offset-bg">
      Upload CSV Dataset
      <input className="sr-only" type="file" accept=".csv,text/csv" onChange={onUpload} />
    </label>
  );
}

function DatasetSelector({ datasets, activeDatasetId, onChange, canFilterIndividual }) {
  if (!datasets.length) return null;
  const active = datasets.find((dataset) => dataset.datasetId === activeDatasetId);
  return (
    <label className="grid min-w-[250px] gap-1 text-xs text-mute">
      Active dataset
      <select className="rounded border border-line bg-card px-2.5 py-2 text-sm text-ink" value={activeDatasetId || ''} onChange={(event) => onChange(event.target.value)}>
        <option value="all">All ready datasets (shared)</option>
        {canFilterIndividual ? datasets.map((dataset) => (
          <option key={dataset.datasetId} value={dataset.datasetId} disabled={dataset.status === 'failed'}>
            {dataset.fileName} · {(dataset.importedRows ?? dataset.rowCount ?? 0).toLocaleString('en-IN')} rows
          </option>
        )) : null}
      </select>
      {active ? <span>{active.dateMin ? `${new Date(active.dateMin).toLocaleDateString('en-IN')} – ${new Date(active.dateMax).toLocaleDateString('en-IN')}` : 'Date range unavailable'} · {active.status}</span> : null}
    </label>
  );
}

function LoginPage({ onLogin, onSignup, error, loading }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitInFlight = useRef(false);
  const [notice, setNotice] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setNotice('');
    setBusy(true);
    try {
      const ok = mode === 'login' ? await onLogin(form.username, form.password) : await onSignup(form.username, form.password);
      if (ok && mode === 'signup') {
        setMode('login');
        setForm((current) => ({ ...current, password: '' }));
        setNotice('Account created. You can now sign in.');
      }
    } finally {
      setBusy(false);
      submitInFlight.current = false;
    }
  };

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span> OneHealth</div>
        <div className="eyebrow">HEALTH INTELLIGENCE PLATFORM</div>
        <h1 id="login-title">{mode === 'login' ? 'Sign in to your workspace' : 'Create your workspace account'}</h1>
        <p className="login-description">{mode === 'login' ? 'Monitor outbreaks, climate signals, and response activity in one secure view.' : 'Create a secure viewer account to access the OneHealth monitoring workspace.'}</p>
        <form className="login-form" onSubmit={submit}>
          <label>
            Username or email
            <input autoComplete="username" value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} required />
          </label>
          <label>
            Password
            <span className="password-field">
              <input autoComplete="current-password" type={showPassword ? 'text' : 'password'} value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} required />
              <button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </span>
          </label>
          {mode === 'signup' ? <p className="login-hint">New accounts start with Viewer access. An administrator can update roles later.</p> : null}
          {notice ? <p className="login-success" role="status">{notice}</p> : null}
          {error ? <p className="login-error" role="alert">{error}</p> : null}
          <button className="login-submit" type="submit" disabled={loading || busy || !form.username || !form.password}>
            {loading || busy ? (mode === 'login' ? 'Signing in…' : 'Creating account…') : mode === 'login' ? 'Login' : 'Create account'}
          </button>
        </form>
        <p className="login-footer">
          {mode === 'login' ? 'Need an account?' : 'Already have an account?'}{' '}
          <button type="button" className="login-link" onClick={() => { setMode((current) => current === 'login' ? 'signup' : 'login'); setNotice(''); }}>
            {mode === 'login' ? 'Sign up' : 'Back to login'}
          </button>
        </p>
      </section>
    </main>
  );
}

function Tag({ sector }) {
  return (
    <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold text-white" style={{ background: COLORS[sector] }}>
      {SECTORS[sector]}
    </span>
  );
}

function Header({ page, setPage, alertCount, live, empty, uploadInfo, auth, onLogin, onLogout }) {
  const [loginOpen, setLoginOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [busy, setBusy] = useState(false);
  const liveText = uploadInfo
    ? (uploadInfo.saved ? 'Database dataset' : 'Browser-only dataset')
    : live ? (empty ? 'Database empty' : 'Connected to database') : 'No dataset loaded';
  const items = [
    ['dashboard', 'Dashboard'],
    ['reports', 'Reports'],
    ['alerts', 'Alerts'],
    ['pipeline', 'Data pipeline'],
    ...(can(auth, 'users:manage') ? [['admin', 'Admin']] : []),
  ];
  const navGroups = [
    { label: 'Workspace', items: items.slice(0, 3) },
    { label: 'Operations', items: items.slice(3) },
  ].filter((group) => group.items.length);
  const submitLogin = async (event) => {
    event.preventDefault();
    setBusy(true);
    const ok = await onLogin(loginForm.username, loginForm.password);
    setBusy(false);
    if (ok) setLoginOpen(false);
  };

  return (
    <header className="app-header">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
        <span>OneHealth</span>
        <span className="brand-caption">Intelligence</span>
      </div>
      <button className="mobile-nav-toggle" type="button" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen((open) => !open)}>
        <span className="sr-only">Toggle navigation</span>☰
      </button>
      <nav className={`app-nav ${mobileNavOpen ? 'is-open' : ''}`} aria-label="Primary navigation">
        {navGroups.map((group) => (
          <div className="nav-group" key={group.label}>
            <span className="nav-group-label">{group.label}</span>
            {group.items.map(([key, label]) => (
              <button key={key} className={`app-nav-item ${page === key ? 'is-active' : ''}`} aria-current={page === key ? 'page' : undefined} onClick={() => { setPage(key); setMobileNavOpen(false); }}>
                <span className="nav-icon" aria-hidden="true">{key === 'dashboard' ? '⌂' : key === 'reports' ? '▤' : key === 'alerts' ? '!' : key === 'pipeline' ? '⌁' : '⚙'}</span>
                {label}
                {key === 'alerts' && alertCount > 0 ? <span className="nav-count">{alertCount}</span> : null}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="connection-status">
        <span className="live-dot" />
        <span>{liveText}</span>
      </div>

      <div className="account-area">
        {auth ? (
          <>
            <span className="rounded-full border border-line px-3 py-1 text-xs font-semibold uppercase text-mute">
              {auth.user.role}
            </span>
            <Button variant="ghost" className="px-3 py-1.5" onClick={onLogout}>
              Sign out
            </Button>
          </>
        ) : loginOpen ? (
          <>
            <Button variant="ghost" className="px-3 py-1.5" onClick={() => setLoginOpen(false)}>
              Close
            </Button>
            <form
              className="absolute right-0 top-[calc(100%+0.75rem)] z-[1200] grid w-[min(22rem,calc(100vw-2rem))] gap-3 rounded-tool border border-line bg-card p-4 shadow-soft"
              onSubmit={submitLogin}
            >
              <Label text="Username">
                <Input
                  autoComplete="username"
                  placeholder="analyst"
                  value={loginForm.username}
                  onChange={(event) => setLoginForm((current) => ({ ...current, username: event.target.value }))}
                />
              </Label>
              <Label text="Password">
                <Input
                  autoComplete="current-password"
                  placeholder="analyst123"
                  type="password"
                  value={loginForm.password}
                  onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                />
              </Label>
              <Button className="w-full" disabled={busy || !loginForm.username || !loginForm.password}>
                Login
              </Button>
            </form>
          </>
        ) : (
          <Button variant="ghost" className="px-3 py-1.5" onClick={() => setLoginOpen(true)}>
            Login
          </Button>
        )}
      </div>
    </header>
  );
}

function Top({ title, children, action }) {
  return (
    <div className="page-header">
      <div>
        <div className="eyebrow">ONEHEALTH MONITORING</div>
        <h1 className="page-title">
          {title}
        </h1>
        {children ? <p className="page-description">{children}</p> : null}
      </div>
      {action ? <div className="page-actions">{action}</div> : null}
    </div>
  );
}

function validationClass(status) {
  if (['acknowledged', 'resolved', 'validated'].includes(status)) return 'border-env text-env';
  if (['investigating', 'review'].includes(status)) return 'border-animal text-animal';
  return 'border-alert text-alert';
}

function AlertItem({ alert, compact = false, auth, onValidate, onRespond, envByCity = ENV }) {
  const validation = alert.manualValidation || alert.validation;
  return (
    <div className="flex items-start gap-4 border-t border-line py-4">
      <div className={`w-[76px] shrink-0 font-display text-[34px] font-extrabold leading-none ${alert.severity === 'high' ? 'text-alert' : 'text-animal'}`}>
        {alert.risk}
      </div>
      <div>
        <b className="block text-base">{alert.disease} rising in {alert.loc}</b>
        <small className="text-[13.5px] text-mute">
          {alert.recent} reports in 7 days, usual is about {alert.base}. That is {alert.ratio.toFixed(1)}x normal.{' '}
          Confidence {alert.confidence}%. {alert.severity === 'high' ? 'Investigate now.' : 'Keep watching.'}
        </small>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {validation ? (
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${validationClass(validation.status)}`}>
              {validation.label || validation.status}
            </span>
          ) : null}
          {alert.drivers.map((driver) => (
            <span key={driver} className="rounded-full border border-line px-2 py-0.5 text-xs text-mute">
              {driver}
            </span>
          ))}
        </div>
        {!compact ? (
          <>
            <ValidationPanel alert={alert} auth={auth} onValidate={onValidate} onRespond={onRespond} />
            <ActionList alert={alert} envByCity={envByCity} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function ValidationPanel({ alert, auth, onValidate, onRespond }) {
  const validation = alert.validation;
  const manual = alert.manualValidation;
  const responseStatus = manual?.responseStatus || 'new';

  return (
    <div className="mt-3 rounded-tool border border-line bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <b className="font-display">Validation score {validation.score}/100</b>
          <div className="text-[13px] text-mute">
            {validation.method} via {validation.modelVersion}. {validation.nextStep}.
          </div>
        </div>
        {manual ? (
          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${validationClass(manual.status)}`}>
            {manual.status} by {manual.by} | {RESPONSE_STATUSES[responseStatus] || responseStatus}
          </span>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {validation.checks.map((check) => (
          <div key={check.label} className="rounded-[8px] border border-line p-2 text-[13px]">
            <b className={check.passed ? 'text-env' : 'text-mute'}>{check.passed ? 'Pass' : 'Review'}: {check.label}</b>
            <div className="text-mute">{check.detail}</div>
          </div>
        ))}
      </div>
      {can(auth, 'alerts:validate') ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {['new', 'acknowledged', 'investigating', 'resolved', 'dismissed'].map((status) => (
              <Button key={status} variant={status === 'acknowledged' ? 'solid' : 'ghost'} className="px-3 py-1.5" onClick={() => onValidate(alert.loc, status)}>
                Mark {status}
              </Button>
            ))}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
            <Select value={responseStatus} aria-label="Field response status" onChange={(event) => onRespond(alert.loc, event.target.value)}>
              {Object.entries(RESPONSE_STATUSES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Button variant="ghost" className="px-3 py-1.5" onClick={() => onRespond(alert.loc, responseStatus)}>
              Update response
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ActionList({ alert, envByCity = ENV }) {
  const env = envByCity[alert.loc] ?? [0, 0];
  const actions = [
    `Send a vet team to ${alert.loc} to test animals for ${alert.disease}`,
    alert.corridors.length
      ? `Check animals leaving on the routes to ${alert.corridors.map((route) => route[1]).join(', ')} (${alert.load.toLocaleString('en-IN')} a week)`
      : null,
    `Tell nearby clinics to watch for ${alert.disease} in people`,
    alert.envOdd ? `Share the weather anomaly (${env[0]} deg C, rain ${env[1]}%) with health teams` : null,
  ].filter(Boolean);

  return (
    <ul className="mt-2 list-disc pl-5 text-[13.5px] text-ink">
      {actions.map((item) => (
        <li key={item} className="my-1">
          {item}
        </li>
      ))}
    </ul>
  );
}

function LeafletDiseaseMap({ reports, alerts, layers, mapFilters, selectedLocation, setSelectedLocation }) {
  const nodeRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const alertByCity = useMemo(() => Object.fromEntries(alerts.map((alert) => [alert.loc, alert])), [alerts]);
  const points = useMemo(
    () =>
      getReportLocations(reports)
        .map((loc) => {
          const locationRows = reports.filter((row) => row.loc === loc && (!mapFilters.disease || mapFilters.disease === 'all' || row.dis === mapFilters.disease) && (!mapFilters.location || mapFilters.location === 'all' || row.loc === mapFilters.location));
          const sample = locationRows.find((row) => getReportCoords(row));
          const coords = sample ? getReportCoords(sample) : getKnownCoords(loc);
          if (!coords) return null;
          const alert = alertByCity[loc];
          const count = locationRows.filter((row) => mapFilters.sector === 'all' || row.sec === mapFilters.sector).length;
          if (count < mapFilters.minCases) return null;
          if (mapFilters.severity === 'alerts' && !alert) return null;
          if (mapFilters.severity === 'high' && alert?.severity !== 'high') return null;
          return { loc, coords, count, alert };
        })
        .filter(Boolean),
    [reports, alertByCity, mapFilters],
  );

  useEffect(() => {
    if (!nodeRef.current || mapRef.current) return;
    const map = L.map(nodeRef.current, {
      center: [22.9, 79.6],
      zoom: 5,
      minZoom: 4,
      maxBounds: [
        [5, 66],
        [38, 100],
      ],
      maxBoundsViscosity: 0.6,
    });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 16,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(nodeRef.current);
    window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    if (layers.corridors) {
      CORRIDORS.forEach(([from, to, count]) => {
        const fromCoords = getKnownCoords(from);
        const toCoords = getKnownCoords(to);
        if (!fromCoords || !toCoords) return;
        const hot = Boolean(alertByCity[from]);
        L.polyline([fromCoords, toCoords], {
          color: hot ? '#ff5a52' : '#2f55d4',
          weight: 1.5 + count / 900,
          opacity: 0.7,
          dashArray: '6 7',
        })
          .bindTooltip(`${from} to ${to}: ${count.toLocaleString('en-IN')} animals a week`)
          .addTo(layer);
      });
    }

    const maxCount = Math.max(...points.map((point) => point.count), 1);

    points.forEach(({ loc, coords, count, alert }) => {
      const alerted = Boolean(alert);
      const color = alerted ? '#e5322d' : '#0a8f78';
      const radius = 6 + Math.min(count, 40) * 0.7;
      const intensity = Math.max(0.22, count / maxCount);

      if (layers.heat && count > 0) {
        [1.8, 1.15, 0.55].forEach((scale, index) => {
          L.circle(coords, {
            radius: (18000 + Math.min(count, 80) * 1800) * scale,
            color,
            fillColor: color,
            fillOpacity: (alerted ? 0.1 : 0.07) * intensity * (index + 1),
            opacity: 0,
          }).addTo(layer);
        });
      }

      L.circleMarker(coords, {
        radius,
        color: selectedLocation === loc ? '#08111c' : '#ffffff',
        weight: selectedLocation === loc ? 3 : 1.5,
        fillColor: color,
        fillOpacity: alerted ? 0.9 : 0.76,
      })
        .bindTooltip(`${loc}: ${count.toLocaleString('en-IN')} reports in selected period${alerted ? ', unusual rise' : ''}`)
        .on('click', () => setSelectedLocation(loc))
        .addTo(layer);
    });

    if (points.length) {
      const bounds = L.latLngBounds(points.map((point) => point.coords));
      map.fitBounds(bounds.pad(0.18), { maxZoom: 7, animate: false });
    }
  }, [alertByCity, layers, points, selectedLocation, setSelectedLocation]);

  return <div ref={nodeRef} className="onehealth-map flex-1 overflow-hidden rounded-[16px]" aria-label="Interactive disease report map" />;
}

function MapPanel({ reports, alerts, layers, setLayers, mapFilters, setMapFilters, selectedLocation, setSelectedLocation }) {
  const alertByCity = Object.fromEntries(alerts.map((alert) => [alert.loc, alert]));
  const latest = latestReportDate(reports) || new Date();
  const dateFilteredReports = reports.filter((row) => mapFilters.dateRange === 'all' || (recordDate(row) && (latest - recordDate(row)) / 864e5 < Number(mapFilters.dateRange)));
  const filteredReports = dateFilteredReports.filter((row) => (mapFilters.disease === 'all' || row.dis === mapFilters.disease) && (mapFilters.location === 'all' || row.loc === mapFilters.location));
  const weekForCity = (loc) => filteredReports.filter((row) => row.loc === loc && (mapFilters.sector === 'all' || row.sec === mapFilters.sector));
  const selectedWeek = selectedLocation ? weekForCity(selectedLocation) : [];
  const selectedAlert = selectedLocation ? alertByCity[selectedLocation] : null;
  const selectedSample = selectedLocation ? filteredReports.find((row) => row.loc === selectedLocation) : null;
  const selectedEnv = selectedLocation
    ? [selectedSample?.temperatureCelsius ?? ENV[selectedLocation]?.[0] ?? 0, selectedSample?.precipitationMm ?? ENV[selectedLocation]?.[1] ?? 0]
    : [0, 0];
  const mappedLocations = getReportLocations(filteredReports).filter((loc) => {
    const weeklyCount = total(weekForCity(loc));
    const alert = alertByCity[loc];
    if (!filteredReports.some((row) => row.loc === loc && getReportCoords(row))) return false;
    if (weeklyCount < mapFilters.minCases) return false;
    if (mapFilters.severity === 'alerts' && !alert) return false;
    if (mapFilters.severity === 'high' && alert?.severity !== 'high') return false;
    return true;
  });
  const updateMapFilter = (patch) => setMapFilters((current) => ({ ...current, ...patch }));

  return (
    <div className="map-shell flex min-h-full flex-col rounded-[24px] p-4 text-[#dbe6f2] sm:p-6">
      <h2 className="font-display text-[22px] font-bold text-white">Live disease map</h2>
      <div className="mb-2 text-sm text-[#8fa4bd]">Dark map with dynamic CSV locations. Bubble size follows the selected reporting period.</div>
      <div className="mb-2 flex flex-wrap gap-2">
        {[
          ['heat', 'Heatmap'],
          ['corridors', 'Livestock corridors'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`rounded-full border px-3 py-1 text-[13px] outline-none transition focus-visible:ring-2 focus-visible:ring-env ${
              layers[key] ? 'border-[#dbe6f2] bg-[#dbe6f2] text-[#08111c]' : 'border-[#2b4161] text-[#9fb2c8]'
            }`}
            aria-pressed={layers[key]}
            onClick={() => setLayers((current) => ({ ...current, [key]: !current[key] }))}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="map-filter-grid mb-3 grid gap-2 text-[13px] sm:grid-cols-3 lg:grid-cols-6">
        <label className="grid min-w-0 gap-1 text-[#9fb2c8]">
          Date range
          <select className="w-full min-w-0 truncate rounded-[10px] border border-[#2b4161] bg-[#0d1b2b] px-2.5 py-2 text-[#dbe6f2]" value={mapFilters.dateRange} onChange={(event) => updateMapFilter({ dateRange: event.target.value })}>
            <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All available dates</option>
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-[#9fb2c8]">
          Sector
          <select
            className="w-full min-w-0 truncate rounded-[10px] border border-[#2b4161] bg-[#0d1b2b] px-2.5 py-2 text-[#dbe6f2] outline-none focus-visible:ring-2 focus-visible:ring-env"
            value={mapFilters.sector}
            onChange={(event) => updateMapFilter({ sector: event.target.value })}
          >
            <option value="all">All sectors</option>
            {Object.entries(SECTORS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-[#9fb2c8]">
          Disease
          <select className="w-full min-w-0 truncate rounded-[10px] border border-[#2b4161] bg-[#0d1b2b] px-2.5 py-2 text-[#dbe6f2]" value={mapFilters.disease} onChange={(event) => updateMapFilter({ disease: event.target.value })}>
            <option value="all">All diseases/signals</option>
            {[...new Set(reports.map((row) => row.dis).filter(Boolean))].sort().map((disease) => <option key={disease} value={disease}>{disease}</option>)}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-[#9fb2c8]">
          Location
          <select className="w-full min-w-0 truncate rounded-[10px] border border-[#2b4161] bg-[#0d1b2b] px-2.5 py-2 text-[#dbe6f2]" value={mapFilters.location} onChange={(event) => updateMapFilter({ location: event.target.value })}>
            <option value="all">All locations</option>
            {getReportLocations(reports).map((location) => <option key={location} value={location}>{location}</option>)}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-[#9fb2c8]">
          Alert level
          <select
            className="w-full min-w-0 truncate rounded-[10px] border border-[#2b4161] bg-[#0d1b2b] px-2.5 py-2 text-[#dbe6f2] outline-none focus-visible:ring-2 focus-visible:ring-env"
            value={mapFilters.severity}
            onChange={(event) => updateMapFilter({ severity: event.target.value })}
          >
            <option value="all">All places</option>
            <option value="alerts">Alerts only</option>
            <option value="high">High risk</option>
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-[#9fb2c8]">
          Min weekly cases
          <input
            className="w-full min-w-0 truncate rounded-[10px] border border-[#2b4161] bg-[#0d1b2b] px-2.5 py-2 text-[#dbe6f2] outline-none focus-visible:ring-2 focus-visible:ring-env"
            min="0"
            type="number"
            value={mapFilters.minCases}
            onChange={(event) => updateMapFilter({ minCases: Math.max(0, Math.round(Number(event.target.value) || 0)) })}
          />
        </label>
      </div>

      <div className="grid flex-1 items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_190px]">
        <LeafletDiseaseMap
          reports={filteredReports}
          alerts={alerts}
          layers={layers}
          mapFilters={mapFilters}
          selectedLocation={selectedLocation}
          setSelectedLocation={setSelectedLocation}
        />
        <div className="border-l-2 border-[#2b4161] pl-3 text-[13px] text-[#b8c8da]">
            {selectedLocation ? (
            <>
              <b className="block font-display text-[22px] font-bold text-white">{selectedLocation}</b>
              {total(selectedWeek)} reports in the selected period
              <br />
              Human cases {total(selectedWeek.filter((row) => row.sec === 'human'))}
              <br />
              Animal reports {selectedWeek.filter((row) => row.sec === 'animal').length}
              <br />
              Climate observations {selectedWeek.filter((row) => Number.isFinite(Number(row.temperatureCelsius)) || Number.isFinite(Number(row.precipitationMm))).length}
              <br />
              Temp {sign(selectedEnv[0])} deg C, rain {sign(selectedEnv[1])}%
              {selectedAlert ? (
                <>
                  <br />
                  <span className="font-semibold text-alert">{selectedAlert.ratio.toFixed(1)}x usual level</span>
                  <br />
                  AI confidence {selectedAlert.confidence}%
                </>
              ) : null}
            </>
          ) : (
            <>
              <b className="block font-display text-[22px] font-bold text-white">Pick a city</b>
              Click a bubble to see reports by sector. {mappedLocations.length.toLocaleString('en-IN')} locations match the map filters.
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, note }) {
  return (
    <div className="mr-5 border-r border-line py-4 pr-5 last:border-0 md:min-h-[118px]">
      <span className="flex items-center gap-2 text-sm text-mute">
        <span className="size-2.5 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <b className="block font-display text-4xl font-extrabold leading-none sm:text-5xl lg:text-[60px]">{value}</b>
      <em className="text-[13px] not-italic text-mute">{note}</em>
    </div>
  );
}

function LineChart({ reports }) {
  const width = 640;
  const height = 230;
  const pad = 30;
  const dated = reports.map((row) => ({
    row,
    date: reportDate(row) || new Date(Date.now() - (Number(row.day) || 0) * 864e5),
  })).filter(({ date }) => !Number.isNaN(date.getTime()));
  const minTime = dated.length ? Math.min(...dated.map(({ date }) => date.getTime())) : Date.now();
  const maxTime = dated.length ? Math.max(...dated.map(({ date }) => date.getTime())) : minTime;
  const spanDays = Math.max(0, Math.round((maxTime - minTime) / 864e5));
  const bucketCount = Math.min(30, Math.max(1, spanDays + 1));
  const bucketIndex = (date) => bucketCount === 1 ? 0 : Math.min(bucketCount - 1, Math.floor(((date.getTime() - minTime) / Math.max(1, maxTime - minTime)) * bucketCount));
  const sectorSeries = Object.keys(SECTORS).map((sector) =>
    Array.from({ length: bucketCount }, (_, bucket) => dated
      .filter(({ row, date }) => row.sec === sector && bucketIndex(date) === bucket)
      .reduce((sum, { row }) => sum + (Number(row.n) || 0), 0)),
  );
  const max = Math.max(...sectorSeries.flat(), 4);
  const x = (index) => pad + (index * (width - pad - 8)) / Math.max(1, bucketCount - 1);
  const y = (value) => height - 24 - (value * (height - 44)) / max;
  const labelIndexes = [...new Set([0, Math.floor((bucketCount - 1) / 4), Math.floor((bucketCount - 1) / 2), Math.floor((bucketCount - 1) * 3 / 4), bucketCount - 1])];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Cases by sector across the selected reporting period">
      {[0, 1, 2, 3, 4].map((i) => {
        const value = Math.round((max * i) / 4);
        return (
          <g key={i}>
            <line x1={pad} x2={width} y1={y(value)} y2={y(value)} stroke="var(--line)" />
            <text x="0" y={y(value) + 4}>
              {value}
            </text>
          </g>
        );
      })}
      {labelIndexes.map((index) => (
        <text key={index} x={x(index)} y={height - 6} textAnchor="middle">
          {new Date(minTime + ((maxTime - minTime) * index) / Math.max(1, bucketCount - 1)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: spanDays > 365 ? 'numeric' : undefined })}
        </text>
      ))}
      {Object.keys(SECTORS).map((sector, index) => (
        <polyline
          key={sector}
          fill="none"
          stroke={COLORS[sector]}
          strokeWidth="2.5"
          strokeLinejoin="round"
          points={sectorSeries[index].map((value, itemIndex) => `${x(itemIndex)},${y(value)}`).join(' ')}
        />
      ))}
    </svg>
  );
}

function LeadingSignals({ reports }) {
  const entries = useMemo(() => {
    return Object.entries(aggregateDiseaseCases(reports))
      .map(([disease, item]) => {
        const sector = Object.entries(item.sectors).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'human';
        return [disease, item.cases, sector];
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7);
  }, [reports]);

  if (!entries.length) return <div className="py-5 text-mute">No reports in the last 30 days.</div>;
  const max = entries[0][1];

  return (
    <div>
      {entries.map(([disease, count, sector]) => {
        return (
          <div key={disease} className="my-2 grid grid-cols-[120px_1fr_34px] items-center gap-2 text-[13px]">
            <span>{disease}</span>
            <div className="h-3 rounded-md bg-bg">
              <div className="h-full rounded-md" style={{ width: `${(count / max) * 100}%`, background: COLORS[sector] }} />
            </div>
            <b>{count}</b>
          </div>
        );
      })}
    </div>
  );
}

function Dashboard({
  reports,
  alerts,
  setPage,
  layers,
  setLayers,
  mapFilters,
  setMapFilters,
  selectedLocation,
  setSelectedLocation,
  live,
  empty,
  auth,
  uploadInfo,
  onCsvUpload,
  periodDays,
  setPeriodDays,
  analysisMode,
  setAnalysisMode,
  periodLabel,
  periodEmpty,
  alertsUnavailable,
  datasets,
  activeDatasetId,
  onDatasetChange,
}) {
  const [showDatasetStatus, setShowDatasetStatus] = useState(true);
  useEffect(() => {
    setShowDatasetStatus(true);
  }, [uploadInfo?.name, uploadInfo?.rows, uploadInfo?.saved]);
  const week = (sector) => reports.filter((row) => !sector || row.sec === sector);
  const locationCount = getReportLocations(reports).length;
  const metrics = calculateDashboardMetrics(reports);
  const metric = (sector) => {
    if (sector === 'human') return metrics.humanCases;
    if (sector === 'animal') return metrics.animalReports ?? '—';
    return metrics.climateObservations;
  };
  const trend = (sector) => {
    const value = metric(sector);
    return `${typeof value === 'number' ? value.toLocaleString('en-IN') : value} in selected period`;
  };
  const count = alerts.length;
  const animalWeek = week('animal');
  const hasAnimalData = animalWeek.length > 0;
  const livestockDeaths = hasAnimalData ? animalWeek.reduce((sum, row) => sum + (Number(row.mortality) || 0), 0) : '—';
  const unvaccinatedHerds = hasAnimalData ? animalWeek.filter((row) => row.vaccinationStatus === 'unvaccinated').length : '—';
  const labConfirmedAnimal = hasAnimalData ? animalWeek.filter((row) => row.confirmationStatus === 'lab_confirmed').length : '—';
  const speciesCount = hasAnimalData ? new Set(animalWeek.map((row) => row.species).filter(Boolean)).size : '—';

  return (
    <>
      <Top
        title={count ? `${count} ${count === 1 ? 'place needs' : 'places need'} a closer look this week` : 'No unusual rises this week'}
        action={
          <div className="flex flex-wrap gap-2">
            {can(auth, 'reports:write') ? <CsvUploadButton onUpload={onCsvUpload} /> : null}
            {can(auth, 'reports:write') ? <Button onClick={() => setPage('reports')}>Add a report</Button> : null}
          </div>
        }
      >
        Records from {locationCount.toLocaleString('en-IN')} mapped locations. {periodLabel}.
      </Top>

      {uploadInfo && showDatasetStatus ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-tool border border-line bg-card px-3 py-2.5 text-xs text-ink">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`rounded-full px-2 py-0.5 font-semibold ${uploadInfo.saved ? 'bg-env/15 text-env' : 'bg-animal/15 text-animal'}`}>
              {uploadInfo.saved ? 'Database-persisted' : 'Browser-only'}
            </span>
            <span className="truncate font-medium" title={uploadInfo.name}>{uploadInfo.name}</span>
            <span className="text-mute">{uploadInfo.rows.toLocaleString('en-IN')} rows</span>
            <span className="text-mute">{uploadInfo.saved ? 'stored in the database' : 'stored only in this browser'}</span>
            {uploadInfo.skipped ? <span className="text-mute">· {uploadInfo.skipped.toLocaleString('en-IN')} skipped</span> : null}
          </div>
          <button
            type="button"
            className="shrink-0 rounded px-2 py-1 text-base leading-none text-mute hover:bg-mute/10 hover:text-ink"
            aria-label="Dismiss dataset status"
            title="Dismiss"
            onClick={() => setShowDatasetStatus(false)}
          >
            ×
          </button>
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-tool border border-line bg-card p-3 text-sm text-mute">
        <DatasetSelector datasets={datasets} activeDatasetId={activeDatasetId} onChange={onDatasetChange} canFilterIndividual={can(auth, 'users:manage')} />
        <label className="font-semibold text-ink" htmlFor="report-period">Reporting period</label>
        <select id="report-period" className="rounded border border-line bg-card px-2 py-1 text-ink" value={periodDays} onChange={(event) => setPeriodDays(event.target.value === 'all' ? 'all' : Number(event.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value="all">All dataset records</option>
        </select>
        <label className="font-semibold text-ink" htmlFor="analysis-mode">Alert analysis</label>
        <select id="analysis-mode" className="rounded border border-line bg-card px-2 py-1 text-ink" value={analysisMode} onChange={(event) => setAnalysisMode(event.target.value)}>
          <option value="historical">Historical dataset scan</option>
          <option value="current">Latest 30-day window</option>
        </select>
        <span>{periodLabel}</span>
      </div>

      {periodEmpty ? <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-tool border border-animal/40 bg-card p-4 text-sm text-ink"><span>Use the complete historical period for this dataset to inspect older records.</span><Button variant="ghost" className="px-3 py-1.5" onClick={() => setPeriodDays('all')}>Use dataset period</Button></div> : null}

      <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] xl:gap-11">
        <MapPanel
          reports={reports}
          alerts={alerts}
          layers={layers}
          setLayers={setLayers}
          mapFilters={mapFilters}
          setMapFilters={setMapFilters}
          selectedLocation={selectedLocation}
          setSelectedLocation={setSelectedLocation}
        />
        <section>
          <h2 className="font-display text-2xl font-bold">Early warnings</h2>
          <div className="mb-2 text-sm text-mute">The number is a risk score out of 100. It combines how far reports rose, weather and movement routes.</div>
          {alerts.length ? alerts.slice(0, 4).map((alert) => <AlertItem key={`${alert.loc}-${alert.analysisDate || 'current'}`} alert={alert} compact />) : <div className="py-5 text-mute">{alertsUnavailable ? 'Alerts are not calculated from uploaded historical records.' : analysisMode === 'historical' ? 'No verified anomaly crossed the alert thresholds in the dataset history.' : 'No unusual increases in this period.'}</div>}
          <Button variant="ghost" className="mt-3" onClick={() => setPage('alerts')}>
            See all alerts
          </Button>
        </section>
      </div>

      <div className="my-9 grid border-t-2 border-ink md:grid-cols-4">
        <StatCard label="Human cases" value={metric('human')} color={COLORS.human} note={trend('human')} />
        <StatCard label="Animal reports" value={metric('animal')} color={COLORS.animal} note={trend('animal')} />
        <StatCard label="Climate observations" value={metric('environment')} color={COLORS.environment} note="Rows with temperature or precipitation data" />
        <StatCard label="Active alerts" value={count} color={COLORS.alert} note="Unusual rise detected" />
      </div>

      <div className="mb-9 grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
        <div>
          <span className="text-[13.5px] text-mute">Livestock mortality this week</span>
          <b className="block font-display text-[34px] leading-tight text-ink">{livestockDeaths}</b>
        </div>
        <div>
          <span className="text-[13.5px] text-mute">Unvaccinated animal reports</span>
          <b className="block font-display text-[34px] leading-tight text-ink">{unvaccinatedHerds}</b>
        </div>
        <div>
          <span className="text-[13.5px] text-mute">Species under surveillance</span>
          <b className="block font-display text-[34px] leading-tight text-ink">{speciesCount}</b>
          <span className="text-[13.5px] text-mute">{labConfirmedAnimal} lab-confirmed animal signals</span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:gap-11">
        <section>
          <h2 className="font-display text-[22px] font-bold">Reports over time</h2>
          <div className="mb-2 text-sm text-mute">Daily totals for the selected reporting period</div>
          <div className="mb-2 flex flex-wrap gap-3 text-[13px] text-mute">
            {Object.keys(SECTORS).map((sector) => (
              <span key={sector} className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-full" style={{ background: COLORS[sector] }} />
                {SECTORS[sector]}
              </span>
            ))}
          </div>
          <LineChart reports={reports} />
        </section>
        <section>
          <h2 className="font-display text-[22px] font-bold">Leading signals</h2>
          <div className="mb-2 text-sm text-mute">Most reported diseases in the selected period</div>
          <LeadingSignals reports={reports} />
        </section>
      </div>

      <p className="mt-11 border-t border-line pt-3 text-[13px] text-mute">
        {uploadInfo
          ? 'Reports come from the uploaded CSV in this browser. Animal species, mortality, vaccination and lab status are preserved when present. Climate and movement corridor figures are still sample data.'
          : live && !empty
            ? 'Reports come from the database with Pashudhan fields when provided. Climate and movement corridor figures are still sample data.'
            : 'All numbers are sample data for demonstration.'}{' '}
        Alerts are signals to investigate, not confirmed outbreaks.
      </p>
    </>
  );
}

function ReportsPage({ reports, setReports, filters, setFilters, live, reload, showToast, auth }) {
  const locationOptions = useMemo(
    () => [...new Set([...getReportLocations(reports), ...reports.map((row) => row.district).filter(Boolean), ...LOCATIONS.map(([loc]) => loc)])].sort((a, b) => a.localeCompare(b)),
    [reports],
  );
  const [form, setForm] = useState({
    sector: 'animal',
    disease: DISEASES.animal[0],
    location: LOCATIONS[0][0],
    cases: 1,
    species: SPECIES_OPTIONS[0],
    symptoms: '',
    mortality: 0,
    vaccinationStatus: 'unknown',
    confirmationStatus: 'suspected',
    farmId: '',
    block: '',
  });
  const [showAllReports, setShowAllReports] = useState(false);

  const filteredRows = reports
    .filter((row) => (filters.sec === 'all' || row.sec === filters.sec) && (filters.loc === 'all' || row.loc === filters.loc || row.district === filters.loc))
    .sort((a, b) => a.day - b.day || b.id - a.id);
  const rows = showAllReports ? filteredRows : filteredRows.slice(0, 10);
  const canWrite = can(auth, 'reports:write');
  const exportReport = async (format) => {
    if (!live) { showToast('Exports require database-backed reports'); return; }
    const query = new URLSearchParams({ datasetId: window.localStorage.getItem('onehealth-dataset-id') || 'all' });
    if (filters.sec !== 'all') query.set('sector', filters.sec);
    if (filters.loc !== 'all') query.set('location', filters.loc);
    const response = await fetch(`/api/reports/export.${format}?${query}`, { headers: { Authorization: `Bearer ${auth?.token}` } });
    if (!response.ok) { showToast('Export could not be created'); return; }
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `onehealth-report-export.${format}`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const updateForm = (patch) => {
    setForm((current) => {
      const next = { ...current, ...patch };
      if (patch.sector && !DISEASES[patch.sector].includes(next.disease)) next.disease = DISEASES[patch.sector][0];
      return next;
    });
  };

  const saveReport = async () => {
    if (!canWrite) {
      showToast('Viewer accounts have read-only access');
      return;
    }
    const cases = Math.max(1, Math.min(500, Math.round(Number(form.cases) || 1)));
    const mortality = Math.max(0, Math.min(500, Math.round(Number(form.mortality) || 0)));
    const body = {
      disease: form.disease,
      sector: form.sector,
      location: form.location,
      cases,
      species: form.sector === 'animal' ? cleanOptional(form.species) : undefined,
      symptoms: cleanOptional(form.symptoms) || undefined,
      mortality,
      vaccinationStatus: form.sector === 'animal' ? form.vaccinationStatus : 'unknown',
      confirmationStatus: form.confirmationStatus,
      farmId: cleanOptional(form.farmId) || undefined,
      block: cleanOptional(form.block) || undefined,
    };
    const coords = getKnownCoords(body.location);
    if (coords) {
      body.latitude = coords[0];
      body.longitude = coords[1];
    }

    if (!live) {
      setReports((current) => [
        decorateUiReport({
          id: Date.now(),
          day: 0,
          loc: body.location,
          lat: coords?.[0],
          lon: coords?.[1],
          sec: body.sector,
          dis: body.disease,
          n: cases,
          species: body.species,
          symptoms: body.symptoms,
          mortality: body.mortality,
          vaccinationStatus: body.vaccinationStatus,
          confirmationStatus: body.confirmationStatus,
          farmId: body.farmId,
          block: body.block,
        }, { sourceType: 'manual', sourceName: 'Manual report form', sourceUploadedBy: auth?.user?.username || 'demo-user' }),
        ...current,
      ]);
      showToast('Saved in demo mode only');
      return;
    }

    if (!can(auth, 'reports:write')) {
      showToast('Login as analyst or admin to save live reports');
      return;
    }

    try {
      const response = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('save failed');
      await reload();
      showToast('Report saved to database');
    } catch {
      showToast('Could not save. Is the server running?');
    }
  };

  return (
    <>
      <Top title="Reports" action={<div className="flex flex-wrap gap-2"><Button variant="ghost" className="px-3 py-1.5" onClick={() => exportReport('csv')}>Export CSV</Button><Button variant="ghost" className="px-3 py-1.5" onClick={() => exportReport('pdf')}>Export PDF</Button></div>}>Add an observation or filter what has been filed</Top>

      {canWrite ? <section className="mb-4 rounded-tool border border-line bg-card p-4">
        <h3 className="font-display text-lg font-bold">New report</h3>
        <div className="mb-3 text-sm text-mute">
          {live && !canWrite ? 'Live database writes require analyst or admin login' : 'It appears on the dashboard right away'}
        </div>
        <div className="grid items-end gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Label text="Sector">
            <Select value={form.sector} onChange={(event) => updateForm({ sector: event.target.value })}>
              {Object.entries(SECTORS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </Label>
          <Label text="Disease or signal">
            <Select value={form.disease} onChange={(event) => updateForm({ disease: event.target.value })}>
              {DISEASES[form.sector].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </Select>
          </Label>
          <Label text="Location">
            <Select value={form.location} onChange={(event) => updateForm({ location: event.target.value })}>
              {locationOptions.map((loc) => (
                <option key={loc}>{loc}</option>
              ))}
            </Select>
          </Label>
          <Label text="Number of cases">
            <Input type="number" min="1" value={form.cases} onChange={(event) => updateForm({ cases: event.target.value })} />
          </Label>
          {form.sector === 'animal' ? (
            <>
              <Label text="Animal species">
                <Select value={form.species} onChange={(event) => updateForm({ species: event.target.value })}>
                  {SPECIES_OPTIONS.map((species) => (
                    <option key={species}>{species}</option>
                  ))}
                </Select>
              </Label>
              <Label text="Mortality">
                <Input type="number" min="0" value={form.mortality} onChange={(event) => updateForm({ mortality: event.target.value })} />
              </Label>
              <Label text="Vaccination">
                <Select value={form.vaccinationStatus} onChange={(event) => updateForm({ vaccinationStatus: event.target.value })}>
                  {Object.entries(VACCINATION_OPTIONS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Label>
              <Label text="Farm or holding">
                <Input value={form.farmId} onChange={(event) => updateForm({ farmId: event.target.value })} />
              </Label>
            </>
          ) : null}
          <Label text="Status">
            <Select value={form.confirmationStatus} onChange={(event) => updateForm({ confirmationStatus: event.target.value })}>
              {Object.entries(CONFIRMATION_OPTIONS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Label>
          <Label text="Block or village">
            <Input value={form.block} onChange={(event) => updateForm({ block: event.target.value })} />
          </Label>
          <Label text="Symptoms">
            <Input value={form.symptoms} onChange={(event) => updateForm({ symptoms: event.target.value })} />
          </Label>
          <Button className="w-full" disabled={!canWrite} onClick={saveReport}>
            Save report
          </Button>
        </div>
      </section> : (
        <div className="mb-4 rounded-tool border border-line bg-card p-4 text-sm text-mute">
          Reports are read-only for Viewer accounts. An authorized administrator or analyst can add new reports.
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-2.5">
        <Select value={filters.sec} aria-label="Filter by sector" onChange={(event) => setFilters((current) => ({ ...current, sec: event.target.value }))}>
          <option value="all">All sectors</option>
          {Object.entries(SECTORS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
        <Select value={filters.loc} aria-label="Filter by location" onChange={(event) => setFilters((current) => ({ ...current, loc: event.target.value }))}>
          <option value="all">All locations</option>
          {locationOptions.map((loc) => (
            <option key={loc}>{loc}</option>
          ))}
        </Select>
      </div>

      <div className="overflow-x-auto rounded-tool border border-line bg-card p-4">
        <table className="w-full min-w-[560px] border-collapse">
          <thead>
            <tr>
              {['Date', 'Sector', 'Disease or signal', 'Location', 'Cases', 'Source', 'Quality', 'Pashudhan details'].map((head) => (
                <th key={head} className="border-b border-ink p-2 text-left text-[13px] font-medium text-mute">
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row) => (
                <tr key={`${row.id}-${row.loc}-${row.day}`} className="hover:bg-mute/10">
                  <td className="border-b border-line p-2.5">{formatReportDate(row)}</td>
                  <td className="border-b border-line p-2.5">
                    <Tag sector={row.sec} />
                  </td>
                  <td className="border-b border-line p-2.5">{row.dis}</td>
                  <td className="border-b border-line p-2.5">{row.loc}</td>
                  <td className="border-b border-line p-2.5">{row.n}</td>
                  <td className="border-b border-line p-2.5 text-[13px] text-mute">{sourceLabel(row)}</td>
                  <td className="border-b border-line p-2.5">
                    <QualityBadge score={row.dataQualityScore} />
                  </td>
                  <td className="border-b border-line p-2.5 text-[13px] text-mute">{reportMeta(row) || '-'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="8" className="p-5 text-mute">
                  No reports match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {filteredRows.length > 10 ? (
        <div className="mt-3 flex justify-center">
          <Button variant="ghost" className="px-4 py-2" onClick={() => setShowAllReports((current) => !current)}>
            {showAllReports ? 'Show less' : `See more (${filteredRows.length - 10} more)`}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function Label({ text, children }) {
  return (
    <label className="grid gap-1 text-[13px] text-mute">
      {text}
      {children}
    </label>
  );
}

function Select({ className = '', ...props }) {
  return (
    <select
      className={`rounded-[10px] border border-line bg-card px-2.5 py-2 font-sans text-ink outline-none focus-visible:ring-2 focus-visible:ring-env ${className}`}
      {...props}
    />
  );
}

function Input({ className = '', ...props }) {
  return <input className={`rounded-[10px] border border-line bg-card px-2.5 py-2 font-sans text-ink outline-none focus-visible:ring-2 focus-visible:ring-env ${className}`} {...props} />;
}

function DetectionChart({ reports, location }) {
  const width = 640;
  const height = 220;
  const pad = 28;
  const stats = cityStats(reports, location);
  const threshold = stats.mean + 2 * stats.sd;
  const max = Math.max(...stats.series, threshold, 4) + 1;
  const x = (index) => pad + (index * (width - pad - 8)) / 29;
  const y = (value) => height - 24 - (value * (height - 44)) / max;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Daily reports for ${location} with usual level and alert line`}>
      <rect x={x(23)} y="10" width={x(29) - x(23)} height={height - 34} fill="var(--alert)" opacity=".08" />
      <line x1={pad} x2={width} y1={y(stats.mean)} y2={y(stats.mean)} stroke="var(--mute)" strokeDasharray="4 4" />
      <text x={pad + 4} y={y(stats.mean) - 4}>
        usual level
      </text>
      <line x1={pad} x2={width} y1={y(threshold)} y2={y(threshold)} stroke="var(--alert)" />
      <text x={pad + 4} y={y(threshold) - 4} style={{ fill: 'var(--alert)' }}>
        alert line
      </text>
      <polyline fill="none" stroke="var(--ink)" strokeWidth="2" points={stats.series.map((value, index) => `${x(index)},${y(value)}`).join(' ')} />
      {stats.series.map((value, index) =>
        value > threshold ? <circle key={index} cx={x(index)} cy={y(value)} r="4" fill="var(--alert)" /> : null,
      )}
      <text x={x(26)} y={height - 6} textAnchor="middle">
        this week
      </text>
      <text x={x(11)} y={height - 6} textAnchor="middle">
        baseline: the 3 weeks before
      </text>
    </svg>
  );
}

function AlertsPage({ reports, alerts, diagnostics, activeCity, setActiveCity, auth, onValidate, onRespond, envByCity, analysisMode, periodLabel }) {
  const cityOptions = getReportLocations(reports);
  const city = activeCity || alerts[0]?.loc || cityOptions[0] || LOCATIONS[0][0];

  return (
    <>
      <Top title="Early warnings">
        {analysisMode === 'historical' ? `Historical scan for ${periodLabel}. ` : 'Latest dataset window. '}A city is flagged when its weekly reports run at least 1.8x the usual level and cross the alert line. The anomaly engine combines z-score,
        cross-sector rise, unusual weather and movement routes. These are signals to investigate, not confirmed outbreaks.
      </Top>

      {!alerts.length && diagnostics?.length ? (
        <div className="mb-5 rounded-tool border border-animal/40 bg-card p-4 text-sm text-ink">
          <b className="font-display">Why no alert was generated</b>
          <ul className="mt-2 list-disc pl-5 text-mute">
            {diagnostics.slice(0, 6).map((item) => <li key={`${item.location || 'dataset'}-${item.code}`}>{item.message}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:gap-11">
        <div>
          {alerts.length ? (
            alerts.map((alert) => <AlertItem key={alert.loc} alert={alert} auth={auth} onValidate={onValidate} onRespond={onRespond} envByCity={envByCity} />)
          ) : (
            <div className="py-5 text-mute">{analysisMode === 'historical' ? 'No verified historical anomaly crossed the alert thresholds.' : 'No unusual increases in this period.'}</div>
          )}
        </div>
        <section>
          <h2 className="font-display text-[22px] font-bold">How it was flagged</h2>
          <div className="mb-3 text-sm text-mute">Pick a city to see its daily reports against the usual level</div>
          <Select className="mb-3" value={city} aria-label="City" onChange={(event) => setActiveCity(event.target.value)}>
            {cityOptions.map((loc) => (
              <option key={loc}>{loc}</option>
            ))}
          </Select>
          <DetectionChart reports={reports} location={city} />
        </section>
      </div>
    </>
  );
}

function PipelinePage({ reports, alerts, live, empty, uploadInfo, envByCity, weatherSource }) {
  const [climateExpanded, setClimateExpanded] = useState(false);
  const locationNames = getReportLocations(reports);
  const averageQuality = reports.length ? Math.round(reports.reduce((sum, row) => sum + Number(row.dataQualityScore || 0), 0) / reports.length) : 0;
  const lowQualityCount = reports.filter((row) => Number(row.dataQualityScore || 0) < 75).length;
  const flagCounts = reports.reduce((counts, row) => {
    (row.qualityFlags || []).forEach((flag) => {
      counts[flag] = (counts[flag] || 0) + 1;
    });
    return counts;
  }, {});
  const provenanceRows = Object.entries(
    reports.reduce((counts, row) => {
      const label = row.sourceType || 'unknown';
      counts[label] = (counts[label] || 0) + 1;
      return counts;
    }, {}),
  );
  const sources = [
    ['Human health', 'Hospital and clinic reports', 'human'],
    ['Animal health', 'Veterinary and livestock reports', 'animal'],
    ['Environment', 'Weather station readings', 'environment'],
  ];
  const stages = [
    ['Collect', reports.length, 'reports received from 3 sectors'],
    ['Clean', new Set(reports.map((row) => row.dis)).size, 'disease and signal names standardized'],
    ['Merge', locationNames.length, 'locations joined across sectors by date'],
    ['Detect', alerts.length, `${ML_MODEL.version} model scored city risk`],
    ['Validate', alerts.filter((alert) => alert.validationStatus === 'validated').length, 'alerts with strong evidence'],
  ];
  const climateRows = locationNames.map((loc) => {
    const env = envByCity[loc] ?? [0, 0];
    const flagged = Math.abs(env[0]) >= 3 || Math.abs(env[1]) >= 40;
    return [
      loc,
      `${sign(env[0])} deg C`,
      `${sign(env[1])}%`,
      <span key={loc} className={flagged ? 'font-semibold text-alert' : ''}>
        {flagged ? 'Unusual' : 'Normal'}
      </span>,
    ];
  });

  return (
    <>
      <Top title="Data pipeline">How human, animal and environment data flow into one view, and what is moving between cities.</Top>

      <div className="mb-8 grid border-t-2 border-ink sm:grid-cols-2 lg:grid-cols-5">
        {stages.map(([name, value, note], index) => (
          <div key={name} className="py-3 pr-4">
            <span className="text-[13.5px] text-mute">
              {index + 1}. {name}
            </span>
            <b className="block font-display text-[40px] font-extrabold leading-tight">{value}</b>
            <span className="text-[13.5px] text-mute">{note}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] xl:gap-11">
        <section>
          <h2 className="font-display text-[22px] font-bold">Data sources</h2>
          <div className="mb-2 text-sm text-mute">Records from the last 30 days</div>
          <DataTable
            headers={['Source', 'Feeds from', 'Records', 'Status']}
            rows={sources.map(([source, feed, sector]) => [
              <Tag key={source} sector={sector} />,
              feed,
              reports.filter((row) => row.sec === sector).length,
              uploadInfo ? 'CSV upload' : live && !empty ? 'Connected' : 'Demo data',
            ])}
          />

          <h2 className="mt-7 font-display text-[22px] font-bold">Data quality</h2>
          <div className="mb-2 text-sm text-mute">Completeness and provenance checks before records are trusted for decisions</div>
          <DataTable
            headers={['Check', 'Value', 'Status']}
            rows={[
              ['Average quality score', `${averageQuality}/100`, averageQuality >= 80 ? 'Good' : 'Needs review'],
              ['Low-quality records', lowQualityCount, lowQualityCount ? 'Review before escalation' : 'Clear'],
              ['Known provenance', reports.filter((row) => row.sourceType && row.sourceName).length, 'Source attached'],
              ...Object.entries(flagCounts).slice(0, 5).map(([flag, count]) => [QUALITY_LABELS[flag] || flag, count, 'Open']),
            ]}
          />

          <h2 className="mt-7 font-display text-[22px] font-bold">Provenance mix</h2>
          <div className="mb-2 text-sm text-mute">Where the current dashboard records came from</div>
          <DataTable
            headers={['Source type', 'Records', 'Trust note']}
            rows={(provenanceRows.length ? provenanceRows : [['unknown', 0]]).map(([source, count]) => [
              SOURCE_LABELS[source] || source,
              count,
              source === 'manual' ? 'User-entered and audited' : source === 'csv' ? 'Persisted CSV import' : source === 'csv_browser' ? 'Browser-only CSV demo' : 'Sample context',
            ])}
          />

          <h2 className="mt-7 font-display text-[22px] font-bold">Pashudhan surveillance</h2>
          <div className="mb-2 text-sm text-mute">Animal-specific context used during field triage</div>
          <DataTable
            headers={['Species', 'Reports', 'Deaths', 'Unvaccinated', 'Lab confirmed']}
            rows={(SPECIES_OPTIONS.filter((species) => reports.some((row) => row.species === species)).length
              ? SPECIES_OPTIONS.filter((species) => reports.some((row) => row.species === species))
              : ['No species data']
            ).map((species) => {
              const speciesRows = reports.filter((row) => row.species === species);
              return [
                species,
                speciesRows.length || '-',
                speciesRows.reduce((sum, row) => sum + (Number(row.mortality) || 0), 0) || '-',
                speciesRows.filter((row) => row.vaccinationStatus === 'unvaccinated').length || '-',
                speciesRows.filter((row) => row.confirmationStatus === 'lab_confirmed').length || '-',
              ];
            })}
          />

          <div className="climate-table-card">
            <h2 className="font-display text-[22px] font-bold">Climate readings</h2>
            <div className="mb-2 text-sm text-mute">
              Difference from the usual for this time of year{weatherSource === 'open-meteo' ? ' from live weather context' : ''}
            </div>
            <DataTable headers={['City', 'Temperature', 'Rainfall', 'Flag']} rows={climateExpanded ? climateRows : climateRows.slice(0, 5)} />
            {climateRows.length > 5 ? (
              <button className="climate-toggle" type="button" onClick={() => setClimateExpanded((expanded) => !expanded)} aria-expanded={climateExpanded}>
                {climateExpanded ? 'Show less ↑' : 'Show more ↓'}
              </button>
            ) : null}
          </div>
        </section>

        <section>
          <h2 className="font-display text-[22px] font-bold">ML model</h2>
          <div className="mb-2 text-sm text-mute">Versioned model profile used by the alert engine</div>
          <DataTable
            headers={['Metric', 'Value']}
            rows={[
              ['Version', ML_MODEL.version],
              ['Type', ML_MODEL.modelType],
              ['ML threshold', Math.round(ML_MODEL.threshold * 100)],
              ['Backtest precision', `${Math.round(ML_MODEL.calibration.precision * 100)}%`],
              ['Backtest recall', `${Math.round(ML_MODEL.calibration.recall * 100)}%`],
              ['Features', ML_MODEL.features.join(', ')],
            ]}
          />

          <h2 className="mt-7 font-display text-[22px] font-bold">Livestock corridors</h2>
          <div className="mb-2 text-sm text-mute">Animals moving between cities each week. Routes out of an alerting city are at risk.</div>
          <DataTable
            headers={['Route', 'Animals a week', 'Status']}
            rows={CORRIDORS.map(([from, to, count]) => {
              const hot = alerts.some((alert) => alert.loc === from);
              return [
                `${from} to ${to}`,
                count.toLocaleString('en-IN'),
                <span key={`${from}-${to}`} className={hot ? 'font-semibold text-alert' : ''}>
                  {hot ? 'At risk' : 'Normal'}
                </span>,
              ];
            })}
          />

          <h2 className="mt-7 font-display text-[22px] font-bold">Alert validation</h2>
          <div className="mb-2 text-sm text-mute">Automated evidence checks before an alert is escalated</div>
          <DataTable
            headers={['City', 'Method', 'Score', 'Validation', 'Response']}
            rows={(alerts.length ? alerts : [{ loc: 'None', validation: { method: '-', score: 0, label: 'No active alerts' } }]).map((alert) => [
              alert.loc,
              alert.validation.method,
              alert.validation.score,
              alert.manualValidation?.status || alert.validation.label,
              RESPONSE_STATUSES[alert.manualValidation?.responseStatus || 'new'],
            ])}
          />
        </section>
      </div>
    </>
  );
}

function AdminPage({ auth, showToast }) {
  const [users, setUsers] = useState([]);
  const [audit, setAudit] = useState([]);
  const [quality, setQuality] = useState(null);
  const [showAllAudit, setShowAllAudit] = useState(false);
  const [showAllQuality, setShowAllQuality] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', role: 'viewer' });
  const [busy, setBusy] = useState(false);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${auth?.token}` };

  const loadAdmin = async () => {
    if (!can(auth, 'users:manage')) return;
    try {
      const [usersResponse, auditResponse, qualityResponse] = await Promise.all([
        fetch('/api/admin/users', { headers }),
        fetch('/api/admin/audit?limit=80', { headers }),
        fetch('/api/admin/quality?limit=500', { headers }),
      ]);
      if (!usersResponse.ok || !auditResponse.ok || !qualityResponse.ok) throw new Error('admin load failed');
      setUsers(await usersResponse.json());
      setAudit(await auditResponse.json());
      setQuality(await qualityResponse.json());
    } catch {
      showToast('Could not load admin data');
    }
  };

  useEffect(() => {
    loadAdmin();
  }, [auth?.token]);

  const createUser = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers,
        body: JSON.stringify(form),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not create user');
      setForm({ username: '', password: '', role: 'viewer' });
      await loadAdmin();
      showToast('User created');
    } catch (err) {
      showToast(err.message);
    } finally {
      setBusy(false);
    }
  };

  const updateUser = async (username, patch) => {
    try {
      const current = users.find((user) => user.username === username);
      const response = await fetch(`/api/admin/users/${encodeURIComponent(username)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ role: current.role, active: current.active, ...patch }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not update user');
      await loadAdmin();
      showToast('User updated');
    } catch (err) {
      showToast(err.message);
    }
  };

  if (!can(auth, 'users:manage')) {
    return <Top title="Admin">Login as admin to manage users, audit logs and data quality.</Top>;
  }

  const flagRows = Object.entries(quality?.flagCounts || {}).map(([flag, count]) => [QUALITY_LABELS[flag] || flag, count]);
  const sourceRows = Object.entries(quality?.bySource || {}).map(([source, count]) => [SOURCE_LABELS[source] || source, count]);
  const auditRows = audit.length ? audit : [{ at: null, actor: '-', role: '-', action: 'No audit records', details: {} }];
  const qualityRows = quality?.samples?.length
    ? quality.samples
    : [{ disease: 'No review items', location: '-', sourceType: '-', dataQualityScore: 0, qualityFlags: [] }];
  const visibleAuditRows = showAllAudit ? auditRows : auditRows.slice(0, 5);
  const visibleQualityRows = showAllQuality ? qualityRows : qualityRows.slice(0, 5);

  return (
    <>
      <Top title="Admin">Manage roles, inspect audit logs and check whether report data is complete enough for field decisions.</Top>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] xl:gap-11">
        <section>
          <h2 className="font-display text-[22px] font-bold">Users and roles</h2>
          <form className="mb-4 grid items-end gap-2.5 rounded-tool border border-line bg-card p-4 sm:grid-cols-4" onSubmit={createUser}>
            <Label text="Username">
              <Input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} />
            </Label>
            <Label text="Password">
              <Input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} />
            </Label>
            <Label text="Role">
              <Select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}>
                {['viewer', 'analyst', 'admin'].map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </Select>
            </Label>
            <Button disabled={busy || !form.username || !form.password}>Create user</Button>
          </form>
          <DataTable
            headers={['User', 'Role', 'Active', 'Last login', 'Actions']}
            rows={users.map((user) => [
              user.username,
              <Select
                key={`${user.username}-role`}
                value={user.role}
                onChange={(event) => setUsers((current) => current.map((item) => (item.username === user.username ? { ...item, role: event.target.value } : item)))}
              >
                {['viewer', 'analyst', 'admin'].map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </Select>,
              <label key={`${user.username}-active`} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(user.active)}
                  onChange={(event) => setUsers((current) => current.map((item) => (item.username === user.username ? { ...item, active: event.target.checked } : item)))}
                />
                {user.active ? 'Active' : 'Disabled'}
              </label>,
              user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('en-IN') : '-',
              <Button key={`${user.username}-save`} variant="ghost" className="px-3 py-1.5" onClick={() => updateUser(user.username, {})}>
                Save
              </Button>,
            ])}
          />

          <h2 className="mt-7 font-display text-[22px] font-bold">Audit trail</h2>
          <div className="mb-2 text-sm text-mute">Recent privileged actions written by the backend</div>
          <DataTable
            headers={['Time', 'Actor', 'Role', 'Action', 'Details']}
            rows={visibleAuditRows.map((log) => [
              log.at ? new Date(log.at).toLocaleString('en-IN') : '-',
              log.actor,
              log.role,
              log.action,
              Object.entries(log.details || {}).map(([key, value]) => `${key}: ${value}`).join(', ') || '-',
            ])}
          />
          {auditRows.length > 5 && (
            <Button variant="ghost" className="mt-3 px-3 py-1.5" onClick={() => setShowAllAudit((current) => !current)}>
              {showAllAudit ? 'Show less' : 'Show more'}
            </Button>
          )}
        </section>

        <section>
          <h2 className="font-display text-[22px] font-bold">Data quality summary</h2>
          <div className="mb-2 text-sm text-mute">Stored report completeness, provenance and warning flags</div>
          <div className="mb-5 grid grid-cols-2 gap-3">
            {[
              ['Average quality', `${quality?.averageScore || 0}/100`],
              ['Low-quality reports', quality?.lowQualityReports || 0],
              ['Missing provenance', quality?.missingProvenance || 0],
              ['Reports checked', quality?.totalReports || 0],
            ].map(([label, value]) => (
              <div key={label} className="rounded-tool border border-line bg-card p-4">
                <span className="text-[13px] text-mute">{label}</span>
                <b className="block font-display text-[32px] leading-tight">{value}</b>
              </div>
            ))}
          </div>
          <DataTable headers={['Flag', 'Reports']} rows={flagRows.length ? flagRows : [['No open quality flags', '-']]} />

          <h2 className="mt-7 font-display text-[22px] font-bold">Source mix</h2>
          <div className="mb-2 text-sm text-mute">How many stored records came from each source type</div>
          <DataTable headers={['Source', 'Reports']} rows={sourceRows.length ? sourceRows : [['No stored reports', '-']]} />

          <h2 className="mt-7 font-display text-[22px] font-bold">Records to review</h2>
          <div className="mb-2 text-sm text-mute">Lowest-confidence records with missing context</div>
          <DataTable
            headers={['Signal', 'Location', 'Source', 'Quality', 'Flags']}
            rows={visibleQualityRows.map((sample) => [
              sample.disease,
              sample.location,
              SOURCE_LABELS[sample.sourceType] || sample.sourceType,
              <QualityBadge key={`${sample.id || sample.disease}-quality`} score={sample.dataQualityScore} />,
              (sample.qualityFlags || []).map((flag) => QUALITY_LABELS[flag] || flag).join(', ') || '-',
            ])}
          />
          {qualityRows.length > 5 && (
            <Button variant="ghost" className="mt-3 px-3 py-1.5" onClick={() => setShowAllQuality((current) => !current)}>
              {showAllQuality ? 'Show less' : 'Show more'}
            </Button>
          )}
        </section>
      </div>
    </>
  );
}

function DataTable({ headers, rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} className="border-b border-ink p-2 text-left text-[13px] font-medium text-mute">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="hover:bg-mute/10">
              {row.map((cell, index) => (
                <td key={index} className="border-b border-line p-2.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [page, setPage] = useState('dashboard');
  const [reports, setReports] = useState([]);
  const [live, setLive] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [filters, setFilters] = useState({ sec: 'all', loc: 'all' });
  const [layers, setLayers] = useState({ heat: true, corridors: true });
  const [mapFilters, setMapFilters] = useState({ sector: 'all', severity: 'all', minCases: 0, dateRange: '7', disease: 'all', location: 'all' });
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [activeCity, setActiveCity] = useState(null);
  const [toast, setToast] = useState('');
  const [uploadInfo, setUploadInfo] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [activeDatasetId, setActiveDatasetId] = useState(() => window.localStorage.getItem(BROWSER_MODE_STORAGE_KEY) === '1' ? '' : window.localStorage.getItem('onehealth-dataset-id') || 'all');
  const [periodDays, setPeriodDays] = useState('all');
  const [analysisMode, setAnalysisMode] = useState('historical');
  const [periodEnd, setPeriodEnd] = useState(null);
  const [weatherByCity, setWeatherByCity] = useState(ENV);
  const [weatherSource, setWeatherSource] = useState('demo');
  const [auth, setAuth] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [manualValidations, setManualValidations] = useState({});
  const [alertDiagnostics, setAlertDiagnostics] = useState([]);
  const [serverAlerts, setServerAlerts] = useState([]);
  const csvUploadToken = useRef(0);
  const datasetReports = reports;
  const analysisReports = useMemo(() => periodizeReports(datasetReports, periodEnd, periodDays), [datasetReports, periodEnd, periodDays]);
  const periodLabel = useMemo(() => periodText(datasetReports, periodEnd, periodDays), [datasetReports, periodEnd, periodDays]);
  const periodStatus = useMemo(() => periodAvailability(datasetReports, periodEnd || latestReportDate(datasetReports) || new Date(), periodDays), [datasetReports, periodEnd, periodDays]);
  const uploadedDataset = datasetReports.some((row) => row.sourceType === 'csv' || row.sourceType === 'csv_browser');
  const rawAlerts = useMemo(() => uploadedDataset ? serverAlerts : computeAlerts(analysisReports, weatherByCity), [analysisReports, uploadedDataset, serverAlerts, weatherByCity]);
  const alerts = useMemo(
    () => {
      const visibleAlerts = rawAlerts.filter((alert) => {
        if (!alert.analysisDate || periodDays === 'all' || !periodEnd) return true;
        const date = new Date(alert.analysisDate);
        const end = new Date(periodEnd);
        const start = new Date(end.getTime() - (Number(periodDays) - 1) * 864e5);
        return date >= start && date <= end;
      });
      return visibleAlerts.map((alert) => {
        const manualValidation = manualValidations[alert.loc];
        return manualValidation ? { ...alert, manualValidation, validationStatus: manualValidation.status } : alert;
      });
    },
    [manualValidations, periodDays, periodEnd, rawAlerts],
  );

  const showToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  };

  const login = async (username, password) => {
    setAuthError('');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(response.status === 503 ? payload.error || 'Authentication service unavailable.' : 'login failed');
      }
      const nextAuth = await response.json();
      setAuth(nextAuth);
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextAuth));
      return true;
    } catch (error) {
      setAuthError(error.message === 'login failed' ? 'Invalid username or password.' : error.message || 'Unable to reach the authentication service. Please try again.');
      return false;
    }
  };

  const signup = async (username, password) => {
    setAuthError('');
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not create this account.');
      return true;
    } catch (error) {
      setAuthError(error.message || 'Could not create this account.');
      return false;
    }
  };

  const logout = () => {
    const token = auth?.token;
    setAuth(null);
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    if (page === 'admin') setPage('dashboard');
    if (token) fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  };

  const loadServerAlertContext = async (tokenAtStart, datasetId = activeDatasetId) => {
    try {
      const queryParams = new URLSearchParams();
      if (datasetId) queryParams.set('datasetId', datasetId);
      if (analysisMode === 'historical') queryParams.set('mode', 'historical');
      const query = queryParams.toString() ? `?${queryParams.toString()}` : '';
      const response = await fetch(`/api/alerts${query}`, { headers: { Authorization: `Bearer ${auth?.token}` } });
      if (response.status === 401) {
        logout();
        return;
      }
      if (!response.ok || tokenAtStart !== csvUploadToken.current) return;
      const payload = await response.json();
      const serverAlerts = Array.isArray(payload) ? payload : payload.alerts || [];
      setServerAlerts(serverAlerts);
      setAlertDiagnostics(Array.isArray(payload) ? [] : payload.diagnostics || []);
      const nextValidations = Object.fromEntries(
        serverAlerts
          .filter((alert) => alert.manualValidation)
          .map((alert) => [alert.location || alert.loc, alert.manualValidation]),
      );
      setManualValidations(nextValidations);
    } catch {
      setManualValidations({});
    }
  };

  const loadWeatherContext = async (nextReports, tokenAtStart) => {
    const points = getReportLocations(nextReports)
      .map((loc) => {
        const sample = nextReports.find((row) => row.loc === loc && getReportCoords(row));
        const coords = sample ? getReportCoords(sample) : getKnownCoords(loc);
        return coords ? `${encodeURIComponent(loc)}:${coords[0]}:${coords[1]}` : null;
      })
      .filter(Boolean)
      .slice(0, 12)
      .join('|');

    if (!points) return;

    try {
      const response = await fetch(`/api/context/weather?points=${points}`, { headers: { Authorization: `Bearer ${auth?.token}` } });
      if (response.status === 401) {
        logout();
        return;
      }
      if (!response.ok || tokenAtStart !== csvUploadToken.current) return;
      const payload = await response.json();
      const liveReadings = (payload.readings || []).filter((item) => item.source === 'open-meteo');
      if (liveReadings.length) {
        setWeatherByCity((current) => ({
          ...current,
          ...Object.fromEntries(liveReadings.map((item) => [item.location, [item.tempAnomaly, item.rainfallAnomaly]])),
        }));
        setWeatherSource('open-meteo');
      }
    } catch {
      setWeatherSource('demo');
    }
  };

  const validateAlert = async (location, status) => {
    if (!can(auth, 'alerts:validate')) {
      showToast('Login as analyst or admin to validate alerts');
      return;
    }

    const manualValidation = {
      status,
      by: auth.user.username,
      role: auth.user.role,
      at: new Date().toISOString(),
    };

    if (live) {
      try {
        const response = await fetch(`/api/alerts/${encodeURIComponent(location)}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
          body: JSON.stringify({ status }),
        });
        if (!response.ok) throw new Error('validation failed');
        const payload = await response.json();
        setManualValidations((current) => ({ ...current, [location]: payload.manualValidation }));
        showToast(`Alert marked ${status}`);
        return;
      } catch {
        showToast('Could not save validation to server');
        return;
      }
    }

    setManualValidations((current) => ({ ...current, [location]: manualValidation }));
    showToast(`Alert marked ${status} in demo mode`);
  };

  const updateAlertResponse = async (location, responseStatus) => {
    if (!can(auth, 'alerts:validate')) {
      showToast('Login as analyst or admin to update field response');
      return;
    }

    const manualValidation = {
      ...(manualValidations[location] || { status: 'review', by: auth.user.username, role: auth.user.role, at: new Date().toISOString() }),
      responseStatus,
      responseUpdatedAt: new Date().toISOString(),
    };

    if (live) {
      try {
        const response = await fetch(`/api/alerts/${encodeURIComponent(location)}/respond`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
          body: JSON.stringify({ responseStatus }),
        });
        if (!response.ok) throw new Error('response update failed');
        const payload = await response.json();
        setManualValidations((current) => ({ ...current, [location]: payload.manualValidation }));
        showToast(`Response set to ${RESPONSE_STATUSES[responseStatus] || responseStatus}`);
        return;
      } catch {
        showToast('Could not save response to server');
        return;
      }
    }

    setManualValidations((current) => ({ ...current, [location]: manualValidation }));
    showToast(`Response set to ${RESPONSE_STATUSES[responseStatus] || responseStatus} in demo mode`);
  };

  const restoreBrowserDataset = async () => {
    try {
      const saved = await readBrowserDataset();
      if (!saved?.reports?.length) return false;
      setReports(saved.reports);
      setPeriodEnd(saved.periodEnd ? new Date(saved.periodEnd) : latestReportDate(saved.reports));
      setPeriodDays('all');
      setUploadInfo({ name: saved.name, rows: saved.reports.length, skipped: saved.skipped || 0, saved: false });
      setLive(false);
      setEmpty(false);
      setActiveCity(saved.reports[0]?.loc ?? null);
      return true;
    } catch {
      return false;
    }
  };

  const loadDatasets = async (preferredId = '') => {
    if (window.localStorage.getItem(BROWSER_MODE_STORAGE_KEY) === '1') {
      setDatasets([]);
      setActiveDatasetId('');
      await restoreBrowserDataset();
      return '';
    }
    try {
      const response = await fetch('/api/reports/datasets', { headers: { Authorization: `Bearer ${auth?.token}` } });
      if (!response.ok) throw new Error('dataset list failed');
      const nextDatasets = await response.json();
      setDatasets(nextDatasets);
      const savedId = preferredId || window.localStorage.getItem('onehealth-dataset-id') || '';
      const selectable = nextDatasets.filter((dataset) => dataset.status === 'ready' || dataset.status === 'legacy');
      const selected = can(auth, 'users:manage') && savedId
        ? selectable.find((dataset) => dataset.datasetId === savedId)
        : null;
      const nextId = selected?.datasetId || 'all';
      setActiveDatasetId(nextId);
      window.localStorage.setItem('onehealth-dataset-id', nextId);
      return nextId;
    } catch {
      setDatasets([]);
      setActiveDatasetId('');
      setReports([]);
      setLive(false);
      setEmpty(true);
      return '';
    }
  };

  const loadReports = async (first = false, datasetId = activeDatasetId) => {
    const tokenAtStart = csvUploadToken.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);

    try {
      const query = new URLSearchParams({ limit: '50000' });
      if (datasetId) query.set('datasetId', datasetId);
      const response = await fetch(`/api/reports?${query.toString()}`, { signal: controller.signal, headers: { Authorization: `Bearer ${auth?.token}` } });
      if (response.status === 401) {
        logout();
        return;
      }
      if (!response.ok) throw new Error('bad status');
      const rows = await response.json();
      if (tokenAtStart !== csvUploadToken.current) return;
      setLive(true);
      setEmpty(!rows.length);

      if (rows.length) {
        const today = new Date().setHours(0, 0, 0, 0);
        const nextReports = rows.map((row, index) => {
            const coords = getKnownCoords(row.location);
            return decorateUiReport({
              id: rows.length - index,
              date: row.date,
              day: Math.max(0, Math.round((today - new Date(row.date).setHours(0, 0, 0, 0)) / 864e5)),
              loc: row.location,
              lat: Number.isFinite(row.latitude) ? row.latitude : coords?.[0],
              lon: Number.isFinite(row.longitude) ? row.longitude : coords?.[1],
              sec: row.sector,
              dis: row.disease,
              n: row.cases,
              species: row.species,
              symptoms: row.symptoms,
              mortality: row.mortality,
              deaths: row.deaths,
              state: row.state,
              district: row.district,
              weekNumber: row.weekNumber,
              temperatureCelsius: row.temperatureCelsius,
              precipitationMm: row.precipitationMm,
              sourceDataset: row.sourceDataset,
              sourceUrl: row.sourceUrl,
              isSynthetic: row.isSynthetic,
              alertLabel: row.alertLabel,
              vaccinationStatus: row.vaccinationStatus,
              confirmationStatus: row.confirmationStatus,
              farmId: row.farmId,
              block: row.block,
              sourceType: row.sourceType,
              sourceName: row.sourceName,
              sourceUploadedBy: row.sourceUploadedBy,
              sourceUploadedAt: row.sourceUploadedAt,
              dataQualityScore: row.dataQualityScore,
              qualityFlags: row.qualityFlags,
            });
          });
        setReports(nextReports);
        const selectedDataset = datasets.find((dataset) => dataset.datasetId === datasetId);
        setUploadInfo(datasetId && selectedDataset ? { name: selectedDataset.fileName, rows: selectedDataset.importedRows ?? selectedDataset.rowCount, skipped: selectedDataset.skippedRows ?? 0, saved: true, datasetId } : null);
        setPeriodEnd(latestReportDate(nextReports));
        if (datasetId) setPeriodDays('all');
        loadServerAlertContext(tokenAtStart, datasetId);
        loadWeatherContext(nextReports, tokenAtStart);
      } else {
        setReports([]);
        setUploadInfo(null);
        setPeriodEnd(null);
        setManualValidations({});
        setServerAlerts([]);
        setAlertDiagnostics([]);
      }
    } catch {
      setReports([]);
      setLive(false);
      setEmpty(true);
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const changeDataset = (datasetId) => {
    window.localStorage.removeItem(BROWSER_MODE_STORAGE_KEY);
    clearBrowserDataset();
    setActiveDatasetId(datasetId);
    window.localStorage.setItem('onehealth-dataset-id', datasetId);
    setSelectedLocation(null);
    setActiveCity(null);
    setManualValidations({});
    setServerAlerts([]);
    setAlertDiagnostics([]);
  };

  const handleCsvUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    csvUploadToken.current += 1;

    if (!can(auth, 'reports:write')) {
      showToast('Viewer accounts cannot upload CSV datasets');
      return;
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      showToast('Please upload a .csv file');
      return;
    }

    if (live) {
      if (!can(auth, 'reports:write')) {
        showToast('Login as analyst or admin to save CSV to MongoDB');
        return;
      }

      try {
        const previewData = new FormData();
        previewData.append('file', file);
        const previewResponse = await fetch('/api/reports/import-csv/preview', {
          method: 'POST',
          headers: { Authorization: `Bearer ${auth.token}` },
          body: previewData,
        });
        const preview = await previewResponse.json().catch(() => ({}));
        if (!previewResponse.ok) throw new Error(preview.error || 'CSV validation failed');
        const range = preview.dateRange?.min && preview.dateRange?.max
          ? ` ${new Date(preview.dateRange.min).toLocaleDateString('en-IN')} – ${new Date(preview.dateRange.max).toLocaleDateString('en-IN')}.`
          : '';
        if (!window.confirm(`Import ${preview.fileName}?\n${preview.importedRows.toLocaleString('en-IN')} rows will be imported, ${preview.skippedRows} skipped.${range}`)) return;

        const formData = new FormData();
        formData.append('file', file);
        const response = await fetch('/api/reports/import-csv', {
          method: 'POST',
          headers: { Authorization: `Bearer ${auth.token}` },
          body: formData,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'CSV import failed');

        await loadDatasets(payload.datasetId);
        window.localStorage.removeItem(BROWSER_MODE_STORAGE_KEY);
        clearBrowserDataset();
        if (payload.datasetId) await loadReports(false, payload.datasetId);
        if (payload.dateRange?.max) setPeriodEnd(new Date(payload.dateRange.max));
        setPeriodDays('all');
        setUploadInfo({ name: file.name, rows: payload.inserted, skipped: payload.skipped, saved: true, datasetId: payload.datasetId });
        setSelectedLocation(null);
        setPage('dashboard');
        showToast(`Saved ${payload.inserted.toLocaleString('en-IN')} CSV rows to MongoDB`);
        return;
      } catch (err) {
        showToast(err.message || 'Could not save this CSV');
        return;
      }
    }

    try {
      const text = await file.text();
      const parsed = parseUploadedCsv(text);
      if (parsed.error) {
        showToast(parsed.error);
        return;
      }
      if (!parsed.reports.length) {
        showToast('No usable One Health rows found in this CSV');
        return;
      }

      const browserReports = parsed.reports.map((row) => decorateUiReport(row, { sourceType: 'csv_browser', sourceName: file.name }));
      await saveBrowserDataset({ name: file.name, reports: browserReports, skipped: parsed.skipped, periodEnd: latestReportDate(browserReports) });
      window.localStorage.setItem(BROWSER_MODE_STORAGE_KEY, '1');
      window.localStorage.removeItem('onehealth-dataset-id');
      setActiveDatasetId('');
      setReports(browserReports);
      setPeriodEnd(latestReportDate(browserReports));
      setPeriodDays('all');
      setWeatherByCity(ENV);
      setWeatherSource('demo');
      setManualValidations({});
      setLive(false);
      setEmpty(false);
      setUploadInfo({ name: file.name, rows: parsed.reports.length, skipped: parsed.skipped });
      setSelectedLocation(null);
      setActiveCity(parsed.reports[0]?.loc ?? null);
      setPage('dashboard');
      showToast(`Loaded ${parsed.reports.length.toLocaleString('en-IN')} CSV rows in browser`);
    } catch {
      showToast('Could not read this CSV file');
    }
  };

  useEffect(() => {
    let active = true;
    const stored = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) {
      setAuthLoading(false);
      return () => { active = false; };
    }

    let saved;
    try {
      saved = JSON.parse(stored);
    } catch {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      setAuthLoading(false);
      return () => { active = false; };
    }

    if (!saved?.token) {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      setAuthLoading(false);
      return () => { active = false; };
    }

    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${saved.token}` } })
      .then((response) => {
        if (!response.ok) throw new Error('session expired');
        return response.json();
      })
      .then((payload) => {
        if (active) setAuth({ token: saved.token, user: payload.user });
      })
      .catch(() => {
        window.localStorage.removeItem(AUTH_STORAGE_KEY);
        if (active) setAuth(null);
      })
      .finally(() => { if (active) setAuthLoading(false); });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (auth) loadDatasets();
  }, [auth]);

  useEffect(() => {
    if (auth && activeDatasetId) loadReports(false, activeDatasetId);
  }, [auth, activeDatasetId]);

  useEffect(() => {
    if (auth && activeDatasetId && live) loadServerAlertContext(csvUploadToken.current, activeDatasetId);
  }, [analysisMode]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  const content = {
    dashboard: (
      <Dashboard
        reports={analysisReports}
        alerts={alerts}
        diagnostics={alertDiagnostics}
        setPage={setPage}
        layers={layers}
        setLayers={setLayers}
        mapFilters={mapFilters}
        setMapFilters={setMapFilters}
        selectedLocation={selectedLocation}
        setSelectedLocation={setSelectedLocation}
        live={live}
        empty={empty}
        auth={auth}
        uploadInfo={uploadInfo}
        onCsvUpload={handleCsvUpload}
        periodDays={periodDays}
        setPeriodDays={setPeriodDays}
        analysisMode={analysisMode}
        setAnalysisMode={setAnalysisMode}
        periodLabel={periodLabel}
        periodEmpty={Boolean(uploadedDataset && periodStatus.empty)}
        alertsUnavailable={false}
        datasets={datasets}
        activeDatasetId={activeDatasetId}
        onDatasetChange={changeDataset}
      />
    ),
    reports: (
      <ReportsPage
        reports={datasetReports}
        setReports={setReports}
        filters={filters}
        setFilters={setFilters}
        live={live}
        reload={() => loadReports(false)}
        showToast={showToast}
        auth={auth}
      />
    ),
    alerts: (
      <AlertsPage
        reports={analysisReports}
        alerts={alerts}
        activeCity={activeCity}
        setActiveCity={setActiveCity}
        auth={auth}
        onValidate={validateAlert}
        onRespond={updateAlertResponse}
        envByCity={weatherByCity}
        analysisMode={analysisMode}
        periodLabel={periodLabel}
      />
    ),
    pipeline: <PipelinePage reports={analysisReports} alerts={alerts} live={live} empty={empty} uploadInfo={uploadInfo} envByCity={weatherByCity} weatherSource={weatherSource} />,
    admin: <AdminPage auth={auth} showToast={showToast} />,
  }[page];

  if (authLoading) {
    return <main className="login-page"><div className="login-loading">Checking your secure session…</div></main>;
  }

  if (!auth) {
    return <LoginPage onLogin={login} onSignup={signup} error={authError} loading={false} />;
  }

  return (
    <>
      <Header
        page={page}
        setPage={setPage}
        alertCount={alerts.length}
        live={live}
        empty={empty}
        uploadInfo={uploadInfo}
        auth={auth}
        onLogin={login}
        onLogout={logout}
      />
      <main className="app-main">{content}</main>
      {toast ? (
        <div className="fixed bottom-5 left-1/2 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-[22px] bg-ink px-[18px] py-2.5 text-center font-semibold text-bg shadow-soft">
          {toast}
        </div>
      ) : null}
    </>
  );
}

export default App;
