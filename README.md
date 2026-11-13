# Terrestrial Analog Finder

**NASA Space Apps Challenge 2026: Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars**

Astronauts train, and rovers get tested, in places on Earth that resemble the Moon or Mars. Until now those analog sites have been chosen by expert intuition. Terrestrial Analog Finder describes **every one of Earth's ~2.1 million land cells (0.1°)** with **18 open data layers**: terrain, climate, surface, geology and remoteness, from NASA and partner agencies. It scores each cell against six planetary targets: the lunar south pole (Artemis), a lunar mare lava tube, and Mars' Jezero crater, Gale crater, Arcadia Planitia and the north polar deposits. Scoring runs live in your browser. You can reweight any factor, apply hard filters, and boost *novelty* to surface new candidates far from today's known analogs. Each candidate comes with an explanation and a 30 m terrain drill-down.

**Live demo:** https://pseudonymd.github.io/site-comparer-thing/ (published by GitHub Actions on every push to `main`)

![Screenshot](docs/screenshot.png)

## How it works

1. **Offline pipeline (`pipeline/`, Python).** Fetches and caches each dataset, regrids it to a 0.1° EPSG:4326 grid, masks the ocean, and converts every feature to its **Earth-land percentile**. It quantises the results to `uint8` and writes `web/public/data/` (≈26 MB gzipped). It also builds target vectors from the literature, the known-analog list and a validation report (`pipeline/report.md`).
2. **Static web app (`web/`, Vite + TypeScript + MapLibre GL).** A Web Worker holds the feature matrix and re-scores all cells in a few hundred milliseconds whenever a control changes. It paints the map, clusters the top cells into sites, and powers the site card and the drill-down.
3. **Scoring.** The score is a weighted distance in percentile space: `S = 1 − √(Σ w (z − t)² / Σ w)`. Target values beyond Earth's range are clamped first, so the question becomes *how close can Earth get?*. See [`docs/scoring.md`](docs/scoring.md). Python and TypeScript implementations are checked against a shared fixture.

## Run the pipeline

See **[`pipeline/README.md`](pipeline/README.md)** for the step-by-step guide (Windows, macOS/Linux or Docker). In short:

```bash
bash pipeline/setup.sh
```

```bash
source .venv/bin/activate
```

```bash
python -m pipeline doctor
```

```bash
python -m pipeline run --quick
```

```bash
python -m pipeline run
```

```bash
python -m pipeline publish
```

## Run the web app locally

```bash
cd web
```

```bash
npm install
```

```bash
npm run dev
```

Tests: `npm test` (web) and `python -m pytest pipeline/tests` (pipeline).

## Data sources

| Feature(s) | Preferred source | No-login fallback | Licence |
|---|---|---|---|
| Elevation, slope (mean, p90), roughness (TRI), local relief | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium; SRTM, GMTED, ETOPO1, NED…) | same | Open data, see [attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) |
| Mean / diurnal-range / minimum temperature | [MODIS MOD11C3 v061](https://doi.org/10.5067/MODIS/MOD11C3.061) | [NASA POWER](https://power.larc.nasa.gov/) T2M, T2M_RANGE, T2M_MIN | NASA open data |
| Precipitation, humidity, solar irradiance | [NASA POWER](https://power.larc.nasa.gov/) PRECTOTCORR, RH2M, ALLSKY_SFC_SW_DWN | same | NASA open data |
| Vegetation (NDVI) | [MODIS MOD13C2 v061](https://doi.org/10.5067/MODIS/MOD13C2.061) | [NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/) NDVI (colormap-decoded) | NASA open data |
| Soil organic carbon, sand fraction | [ISRIC SoilGrids 2.0](https://soilgrids.org) (5 km) | same | CC-BY 4.0 |
| Basaltic / volcanic fraction | [GLiM](https://doi.org/10.1594/PANGAEA.788537) (Hartmann & Moosdorf 2012) | same | CC-BY 3.0 |
| Permanent ice / snow | [MODIS MCD12C1 v061](https://doi.org/10.5067/MODIS/MCD12C1.061) class 15 | GLiM "ig", then [Natural Earth](https://www.naturalearthdata.com/) glaciated areas | NASA open data, CC-BY 3.0, public domain |
| Light pollution | [NASA Black Marble VNP46A4](https://blackmarble.gsfc.nasa.gov/) | NASA GIBS VIIRS Black Marble (brightness proxy) | NASA open data |
| Aerosol / dust AOD | [MERRA-2 M2TMNXAER](https://doi.org/10.5067/FH9A0MLJPC7N) | NASA GIBS AOD (colormap-decoded) | NASA open data |
| Land mask, countries | [Natural Earth](https://www.naturalearthdata.com/) 10m land, 50m admin-0 | – | Public domain |
| Planetary targets | Literature values: LOLA, Diviner, MOLA, REMS/MEDA, HiRISE/CRISM studies (citations in `targets.json` and on the About page) | – | – |
| Basemaps | Esri World Imagery, Esri Dark Gray Canvas, Esri Boundaries and Places labels | – | Attribution shown on map |

`meta.json` records which source was used for each feature. Synthetic placeholders appear only if a source was unreachable, and each one is flagged in the data and the UI.

## Repository layout

```
pipeline/   Python data pipeline (sources/, run.py, cli.py, tests/, README.md)
web/        Vite + TypeScript + MapLibre web app (src/, public/data/)
docs/       scoring spec, decisions log, demo script, fixtures
.github/    deploy.yml (Pages), release-data.yml (data as release assets), tests.yml
```

## Team

NASA Space Apps 2026 team: *add names here*.

Built with open data from NASA, ISRIC, PANGAEA, Natural Earth and AWS Open Data.
