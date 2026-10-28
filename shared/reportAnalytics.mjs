const DAY = 864e5;

export const recordDate = (row) => {
  const value = row?.date ? new Date(row.date) : null;
  return value && !Number.isNaN(value.getTime()) ? value : null;
};

export function filterReportsByPeriod(rows, end, days = 7) {
  const endDate = new Date(end);
  endDate.setHours(0, 0, 0, 0);
  return rows
    .map((row) => {
      const date = recordDate(row);
      const day = date ? Math.floor((endDate.getTime() - new Date(date).setHours(0, 0, 0, 0)) / DAY) : row.day;
      return { ...row, day };
    })
    .filter((row) => !Number.isFinite(row.day) || (row.day >= 0 && (days === 'all' || row.day < Number(days))));
}

export function periodAvailability(rows, end, days = 7) {
  const dated = rows.map(recordDate).filter(Boolean).sort((a, b) => a - b);
  const selected = filterReportsByPeriod(rows, end, days);
  return {
    empty: rows.length > 0 && selected.length === 0,
    hasHistoricalData: dated.length > 0,
    earliest: dated[0] || null,
    latest: dated.at(-1) || null,
    selectedRows: selected.length,
  };
}

export function aggregateCasesBySector(rows) {
  return rows.reduce((totals, row) => {
    if (['human', 'animal', 'environment'].includes(row.sec ?? row.sector)) {
      const sector = row.sec ?? row.sector;
      totals[sector] += Number(row.n ?? row.cases ?? 0) || 0;
    }
    return totals;
  }, { human: 0, animal: 0, environment: 0 });
}

export function calculateDashboardMetrics(rows) {
  const supported = rows.filter((row) => ['human', 'animal', 'environment'].includes(row.sec ?? row.sector));
  const humanCases = supported
    .filter((row) => (row.sec ?? row.sector) === 'human')
    .reduce((sum, row) => sum + (Number(row.n ?? row.cases ?? 0) || 0), 0);
  const animalRows = supported.filter((row) => (row.sec ?? row.sector) === 'animal');
  const climateObservations = rows.filter((row) => Number.isFinite(Number(row.temperatureCelsius ?? row.temperature_celsius_derived)) || Number.isFinite(Number(row.precipitationMm ?? row.precipitation_mm_source))).length;
  return {
    humanCases,
    animalReports: animalRows.length ? animalRows.length : null,
    climateObservations,
  };
}

export function aggregateDiseaseCases(rows) {
  return rows.reduce((result, row) => {
    const disease = row.dis ?? row.disease;
    if (!disease) return result;
    const item = result[disease] ?? { cases: 0, sectors: {} };
    const sector = row.sec ?? row.sector ?? 'unknown';
    const cases = Number(row.n ?? row.cases ?? 0) || 0;
    item.cases += cases;
    item.sectors[sector] = (item.sectors[sector] || 0) + cases;
    result[disease] = item;
    return result;
  }, {});
}
