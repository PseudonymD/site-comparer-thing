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

# Display metadata describes the selected source, not the normalized percentile.
# Values intentionally use bounded wording where the source does not publish a
# site-level uncertainty estimate.
SOURCE_METADATA = {
    "terrain": {
        "resolution": "Native DEM tiles, aggregated to the application cell",
        "temporal_coverage": "Static elevation product",
        "data_quality": "DEM-derived; coverage and gap filling reported per feature",
        "uncertainty": "No site-level uncertainty supplied by the source",
        "measurement_class": "Derived observation",
    },
    "power": {
        "resolution": "0.5° x 0.625° meteorology; 1° solar, interpolated to the grid",
        "temporal_coverage": "Climatology",
        "data_quality": "Modelled/satellite-derived climatology; coverage and gap filling reported per feature",
        "uncertainty": "No site-level uncertainty supplied by the source",
        "measurement_class": "Modelled estimate",
    },
    "modis_lst": {
        "resolution": "0.05° CMG, aggregated to the application grid",
        "temporal_coverage": "Monthly product, annual summaries from available granules",
        "data_quality": "Satellite land-surface temperature; missing pixels may be filled",
        "uncertainty": "No site-level uncertainty supplied by the source",
        "measurement_class": "Satellite-derived estimate",
    },
    "modis_ndvi": {
        "resolution": "0.05° CMG, aggregated to the application grid",
        "temporal_coverage": "Annual summary from MODIS observations",
        "data_quality": "Satellite vegetation index; missing pixels may be filled",
        "uncertainty": "No site-level uncertainty supplied by the source",
        "measurement_class": "Satellite-derived estimate",
    },
    "gibs_ndvi": {
        "resolution": "NASA GIBS raster, aggregated to the application grid",
        "temporal_coverage": "Product imagery period",
        "data_quality": "Colormap-decoded imagery proxy",
        "uncertainty": "Not provided; proxy decoding adds uncertainty",
        "measurement_class": "Proxy",
    },
    "soilgrids": {
        "resolution": "250 m source maps; 5 km aggregate used by this pipeline",
        "temporal_coverage": "Static prediction product",
        "data_quality": "Global soil prediction; gap policy documented per feature",
        "uncertainty": "Source uncertainty is not propagated to the grid",
        "measurement_class": "Modelled estimate",
    },
    "glim": {
        "resolution": "Global geological map, aggregated to the application grid",
        "temporal_coverage": "Static geological mapping",
        "data_quality": "Regional mapped lithology; not an exposure survey",
        "uncertainty": "Map-class uncertainty is not propagated",
        "measurement_class": "Mapped observation",
    },
    "macrostrat": {
        "resolution": "Regional geological polygons, aggregated to the application grid",
        "temporal_coverage": "Static geological mapping",
        "data_quality": "Mapped lithology; not an exposure survey",
        "uncertainty": "Map-class uncertainty is not propagated",
        "measurement_class": "Mapped observation",
    },
    "modis_landcover": {
        "resolution": "0.05° CMG, aggregated to the application grid",
        "temporal_coverage": "Annual land-cover product",
        "data_quality": "Satellite land-cover classification",
        "uncertainty": "Class uncertainty is not propagated",
        "measurement_class": "Satellite-derived classification",
    },
    "glim_ice": {
        "resolution": "Global geological map, aggregated to the application grid",
        "temporal_coverage": "Static geological mapping",
        "data_quality": "Mapped ice/glacier class; not a subsurface-ice product",
        "uncertainty": "Map-class uncertainty is not propagated",
        "measurement_class": "Mapped observation",
    },
    "naturalearth_ice": {
        "resolution": "Vector polygons, aggregated to the application grid",
        "temporal_coverage": "Static reference map",
        "data_quality": "Mapped glaciated-area context",
        "uncertainty": "Map boundary uncertainty is not propagated",
        "measurement_class": "Mapped observation",
    },
    "black_marble": {
        "resolution": "500 m source product, aggregated to the application grid",
        "temporal_coverage": "Annual night-light composite",
        "data_quality": "Satellite night-radiance product",
        "uncertainty": "No site-level uncertainty supplied by the source",
        "measurement_class": "Satellite-derived observation",
    },
    "gibs_lights": {
        "resolution": "NASA GIBS raster, aggregated to the application grid",
        "temporal_coverage": "Product imagery period",
        "data_quality": "Brightness proxy rather than calibrated radiance",
        "uncertainty": "Not provided; proxy decoding adds uncertainty",
        "measurement_class": "Proxy",
    },
    "merra2": {
        "resolution": "0.5° x 0.625°, interpolated to the application grid",
        "temporal_coverage": "Monthly 2023 summary",
        "data_quality": "Atmospheric reanalysis column product",
        "uncertainty": "No site-level uncertainty supplied by the source",
        "measurement_class": "Reanalysis estimate",
    },
    "gibs_aod": {
        "resolution": "NASA GIBS raster, aggregated to the application grid",
        "temporal_coverage": "Product imagery period",
        "data_quality": "Colormap-decoded aerosol proxy",
        "uncertainty": "Not provided; proxy decoding adds uncertainty",
        "measurement_class": "Proxy",
    },
    "synthetic": {
        "resolution": "None",
        "temporal_coverage": "None",
        "data_quality": "Placeholder values; not scientific measurements",
        "uncertainty": "Not applicable",
        "measurement_class": "Placeholder",
    },
}


def get(name: str):
    return importlib.import_module(f"{__name__}.{name}")
