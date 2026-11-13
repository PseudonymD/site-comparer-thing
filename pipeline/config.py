"""Static configuration: the 18-feature schema and which sources can provide each feature.

The ORDER of FEATURES is the on-disk order in features.bin. Never reorder without
bumping SCHEMA_VERSION and regenerating the data.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

SCHEMA_VERSION = 1

PIPELINE_DIR = Path(__file__).resolve().parent
REPO_DIR = PIPELINE_DIR.parent
CACHE_DIR = PIPELINE_DIR / "cache"
OUTPUT_DIR = PIPELINE_DIR / "output"
LOG_DIR = PIPELINE_DIR / "logs"
ASSETS_DIR = PIPELINE_DIR / "assets"
WEB_DATA_DIR = REPO_DIR / "web" / "public" / "data"


@dataclass(frozen=True)
class Feature:
    id: str
    name: str
    unit: str
    group: str  # group as defined in the challenge table
    ui_group: str  # one of Terrain / Climate / Surface / Remoteness (UI sliders)
    sources: tuple[str, ...]  # preference order; "synthetic" is always the last resort
    description: str = ""
    log_display: bool = False  # hint for UI axis formatting


FEATURES: list[Feature] = [
    Feature("elevation", "Elevation", "m", "terrain", "Terrain", ("terrain", "synthetic"),
            "Mean elevation above sea level (AWS Terrain Tiles / Terrarium)."),
    Feature("slope_mean", "Mean slope", "°", "terrain", "Terrain", ("terrain", "synthetic"),
            "Mean of per-pixel slope at native DEM resolution within the cell."),
    Feature("slope_p90", "Slope p90", "°", "terrain", "Terrain", ("terrain", "synthetic"),
            "90th percentile of per-pixel slope within the cell (steep-terrain hazard)."),
    Feature("tri", "Roughness (TRI)", "m", "terrain", "Terrain", ("terrain", "synthetic"),
            "Terrain Ruggedness Index (Riley 1999): mean absolute elevation difference to the 8 neighbours."),
    Feature("relief", "Local relief", "m", "terrain", "Terrain", ("terrain", "synthetic"),
            "Max − min elevation within the cell."),
    Feature("temp_mean", "Mean temperature", "°C", "climate", "Climate", ("modis_lst", "power", "synthetic"),
            "Annual mean surface (MODIS LST) or 2 m air (NASA POWER) temperature."),
    Feature("temp_range", "Diurnal temp range", "°C", "climate", "Climate", ("modis_lst", "power", "synthetic"),
            "Annual mean day−night temperature difference."),
    Feature("temp_min", "Annual min temperature", "°C", "climate", "Climate", ("modis_lst", "power", "synthetic"),
            "Coldest monthly mean of daily minimum temperature."),
    Feature("precip", "Precipitation", "mm/yr", "climate", "Climate", ("power", "synthetic"),
            "Annual precipitation (NASA POWER PRECTOTCORR).", True),
    Feature("humidity", "Relative humidity", "%", "climate", "Climate", ("power", "synthetic"),
            "Annual mean 2 m relative humidity (NASA POWER RH2M)."),
    Feature("solar", "Solar irradiance", "kWh/m²/day", "climate", "Climate", ("power", "synthetic"),
            "All-sky surface shortwave downward irradiance (NASA POWER ALLSKY_SFC_SW_DWN)."),
    Feature("ndvi", "Vegetation (NDVI)", "", "surface", "Surface", ("modis_ndvi", "gibs_ndvi", "synthetic"),
            "Annual mean NDVI (MODIS MOD13C2 or NASA GIBS colormap-decoded)."),
    Feature("soc", "Soil organic carbon", "g/kg", "surface", "Surface", ("soilgrids", "synthetic"),
            "Topsoil (0–5 cm) organic carbon, ISRIC SoilGrids 5 km aggregate."),
    Feature("sand", "Sand / fine regolith", "%", "surface", "Surface", ("soilgrids", "synthetic"),
            "Topsoil (0–5 cm) sand fraction, ISRIC SoilGrids 5 km aggregate."),
    Feature("basalt", "Basaltic / volcanic", "fraction", "geology", "Surface", ("glim", "synthetic"),
            "Fraction of the cell mapped as basic volcanic (vb) or pyroclastic (pb) rock in GLiM."),
    Feature("ice", "Permanent ice / snow", "fraction", "surface", "Surface",
            ("modis_landcover", "glim_ice", "naturalearth_ice", "synthetic"),
            "Fraction of the cell covered by permanent ice / snow."),
    Feature("lights", "Light pollution", "nW/cm²/sr", "remoteness", "Remoteness",
            ("black_marble", "gibs_lights", "synthetic"),
            "Night-time light radiance (NASA Black Marble). GIBS fallback is a brightness proxy.", True),
    Feature("aod", "Aerosol / dust AOD", "", "pollution", "Remoteness", ("merra2", "gibs_aod", "synthetic"),
            "Annual mean aerosol optical depth at 550 nm."),
]

FEATURE_IDS = [f.id for f in FEATURES]
N_FEATURES = len(FEATURES)
assert N_FEATURES == 18

FEATURE_GROUPS = {
    "terrain": ["elevation", "slope_mean", "slope_p90", "tri", "relief"],
    "climate": ["temp_mean", "temp_range", "temp_min", "precip", "humidity", "solar"],
    "surface": ["ndvi", "soc", "sand", "basalt", "ice"],
    "remoteness": ["lights", "aod"],
}

# Number of quantile breakpoints stored per feature (0..100 percentile, every 1%).
N_BREAKPOINTS = 101

# Novelty: distance at which novelty saturates to 1.0 (km). Mirrored in docs/scoring.md and web.
NOVELTY_SATURATION_KM = 2000.0


@dataclass
class RunOptions:
    res: float = 0.1
    bbox: tuple[float, float, float, float] | None = None  # minlon, minlat, maxlon, maxlat
    only_groups: list[str] | None = None
    quick: bool = False
    terrain_zoom: int = 6
    force: bool = False
    offline: bool = False
    extra: dict = field(default_factory=dict)

    def wants(self, feature_id: str) -> bool:
        if not self.only_groups:
            return True
        return any(feature_id in FEATURE_GROUPS.get(g, []) for g in self.only_groups)
