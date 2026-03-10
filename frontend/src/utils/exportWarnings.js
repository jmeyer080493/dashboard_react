/**
 * Export Warnings Utility
 * 
 * Provides warnings for data quality issues before exporting charts
 */

/**
 * Check if any series has missing data at the start or end of the time series
 * @param {Array} chartData - Array of data points with DatePoint and series values
 * @param {Array} series - Array of series names (regions/sectors/factors)
 * @returns {Object} - { hasMissingData: boolean, missingSeriesStart: string[], missingSeriesEnd: string[] }
 */
export function checkDataGaps(chartData, series) {
  if (!chartData || chartData.length === 0 || !series || series.length === 0) {
    return { hasMissingData: false, missingSeriesStart: [], missingSeriesEnd: [] }
  }

  const firstRow = chartData[0]
  const lastRow = chartData[chartData.length - 1]
  
  const missingSeriesStart = []
  const missingSeriesEnd = []

  // Check each series for missing data at start
  for (const s of series) {
    const firstValue = firstRow[s]
    if (firstValue === undefined || firstValue === null) {
      missingSeriesStart.push(s)
    }
  }

  // Check each series for missing data at end
  for (const s of series) {
    const lastValue = lastRow[s]
    if (lastValue === undefined || lastValue === null) {
      missingSeriesEnd.push(s)
    }
  }

  const hasMissingData = missingSeriesStart.length > 0 || missingSeriesEnd.length > 0

  return { hasMissingData, missingSeriesStart, missingSeriesEnd }
}

/**
 * Show a warning dialog if data gaps are detected and return whether to proceed
 * @param {Array} chartData - Array of data points
 * @param {Array} series - Array of series names
 * @returns {boolean} - true if user wants to continue, false if user cancels
 */
export function showDataGapWarning(chartData, series) {
  const { hasMissingData, missingSeriesStart, missingSeriesEnd } = checkDataGaps(chartData, series)

  if (!hasMissingData) {
    return true
  }

  let message = 'Warnung: Einige Datenreihen haben fehlende Werte:\n\n'

  if (missingSeriesStart.length > 0) {
    message += `Am Anfang: ${missingSeriesStart.join(', ')}\n`
  }

  if (missingSeriesEnd.length > 0) {
    message += `Am Ende: ${missingSeriesEnd.join(', ')}\n`
  }

  message += '\nMöchten Sie fortfahren?'

  return window.confirm(message)
}

/**
 * Create a wrapper function for export handlers that checks for data gaps
 * @param {Function} exportFn - The export function to wrap (addToPptx or addToXlsx)
 * @param {Array} chartData - Chart data
 * @param {Array} series - Array of series names
 * @returns {Function} - Wrapped function
 */
export function withDataGapWarning(exportFn, chartData, series) {
  return (exportItem) => {
    if (showDataGapWarning(chartData, series)) {
      exportFn(exportItem)
    }
  }
}
