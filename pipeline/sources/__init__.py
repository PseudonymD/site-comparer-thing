"""Data source modules. Each exposes NAME, FEATURES, REQUIRES_TOKEN, HOST, fetch(cache_dir, grid) and
to_grid(grid, cache_dir, feature, **ctx) -> float32 (n_lat, n_lon) array (NaN = no data)."""
from __future__ import annotations

import importlib

SOURCE_MODULES = [
    "terrain", "power", "modis_lst", "modis_ndvi", "gibs_ndvi", "soilgrids", "glim", "macrostrat", "modis_landcover",
    "glim_ice", "naturalearth_ice", "black_marble", "gibs_lights", "merra2", "gibs_aod", "synthetic",
]

DESCRIPTIONS = {
    "terrain": ("AWS Terrain Tiles (Terrarium)", "https://registry.opendata.aws/terrain-tiles/"),
    "power": ("NASA POWER climatology", "https://power.larc.nasa.gov/"),
    "modis_lst": ("MODIS MOD11C3 v061 LST", "https://doi.org/10.5067/MODIS/MOD11C3.061"),
    "modis_ndvi": ("MODIS MOD13C2 v061 NDVI", "https://doi.org/10.5067/MODIS/MOD13C2.061"),
    "gibs_ndvi": ("NASA GIBS – MODIS Terra NDVI (colormap-decoded)", "https://nasa-gibs.github.io/gibs-api-docs/"),
    "soilgrids": ("ISRIC SoilGrids 2.0 (5 km)", "https://soilgrids.org"),
    "glim": ("GLiM global lithological map", "https://doi.org/10.1594/PANGAEA.788537"),
    "macrostrat": ("Macrostrat geologic map (mafic major lithology)", "https://macrostrat.org"),
    "modis_landcover": ("MODIS MCD12C1 v061 land cover", "https://doi.org/10.5067/MODIS/MCD12C1.061"),
    "glim_ice": ("GLiM class 'ig' (ice & glaciers)", "https://doi.org/10.1594/PANGAEA.788537"),
    "naturalearth_ice": ("Natural Earth glaciated areas + Antarctic ice", "https://www.naturalearthdata.com/"),
    "black_marble": ("NASA Black Marble VNP46A4", "https://blackmarble.gsfc.nasa.gov/"),
    "gibs_lights": ("NASA GIBS – VIIRS Black Marble imagery (brightness proxy)", "https://nasa-gibs.github.io/gibs-api-docs/"),
    "merra2": ("MERRA-2 M2TMNXAER TOTEXTTAU", "https://doi.org/10.5067/FH9A0MLJPC7N"),
    "gibs_aod": ("NASA GIBS – aerosol optical depth (colormap-decoded)", "https://nasa-gibs.github.io/gibs-api-docs/"),
    "synthetic": ("SYNTHETIC placeholder (not data)", ""),
}


def get(name: str):
    return importlib.import_module(f"{__name__}.{name}")
