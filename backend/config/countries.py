"""
Country and Region Configuration for Backend

Exact mirror of frontend configuration.
MUST match frontend/src/config/countries.js exactly.
"""

# European countries in the available regions list
# Used to filter for "Europa" button
EUROPEAN_COUNTRIES = [
    'Germany',
    'France',
    'Italy',
    'Spain',
    'UK'
]

# World regions - primary global markets (used for "Welt" button)
WORLD_REGIONS = [
    'U.S.',
    'Europe',
    'Japan',
    'UK'
]

# All available regions - EXACT list from original dashboard config
# Original: ['U.S.', 'Europe', 'Germany', 'France', 'Italy', 'UK', 'Japan', 'Spain', 'China', 'India', 'EM']
ALL_REGIONS = [
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

# Region display names - German translations
REGION_TRANSLATIONS = {
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
    'EM': 'Emerging Markets'
}

# Mapping of alternative names to standard names (for normalization)
COUNTRY_NAME_MAPPING = {
    'USA': 'U.S.',
    'United States': 'U.S.',
    'European Union': 'Europe',
    'Eurozone': 'Europe'
}


def normalize_region_name(region: str) -> str:
    """
    Normalize a region name to standard format
    
    Args:
        region: Region name to normalize
    
    Returns:
        Normalized region name
    """
    if not region:
        return region
    return COUNTRY_NAME_MAPPING.get(region, region)


def get_region_display_name(region: str) -> str:
    """
    Get the German translation or display name for a region
    
    Args:
        region: Region name
    
    Returns:
        German translation if available, otherwise original name
    """
    return REGION_TRANSLATIONS.get(region, region)


def get_preset_regions(preset: str, available_regions: list = None) -> list:
    """
    Get list of regions matching a preset button
    
    Args:
        preset: Preset name ('Alle', 'Welt', 'Europa', 'US-EU')
        available_regions: List of available regions to filter (defaults to ALL_REGIONS)
    
    Returns:
        List of regions for the preset
    """
    if available_regions is None:
        available_regions = ALL_REGIONS
    
    if preset == 'Alle':
        # Select ALL available regions
        return available_regions
    elif preset == 'Welt':
        # Select world regions: U.S., Europe, Japan, UK
        return ['U.S.', 'Europe', 'Japan', 'UK']
    elif preset == 'Europa':
        # Select European countries that are in available regions
        # Plus "Europe" if available
        return [r for r in available_regions 
                if r in EUROPEAN_COUNTRIES or r == 'Europe']
    elif preset == 'US-EU':
        # Select US and Europe
        return ['U.S.', 'Europe']
    else:
        print(f'Warning: Unknown preset: {preset}')
        return available_regions
