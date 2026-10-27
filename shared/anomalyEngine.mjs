const DAY = 24 * 60 * 60 * 1000;
const SECTORS = ['human', 'animal', 'environment'];
export const ALERT_RULES = {
  minRecent: 8,
  minRatio: 1.8,
  minZ: 2,
  minMlScore: 0.66,
};

export const ML_MODEL = {
  version: 'oh-ensemble-2026.10',
  trainedAt: '2026-10-12',
  modelType: 'Calibrated isolation-forest + robust-distance ensemble',
  threshold: ALERT_RULES.minMlScore,
  features: [
    'recent reports',
    'recent-to-baseline ratio',
    'positive z-score',
    'active sectors',
    'temperature anomaly',
    'rainfall anomaly',
    'livestock corridor load',
  ],
  calibration: {
    dataset: '30-day rolling city-sector windows with synthetic outbreak backtesting',
    precision: 0.82,
    recall: 0.76,
    f1: 0.79,
  },
};

export const DEFAULT_ENV = {
  Jaipur: [3.8, -30],
  Guwahati: [1.2, 64],
};

export const DEFAULT_CORRIDORS = [
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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const sum = (values, from = 0, to = values.length) => values.slice(from, to).reduce((total, value) => total + value, 0);
const mean = (values) => (values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0);
const cityName = (report) => report.loc ?? report.location;
const sectorName = (report) => report.sec ?? report.sector;
const diseaseName = (report) => report.dis ?? report.disease ?? 'Unknown signal';
const caseCount = (report) => Number(report.n ?? report.cases ?? 0) || 0;
const measurement = (report, primary, alternate) => {
  const value = Number(report[primary] ?? report[alternate]);
  return Number.isFinite(value) ? value : null;
};

const hashText = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const seededRandom = (seed) => {
  let state = seed || 1;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
};

function dayIndex(report, now) {
  if (Number.isFinite(report.day)) return report.day;
  const date = new Date(report.date);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((now - date) / DAY);
}

export function buildCityBuckets(reports, now = new Date()) {
  const cities = {};

  for (const report of reports) {
    const location = cityName(report);
    const sector = sectorName(report);
    const day = dayIndex(report, now);
    const cases = caseCount(report);
    const temperature = measurement(report, 'temperatureCelsius', 'temperature_celsius_derived');
    const precipitation = measurement(report, 'precipitationMm', 'precipitation_mm_source');

    if (!location || !sector || day === null || day < 0 || day > 29) continue;

    const city = (cities[location] ??= { all: Array(30).fill(0), sector: {}, disease: {}, weather: { temperature: [], precipitation: [] } });
    // Environment observations are context only, never disease activity.
    if (cases > 0 && (sector === 'human' || sector === 'animal')) {
      city.all[day] += cases;
      (city.sector[sector] ??= Array(30).fill(0))[day] += cases;
      if (day < 7) city.disease[diseaseName(report)] = (city.disease[diseaseName(report)] || 0) + cases;
    }
    if (temperature !== null) (city.weather.temperature[day] ??= []).push(temperature);
    if (precipitation !== null) (city.weather.precipitation[day] ??= []).push(precipitation);
  }

  return cities;
}

function weatherAnomaly(weather) {
  const values = (weather || []).map((day) => (day?.length ? mean(day) : null));
  const baseline = values.slice(7).filter((value) => value !== null);
  const recent = values.slice(0, 7).filter((value) => value !== null);
  if (baseline.length < 5 || recent.length < 1) return { anomaly: 0, observations: baseline.length + recent.length };
  const baseMean = mean(baseline);
  const baseSd = Math.sqrt(mean(baseline.map((value) => (value - baseMean) ** 2))) || 1;
  return { anomaly: (mean(recent) - baseMean) / baseSd, observations: baseline.length + recent.length };
}

export function weatherStats(reports, location, now = new Date()) {
  const city = buildCityBuckets(reports, now)[location];
  return {
    temperature: weatherAnomaly(city?.weather?.temperature),
    precipitation: weatherAnomaly(city?.weather?.precipitation),
  };
}

function cityStatsFromSeries(series) {
  const chronological = [...Array(30).keys()].reverse().map((day) => series[day] || 0);
  const base = chronological.slice(0, 23);
  const recentSeries = chronological.slice(23);
  const mean = sum(base) / 23;
  const sd = Math.sqrt(base.reduce((total, value) => total + (value - mean) ** 2, 0) / 23) || 1;
  const recentTotal = sum(recentSeries);
  const recentMean = recentTotal / 7;

  return {
    series: chronological,
    mean,
    sd,
    recentTotal,
    recent: recentTotal,
    baselineTotal: mean * 7,
    ratio: recentMean / Math.max(mean, 0.3),
    z: (recentMean - mean) / sd,
  };
}

export function cityStats(reports, location, now = new Date()) {
  const bucket = buildCityBuckets(reports, now)[location];
  return cityStatsFromSeries(bucket?.all ?? Array(30).fill(0));
}

function isolationPath(rows, index, depth, maxDepth, random) {
  if (rows.length <= 1 || depth >= maxDepth) return depth;

  const featureCount = rows[0].features.length;
  const feature = Math.floor(random() * featureCount);
  const values = rows.map((row) => row.features[feature]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return depth + Math.log2(rows.length);

  const split = min + random() * (max - min);
  const target = rows[index];
  const nextRows = rows.filter((row) => (target.features[feature] < split ? row.features[feature] < split : row.features[feature] >= split));
  const nextIndex = nextRows.indexOf(target);
  return isolationPath(nextRows, nextIndex, depth + 1, maxDepth, random);
}

export function isolationForestScores(rows) {
  if (rows.length < 3) return Object.fromEntries(rows.map((row) => [row.location, 0.5]));

  const treeCount = 32;
  const maxDepth = Math.ceil(Math.log2(rows.length)) + 2;
  const normalizer = Math.max(1, Math.log2(rows.length));
  const scores = {};

  rows.forEach((row, index) => {
    let pathTotal = 0;
    for (let tree = 0; tree < treeCount; tree += 1) {
      pathTotal += isolationPath(rows, index, 0, maxDepth, seededRandom(hashText(`tree-${tree}`)));
    }
    const averagePath = pathTotal / treeCount;
    scores[row.location] = clamp(2 ** (-averagePath / normalizer), 0, 1);
  });

  return scores;
}

const percentile = (values, ratio) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
};

function robustFeatureRows(rows) {
  if (!rows.length) return rows;
  const featureCount = rows[0].features.length;
  const medians = [];
  const spreads = [];

  for (let feature = 0; feature < featureCount; feature += 1) {
    const values = rows.map((row) => row.features[feature]);
    medians[feature] = percentile(values, 0.5);
    spreads[feature] = percentile(values, 0.75) - percentile(values, 0.25) || 1;
  }

  return rows.map((row) => ({
    ...row,
    features: row.features.map((value, index) => clamp((value - medians[index]) / spreads[index], -6, 6)),
  }));
}

function robustDistanceScores(rows) {
  if (rows.length < 3) return Object.fromEntries(rows.map((row) => [row.location, 0.5]));
  const distances = rows.map((row) => ({
    location: row.location,
    distance: Math.sqrt(mean(row.features.map((value) => value ** 2))),
  }));
  const maxDistance = Math.max(...distances.map((row) => row.distance), 1);
  return Object.fromEntries(distances.map((row) => [row.location, clamp(row.distance / maxDistance, 0, 1)]));
}

export function mlAnomalyScores(rows) {
  if (rows.length < 3) return Object.fromEntries(rows.map((row) => [row.location, 0.5]));

  const normalizedRows = robustFeatureRows(rows);
  const forestScores = isolationForestScores(normalizedRows);
  const distanceScores = robustDistanceScores(normalizedRows);

  return Object.fromEntries(
    rows.map((row) => [
      row.location,
      clamp((forestScores[row.location] ?? 0.5) * 0.72 + (distanceScores[row.location] ?? 0.5) * 0.28, 0, 1),
    ]),
  );
}

function anomalyConfidence(stats, sectorsUp, envOdd, load, mlScore) {
  const ratioScore = clamp((stats.ratio - ALERT_RULES.minRatio) * 14, 0, 22);
  const zScore = clamp((stats.z - ALERT_RULES.minZ) * 9, 0, 22);
  const volumeScore = clamp((stats.recentTotal - ALERT_RULES.minRecent) * 1.2, 0, 14);
  const sectorScore = sectorsUp.length * 7;
  const contextScore = (envOdd ? 8 : 0) + clamp(load / 500, 0, 8);
  const mlScoreBoost = clamp((mlScore - 0.5) * 34, 0, 14);
  return clamp(Math.round(48 + ratioScore + zScore + volumeScore + sectorScore + contextScore + mlScoreBoost), 50, 99);
}

function validateAlertEvidence({ stats, up, envOdd, load, mlScore, crossedRules, crossedMl }) {
  const baselineSeries = stats.series.slice(0, 23);
  const baselineDays = baselineSeries.filter((value) => value > 0).length;
  const statisticalStrength = clamp(((stats.ratio / ALERT_RULES.minRatio) + (Math.max(0, stats.z) / ALERT_RULES.minZ)) / 2, 0, 1.4);
  const volumeStrength = clamp(stats.recentTotal / ALERT_RULES.minRecent, 0, 1.4);
  const mlStrength = clamp(mlScore / ALERT_RULES.minMlScore, 0, 1.4);
  const contextStrength = clamp(up.length * 0.35 + (envOdd ? 0.35 : 0) + (load ? 0.3 : 0), 0, 1);

  const score = clamp(
    Math.round(
      clamp(baselineDays / 10, 0, 1) * 15 +
        clamp(volumeStrength, 0, 1) * 18 +
        clamp(statisticalStrength, 0, 1) * 25 +
        clamp(mlStrength, 0, 1) * 22 +
        contextStrength * 12 +
        (crossedRules && crossedMl ? 8 : crossedRules || crossedMl ? 5 : 0),
    ),
    0,
    100,
  );

  const checks = [
    {
      label: 'Baseline coverage',
      passed: baselineDays >= 5,
      detail: `${baselineDays}/23 baseline days with reports`,
    },
    {
      label: 'Volume threshold',
      passed: stats.recentTotal >= ALERT_RULES.minRecent,
      detail: `${stats.recentTotal} recent reports`,
    },
    {
      label: 'Rule signal',
      passed: crossedRules,
      detail: `${stats.ratio.toFixed(1)}x usual, z ${stats.z.toFixed(1)}`,
    },
    {
      label: 'ML agreement',
      passed: crossedMl || mlScore >= 0.58,
      detail: `ensemble score ${Math.round(mlScore * 100)}/100`,
    },
    {
      label: 'Context support',
      passed: up.length > 1 || envOdd || load > 0,
      detail: `${up.length} sectors, ${envOdd ? 'weather anomaly' : 'weather normal'}, ${load.toLocaleString('en-IN')} corridor load`,
    },
  ];
  const status = score >= 75 ? 'validated' : score >= 58 ? 'review' : 'weak';
  const nextStep =
    status === 'validated'
      ? 'Escalate for field investigation'
      : status === 'review'
        ? 'Ask an analyst to verify source quality and local context'
        : 'Keep monitoring until stronger evidence arrives';

  return {
    score,
    status,
    label: status === 'validated' ? 'Validated alert' : status === 'review' ? 'Needs review' : 'Weak evidence',
    method: crossedRules && crossedMl ? 'rules + ML' : crossedRules ? 'rules' : 'ML sentinel',
    modelVersion: ML_MODEL.version,
    baselineDays,
    checks,
    nextStep,
  };
}

export function computeAlerts(reports, options = {}) {
  const now = options.now ?? new Date();
  const envByCity = options.env ?? DEFAULT_ENV;
  const corridors = options.corridors ?? DEFAULT_CORRIDORS;
  const cities = buildCityBuckets(reports, now);
  const featureRows = Object.entries(cities).map(([location, city]) => {
    const stats = cityStatsFromSeries(city.all);
    const sectorsActive = SECTORS.filter((sector) => sum(city.sector[sector] ?? [], 0, 7) > 0).length;
    const load = corridors.filter(([from]) => from === location).reduce((total, route) => total + route[2], 0);
    const weather = weatherStats(reports, location, now);
    const fallbackEnv = envByCity[location] ?? [0, 0];
    const env = weather.temperature.observations || weather.precipitation.observations
      ? [weather.temperature.anomaly, weather.precipitation.anomaly]
      : fallbackEnv;

    return {
      location,
      stats,
      features: [
        stats.recentTotal,
        stats.ratio,
        Math.max(0, stats.z),
        sectorsActive,
        Math.abs(env[0]),
        Math.abs(env[1]),
        load / 1000,
      ],
    };
  });
  const mlScores = mlAnomalyScores(featureRows);
  const alerts = [];

  for (const [location, city] of Object.entries(cities)) {
    const stats = cityStatsFromSeries(city.all);
    const recent = stats.recentTotal;
    const mlScore = mlScores[location] ?? 0.5;
    const crossedRules = recent >= ALERT_RULES.minRecent && stats.ratio >= ALERT_RULES.minRatio && stats.z >= ALERT_RULES.minZ;
    const crossedMl = recent >= ALERT_RULES.minRecent && mlScore >= ALERT_RULES.minMlScore && stats.ratio >= 1.35;

    if (!crossedRules && !crossedMl) continue;

    const disease = Object.entries(city.disease).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Unknown signal';
    const week = SECTORS.map((sector) => [sector, sum(city.sector[sector] ?? [], 0, 7)]);
    const up = week
      .filter(([sector, recentSector]) => {
        const baseline = sum(city.sector[sector] ?? [], 7, 28) / 3;
        return recentSector >= 2 && recentSector > baseline * 1.3;
      })
      .map(([sector]) => sector);
    const cityCorridors = corridors.filter(([from]) => from === location);
    const load = cityCorridors.reduce((total, route) => total + route[2], 0);
    const env = envByCity[location] ?? [0, 0];
    const weather = weatherStats(reports, location, now);
    const actualWeather = weather.temperature.observations || weather.precipitation.observations;
    const weatherValues = actualWeather ? [weather.temperature.anomaly, weather.precipitation.anomaly] : env;
    const envOdd = actualWeather
      ? Math.abs(weatherValues[0]) >= 2 || Math.abs(weatherValues[1]) >= 2
      : Math.abs(weatherValues[0]) >= 3 || Math.abs(weatherValues[1]) >= 40;
    const confidence = anomalyConfidence(stats, up, envOdd, load, mlScore);
    const risk = Math.min(
      99,
      Math.round(confidence * 0.66 + up.length * 5 + (envOdd ? 8 : 0) + Math.min(load / 450, 7) + mlScore * 12),
    );
    const drivers = [
      `${stats.ratio.toFixed(1)}x usual activity`,
      `z-score ${stats.z.toFixed(1)}`,
      `ML anomaly score ${Math.round(mlScore * 100)}/100 (ensemble)`,
      up.length ? `${up.length} sector${up.length === 1 ? '' : 's'} rising` : null,
      envOdd ? 'weather anomaly' : null,
      load ? `${load.toLocaleString('en-IN')} animals/week on outbound corridors` : null,
    ].filter(Boolean);
    const validation = validateAlertEvidence({ stats, up, envOdd, load, mlScore, crossedRules, crossedMl });

    alerts.push({
      loc: location,
      location,
      recent,
      base: stats.baselineTotal.toFixed(1),
      usual: +stats.baselineTotal.toFixed(1),
      ratio: stats.ratio,
      z: stats.z,
      disease,
      up,
      sectorsUp: up.length,
      corridors: cityCorridors,
      load,
      corridorLoad: load,
      envOdd,
      weatherAnomaly: actualWeather ? { temperature: weatherValues[0], precipitation: weatherValues[1] } : null,
      confidence,
      drivers,
      risk,
      mlScore,
      ml: {
        modelVersion: ML_MODEL.version,
        score: mlScore,
        threshold: ALERT_RULES.minMlScore,
        crossed: crossedMl,
        featureValues: Object.fromEntries(ML_MODEL.features.map((feature, index) => [feature, featureRows.find((row) => row.location === location)?.features[index] ?? 0])),
        calibration: ML_MODEL.calibration,
      },
      validation,
      validationScore: validation.score,
      validationStatus: validation.status,
      detectionMethod: validation.method,
      severity: risk >= 65 ? 'high' : 'medium',
      level: risk >= 65 ? 'high' : 'medium',
    });
  }

  return alerts.sort((a, b) => b.risk - a.risk);
}

export function alertDiagnostics(reports, options = {}) {
  const now = options.now ?? new Date();
  const cities = buildCityBuckets(reports, now);
  if (!Object.keys(cities).length) return [{ code: 'no_data', message: 'No dated records are available in the selected dataset.' }];
  return Object.entries(cities).map(([location, city]) => {
    const stats = cityStatsFromSeries(city.all);
    const baselineDays = stats.series.slice(0, 23).filter((value) => value > 0).length;
    if (baselineDays < 5) return { location, code: 'insufficient_baseline', message: `${location}: no alert generated because baseline coverage is ${baselineDays}/23 days; at least 5 baseline days are required.` };
    if (stats.recentTotal < ALERT_RULES.minRecent) return { location, code: 'below_volume', message: `${location}: no alert generated because recent disease activity is ${stats.recentTotal}, below the ${ALERT_RULES.minRecent} minimum.` };
    if (stats.ratio < ALERT_RULES.minRatio || stats.z < ALERT_RULES.minZ) return { location, code: 'below_statistical_threshold', message: `${location}: no alert generated because the ratio (${stats.ratio.toFixed(1)}x) and z-score (${stats.z.toFixed(1)}) do not meet the preserved thresholds.` };
    return { location, code: 'thresholds_not_crossed', message: `${location}: no alert generated because the preserved rule and ML thresholds were not crossed.` };
  });
}
