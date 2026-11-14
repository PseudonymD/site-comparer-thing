# Exploration activities and open data

The Exploration selector is an evidence view, not a second scoring model. Selecting an
activity highlights existing measurements and changes the explanation shown for candidates.
It does not change target weights, ranges, the similarity index, or the worker request.

## Activity status

| Activity | Status | Evidence currently shown | Important limitation |
|---|---|---|---|
| Rover mobility and navigation | Supported | DEM-derived elevation, mean/p90 slope, TRI, relief | Not a route-cost, obstacle, or wheel-performance model |
| Geological sampling | Partial | GLiM/Macrostrat volcanic context, SoilGrids sand and organic carbon, relief | Regional mapped context does not prove an exposed sample |
| Habitat construction and site preparation | Partial | Terrain, SoilGrids, temperature, precipitation | No bearing capacity, subsurface structure, flood, or logistics model |
| Dust and surface-material experiments | Partial | SoilGrids surface properties and MERRA-2 aerosol optical depth | AOD is a column proxy; wind and particle flux are absent |
| Ice-related exploration | Partial | Permanent ice/snow fraction and temperature summaries | Not a subsurface-ice, glacier-thickness, or permafrost product |
| Human field operations | Partial | Temperature, precipitation, elevation, and slope | Wind, access, hazards, communications, and seasonal operations are absent |
| Solar power experiments | Partial | NASA POWER all-sky surface shortwave irradiance and terrain context | Local horizon shading, panel geometry, dust deposition, and storage are absent |
| Thermal experiments | Supported | MODIS land-surface temperature, NASA POWER temperature, irradiance | Summaries do not represent a particular day, shade, or instrument response |
| Cave exploration | Disabled | None | No verified georeferenced cave/skylight layer is integrated; geology is not cave evidence |

“Supported” means the current grid has a direct measurement or a documented derived
measurement for the listed evidence. “Partial” means an important requested dimension is
missing or represented by a proxy. The cave activity is intentionally disabled rather than
using karst, basalt, or relief as proof of a cave.

## Current pipeline sources

These are the sources already represented by the feature provenance in `meta.json` and
processed onto the existing grid by the modular source chain in `pipeline/sources/`.

| Source | Provider and access | Resolution / units used here | Temporal coverage | Licence / limitation |
|---|---|---|---|---|
| Terrain DEM | AWS Terrain Tiles / Terrarium (`pipeline/sources/terrain.py`) | DEM-derived cell elevation, slope, TRI, and relief; final grid is normally 0.1° | Static DEM product | Source-specific terms apply; cell aggregation removes local route detail |
| NASA POWER | [NASA POWER](https://power.larc.nasa.gov/) | Native inputs are 0.5° × 0.625° meteorology and 1° solar; values are aggregated to the grid in °C, mm/yr, %, and kWh/m²/day | Climatology; POWER documents radiation from 1984-present | CC BY 4.0; modelled/reanalysis-derived values, not point observations |
| MODIS LST | [MOD11C3 v061](https://doi.org/10.5067/MODIS/MOD11C3.061) | 0.05° monthly land-surface temperature, summarized as °C | Terra monthly product from 2000-present | NASA EOSDIS data; surface temperature is not 2 m air temperature |
| MODIS NDVI | [MOD13C2 v061](https://doi.org/10.5067/MODIS/MOD13C2.061) | 0.05° vegetation index, summarized as NDVI | Terra monthly product from 2000-present | NASA EOSDIS data; vegetation is not a geological or dust measurement |
| SoilGrids 2.0 | [ISRIC documentation](https://docs.isric.org/globaldata/soilgrids/) | 250 m source maps; this pipeline uses a documented 5 km aggregate for topsoil sand and organic carbon | Static prediction maps | CC BY 4.0; predictions with uncertainty and known coverage gaps |
| GLiM | [PANGAEA DOI](https://doi.org/10.1594/PANGAEA.788537) | Global mapped lithology rasterized and aggregated to fractions | Static geological map | CC BY 3.0; mapped lithology is regional context and can be coarse |
| MERRA-2 aerosol | [NASA GES DISC DOI](https://doi.org/10.5067/FH9A0MLJPC7N) | Monthly aerosol optical depth at 550 nm, summarized as AOD | Reanalysis record; source version is recorded by the pipeline | Modelled reanalysis; AOD is not local dust flux |
| MODIS land cover / ice | [MCD12C1 v061](https://doi.org/10.5067/MODIS/MCD12C1.061) and GLiM ice class | Permanent ice/snow fraction in the aggregated cell | Annual MODIS product plus static GLiM fallback | Land-cover classification and mapped ice are not subsurface ice |

## Open datasets investigated but not silently added

SRTM (NASA/USGS, 30 m, public-domain U.S. government data), Copernicus DEM,
ERA5-Land (ECMWF/Copernicus, approximately 9 km hourly reanalysis, CC BY),
ESA WorldCover (10 m, CC BY 4.0), NSIDC MODIS snow products (500 m global
products), CAMS radiation, ECOSTRESS, Randolph Glacier Inventory, WOKAM, and
OpenStreetMap were reviewed as possible extensions. They are not represented in the
activity selector as integrated evidence unless the current pipeline provenance and
validation include them.

In particular, no WOKAM or other verified cave-location layer was found in the current
pipeline output, so Cave exploration remains disabled. Adding one later requires a
download/reprojection module, missing-data tests, provenance metadata, and validation
before it can be enabled.

## Processing and missing data

Each enabled source is retrieved by its source module, cached, reprojected or aggregated
with the shared regridding helpers, and written into the compact feature matrix. The
frontend loads only the compact matrix and provenance metadata. Source failures follow
the existing fallback chain; synthetic fallback layers remain explicitly marked in
`meta.json` and are not presented as direct activity evidence.
