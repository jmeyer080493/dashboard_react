/**
 * Country and Region Configuration
 * 
 * Exact mirror of the original dashboard region definitions.
 * All available regions for the Länder (Countries) tab.
 */

// European countries in the available regions list
// Used to filter for "Europa" button
export const EUROPEAN_COUNTRIES = [
  'Germany',
  'France',
  'Italy',
  'Spain',
  'UK',
  'Belgium',
  'Netherlands',
  'Norway',
  'Sweden',
  'Portugal',
  'Poland',
  'Latvia',
  'Lithuania',
]

// World regions - primary global markets (used for "Welt" button)
export const WORLD_REGIONS = [
  'U.S.',
  'Europe',
  'Japan',
  'UK'
]

// Countries that are ONLY available in the Fixed Income (Anleihen) subtab
// These new countries have yields data but no equity/macro data
export const FI_ONLY_REGIONS = [
  'Australia',
  'Belgium',
  'Latvia',
  'Lithuania',
  'Mexico',
  'Netherlands',
  'New Zealand',
  'Norway',
  'Poland',
  'Portugal',
  'Sweden',
]

// All available regions - EXACT list from original dashboard config
// Original: ['U.S.', 'Europe', 'Germany', 'France', 'Italy', 'UK', 'Japan', 'Spain', 'China', 'India', 'EM']
export const ALL_REGIONS = [
  'U.S.',
  'Europe',
  'Germany',
  'France',
  'Italy',
  'UK',
  'Japan',
  'Spain',
  'China',
  'India',
  'EM'
]

// Region display names - German translations
export const REGION_TRANSLATIONS = {
  'U.S.': 'U.S.',
  'Europe': 'Europa',
  'Germany': 'Deutschland',
  'France': 'Frankreich',
  'Italy': 'Italien',
  'UK': 'UK',
  'Japan': 'Japan',
  'Spain': 'Spanien',
  'China': 'China',
  'India': 'Indien',
  'EM': 'Emerging Markets',
  // FI-only countries
  'Australia': 'Australien',
  'Belgium': 'Belgien',
  'Latvia': 'Lettland',
  'Lithuania': 'Litauen',
  'Mexico': 'Mexiko',
  'Netherlands': 'Niederlande',
  'New Zealand': 'Neuseeland',
  'Norway': 'Norwegen',
  'Poland': 'Polen',
  'Portugal': 'Portugal',
  'Sweden': 'Schweden',
}

// Predefined region groups for quick selection buttons
// Mirrors original dashboard behavior exactly
export const REGION_PRESETS = {
  'Alle': (availableRegions) => {
    // Select ALL available regions
    return availableRegions
  },
  'Welt': (availableRegions) => {
    // Select world regions: U.S., Europe, Japan, UK
    // Note: EM and China are added on top for the Equity tab inside GlobalControls
    return ['U.S.', 'Europe', 'Japan', 'UK']
  },
  'Europa': (availableRegions) => {
    // Select European countries that are in available regions
    // Plus "Europe" if available
    return availableRegions.filter(r => 
      EUROPEAN_COUNTRIES.includes(r) || r === 'Europe'
    )
  },
  'US-EU': (availableRegions) => {
    // Select US and Europe
    return ['U.S.', 'Europe']
  }
}

// Two-letter ISO abbreviations for each region/country
export const REGION_ABBREVIATIONS = {
  'U.S.':        'US',
  'Europe':      'EU',
  'Germany':     'DE',
  'France':      'FR',
  'Italy':       'IT',
  'UK':          'GB',
  'Japan':       'JP',
  'Spain':       'ES',
  'China':       'CN',
  'India':       'IN',
  'EM':          'EM',
  // FI-only countries
  'Australia':   'AU',
  'Belgium':     'BE',
  'Latvia':      'LV',
  'Lithuania':   'LT',
  'Mexico':      'MX',
  'Netherlands': 'NL',
  'New Zealand': 'NZ',
  'Norway':      'NO',
  'Poland':      'PL',
  'Portugal':    'PT',
  'Sweden':      'SE',
}

// Mapping of alternative names to standard names (for normalization)
export const COUNTRY_NAME_MAPPING = {
  'USA': 'U.S.',
  'United States': 'U.S.',
  'European Union': 'Europe',
  'Eurozone': 'Europe'
}

/**
 * Normalize a region name to standard format
 * @param {string} region - Region name to normalize
 * @returns {string} Normalized region name
 */
export function normalizeRegionName(region) {
  if (!region) return region
  return COUNTRY_NAME_MAPPING[region] || region
}

/**
 * Get the German translation or display name for a region
 * @param {string} region - Region name
 * @returns {string} German translation if available, otherwise original name
 */
export function getRegionDisplayName(region) {
  return REGION_TRANSLATIONS[region] || region
}

/**
 * Get list of regions matching a preset button
 * 
 * @param {string} preset - Preset name ('Alle', 'Welt', 'Europa', 'US-EU')
 * @param {array} availableRegions - List of available regions to filter (defaults to ALL_REGIONS)
 * @returns {array} List of regions for the preset
 */
export function getPresetRegions(preset, availableRegions = ALL_REGIONS) {
  const presetFunc = REGION_PRESETS[preset]
  if (!presetFunc) {
    console.warn(`Unknown preset: ${preset}`)
    return availableRegions
  }
  return presetFunc(availableRegions)
}
