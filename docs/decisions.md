# Decisions log

Reasonable calls made during the build, as asked for in the brief. Nothing here adds a backend or a paid service, and none of the 18 features was dropped.

## Data & pipeline

1. **Data is published gzip-compressed** (`features.bin.gz`, `cells.bin.gz`, `countries.bin.gz`). The raw layout is exactly as specified: uint8 cell-major `[cell][18]` and uint32 grid indices. GitHub Pages does not gzip binary files, so this saves ~40% of the download. The browser decompresses with `DecompressionStream`, and the loader also accepts uncompressed files. `python -m pipeline publish` copies only the `.gz` files and the JSON.
2. **Extra file `countries.bin`** (uint8 per land cell → index into `meta.countries`) handles offline reverse geocoding. It is built from Natural Earth admin-0 50m. Coastal cells whose centre falls in the sea take the nearest country.
3. **Land mask** = Natural Earth 10m land rasterised at 0.02° and averaged to 0.1°. Cells with ≥ 50% land count as land, which gives 2,143,220 cells. A 0.1° copy of the land fraction and country index is committed in `pipeline/assets/` (≈250 kB), so the pipeline and synthetic generator work offline. Ice stays a feature, not a mask.
4. **Terrain is computed in 10°×10° grid blocks** from Terrarium tiles at zoom 7 (≈1.2 km pixels at the equator). Each block mosaics only its tiles plus a 1-pixel margin, so cells never straddle chunks and p90 / max−min are exact per cell. Tiles with no land are never downloaded. TRI uses the Wilson et al. (2007) mean-absolute-difference form. Sea pixels (< −10 m) are ignored in cells that also contain land. Web Mercator ends at ±85.05°, so cells beyond that (inner Antarctic plateau) copy the nearest valid row.
5. **dask/rioxarray/xarray were not needed**: block processing with numpy keeps memory under ~3 GB, so they are not in `requirements.txt` (fewer install problems on Windows). `scipy` (resampling, nearest fill) and `h5py` (Black Marble / MERRA-2 HDF5) were added. Both are wheel-only. `pyhdf` is optional and reads MODIS HDF4. The rasterio wheels have no HDF4 driver, and pyhdf has no wheel for Intel Macs, so MODIS falls back automatically there.
6. **NASA POWER** is fetched through the *regional* climatology endpoint in 10°×10° boxes, one parameter per request, only for boxes with land, and cached as JSON. Temperatures are downscaled to the 0.1° DEM with a 6.5 K/km lapse rate when POWER reports grid-point elevations. "Annual min temperature" = coldest monthly mean of T2M_MIN. Precipitation is converted from mm/day to mm/yr.
7. **GIBS fallbacks** decode imagery back to values by inverting the layer's published colormap (nearest colour). Black Marble has no colormap, so the night-lights fallback is image luminance. It is flagged `proxy: true` and shown with a PROXY badge.
8. **MODIS NDVI** uses four seasonal months (Jan/Apr/Jul/Oct 2023) to cover both hemispheres' growing seasons with ~0.7 GB of downloads instead of 2 GB. MODIS LST uses all 12 months (needed for the coldest month).
9. **Ice fallback chain**: MCD12C1 class 15 → GLiM `ig` → Natural Earth glaciated areas + Antarctic ice shelves. Natural Earth leaves out the Antarctic ice sheet itself, so land south of 60°S counts as ice except the McMurdo Dry Valleys box. The real ice-free oases are below 0.1° resolution.
10. **GLiM** is ~1 GB and its PANGAEA URL may change. The module also accepts a manually downloaded copy anywhere under `pipeline/cache/glim/` or `GLIM_PATH`.
11. **Synthetic layers**: a source that fails falls back down its chain. The last resort is a physically motivated synthetic layer driven by latitude, real elevation and smooth noise, flagged in `meta.json` and the UI. The frontend is never blocked.
12. **Quick mode** (`--quick`): 0.5° grid, terrain zoom 4, US South-West bbox. This bbox contains Death Valley, the MDRS, Meteor Crater and Black Point, so the validation step has known analogs to test. In bbox runs, percentiles are relative to the bbox (`normalisation_domain: bbox_land`), and `publish` refuses them unless `--allow-bbox` is passed.

## Targets

13. **Target values come from the literature with citations** in `targets.json` (`raw[*].refs` + `references`). No automated LOLA/MOLA DEM extraction is done: the global products are many GB and the useful polar tiles have unstable URLs. Terrain targets are stated at the ~1 km baseline of the Earth features.
14. **Elevation as an atmosphere proxy**: vacuum targets (Moon) map to Earth's highest terrain, Mars targets to 4500 m (Altiplano-class plateaus, classic low-pressure / high-UV analogs). Default weight is low (0.5).
15. **High-resolution slope histograms** for the 30 m drill-down are lognormal fits to the literature median and p90 slopes at 20–30 m baselines. They are labelled as such in the UI.
16. **Validation** takes a site's score as the best cell within ±2 cells (~±20 km) of its published coordinates. Published coordinates are approximate, and coastal sites often fall in an ocean cell. Random land cells get the same treatment, so the comparison stays fair.

## Web

17. **Score overlay**: the worker paints a Web-Mercator RGBA image (one column per grid column, mercator-spaced rows) and encodes it to PNG with `OffscreenCanvas`. A MapLibre `image` source displays it. A `canvas` source would skip the PNG step, but its texture upload rendered black under software WebGL during testing. The PNG round trip costs ~100–150 ms and stays within the 500 ms budget.
18. **Basemaps**: Esri World Imagery (default, satellite) and Esri Dark Gray Canvas (toggle), with Esri Boundaries and Places for labels, all free with attribution (CARTO was dropped when its tiles began requiring an API key). **Globe** projection is a toggle (MapLibre v5). Flat Mercator is the default because it reads better on a projector.
19. **Colour stretch**: colours span the chosen Earth percentile (default p50) to the maximum of the current score distribution. Without this, scores bunch up in 0.6–0.9 and the map looks flat.
20. **Novelty** is precomputed once per cell in the worker. The 16 known analogs are fixed, so slider changes cost nothing extra.
21. **Pinned versions** older than two weeks at build time: maplibre-gl 5.24.0, vite 6.4.5, TypeScript 5.9.3, vitest 3.2.7.
