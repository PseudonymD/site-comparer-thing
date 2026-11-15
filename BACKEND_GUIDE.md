# Backend Guide: Terrestrial Analog Finder

Read time: about 20 minutes. Everything here comes from reading the code in this repository. Where I could not confirm something, it is listed in [section 9](#9-what-i-could-not-verify).

---

## 1. The most important thing to know

**This project has no server backend.** There is no API, no database, no login, and no code that runs on a server when someone visits the site. The site is a set of static files.

The "backend" is two things:

1. **A Python data pipeline** (`pipeline/`) that you run on your own computer, occasionally. It downloads NASA and other open datasets, cleans them, and produces a handful of data files.
2. **A scoring engine that runs inside the visitor's browser** (`web/src/worker.ts`, `web/src/scoring.ts`). It loads those data files and calculates scores live.

Why it was built this way: the data changes rarely (it only changes when you re-run the pipeline), but the scoring has to react instantly when a user moves a slider. Doing the scoring in the browser means no server cost, no waiting for network round trips, and nothing to keep running. The repo's own notes say a backend was deliberately declined (`docs/decisions.md`, item 39).

The goal of the app: for every land location on Earth (about 2.14 million cells), measure how closely it resembles a chosen Moon or Mars site. These look-alike places are called **terrestrial analogs**. Astronauts and rovers are tested in them.

---

## 2. Architecture

```
  YOU, occasionally, on your computer                    EVERY VISITOR, in their browser
 ┌──────────────────────────────────────┐              ┌───────────────────────────────────────────┐
 │  Python pipeline  (pipeline/)         │              │  Web app (web/)                            │
 │                                       │              │                                            │
 │  NASA / ISRIC / AWS / ... downloads   │              │  main.ts   UI + state                      │
 │        │                              │              │     │  ▲                                   │
 │        ▼                              │   commit     │     ▼  │ messages                          │
 │  18 layers on a 0.1° grid             │   to git     │  worker.ts  (background thread)            │
 │        │                              │  ─────────►  │     scoring.ts: the maths                  │
 │        ▼                              │  web/public/ │     │                                      │
 │  percentile-normalised, 1 byte each   │    data/     │     ▼                                      │
 │        │                              │      │       │  map image + ranked candidate sites        │
 │        ▼                              │      │       │                                            │
 │  features.bin.gz, meta.json, ...      │      │       │  MapLibre map draws the result             │
 └──────────────────────────────────────┘      │       └───────────────────────────────────────────┘
                                                ▼                         ▲
                                   Vercel serves the files as             │ fetch() at page load
                                   plain static files  ──────────────────┘
```

| Part | Technology | Runs where | Runs when |
|---|---|---|---|
| Data pipeline | Python 3.10–3.13, numpy, scipy, rasterio, geopandas, requests | Your computer (or Docker) | When you refresh the data |
| Data files | Binary (`.bin.gz`) and JSON, committed to git | `web/public/data/` | Always there |
| Scoring engine | TypeScript, run in a Web Worker | The visitor's browser | On every change a user makes |
| UI and map | TypeScript, Vite, MapLibre GL | The visitor's browser | While the page is open |
| Hosting | Vercel (static files only) | Vercel's servers | Serves files, runs no code of ours |

**Web Worker**: a browser feature that runs JavaScript on a separate thread. Scoring 2 million cells takes a few hundred milliseconds. If that ran on the main thread, the page would freeze. In a worker the sliders stay smooth.

**Not present** (checked): no database, no REST or GraphQL API we wrote, no authentication, no server-side code, no user data collection. The only secret is an optional NASA Earthdata token used by the pipeline.

---

## 3. The workflow, step by step

### Workflow A: building the data (offline, you run it)

```
python -m pipeline run        → downloads, processes, writes pipeline/output/data/
python -m pipeline publish    → copies the files into web/public/data/
git add / commit / push       → Vercel rebuilds the site with the new data
```

The `run` command (`pipeline/run.py`) does this:

```
1. Make a global grid (0.1° x 0.1°, 3600 x 1800 cells) and a land mask
2. For each of 18 features, get the numbers from a data source and resample to the grid
3. Normalise every feature into "Earth percentiles" (0..255, one byte)
4. Write features.bin, cells.bin, countries.bin, meta.json
5. Build the Moon/Mars target vectors → targets.json
6. Write the known analog sites → known_analogs.json
7. Validate: do the known analogs actually score high?  → validation.json, report.md
```

It is **resumable**: each finished step leaves a marker file in `pipeline/cache/`, so a crashed or interrupted run continues instead of restarting (`util.py`: `is_done`, `mark_done`). A full run takes hours and 10–25 GB of disk because it downloads large datasets.

### Workflow B: a visitor uses the site

```
Visitor opens the site
   │
   ▼  1. Vercel sends the HTML/JS, then the browser fetch()es the data files       (data.ts)
   │
   ▼  2. main.ts creates the Web Worker and hands it the big arrays                (main.ts)
   │     worker precomputes distance from every cell to the nearest known analog   (worker.ts init)
   │
   ▼  3. User picks a target (e.g. "Mars – Jezero") or moves a weight slider
   │     main.ts sends a "score" message: target, weights, filters, ...
   │
   ▼  4. Worker scores every cell, builds a map image and the top candidate sites   (worker.ts, scoring.ts)
   │     and posts the result back
   │
   ▼  5. main.ts gives the image to MapLibre and fills the candidate list
   │
   ▼  6. User clicks a cell → worker returns that cell's 18 values → "dossier" panel
```

Step 1 in detail (`web/src/data.ts`): it downloads the small JSON files first (so the map and known-analog markers appear quickly), then streams the roughly 30 MB of grid data with a progress bar. The `.gz` files get a `?v=<generation time>` suffix because the host caches them for a year; a new pipeline run changes the suffix, so visitors get the fresh copy.

How the browser and worker "talk": by messages, not function calls.

```ts
// main.ts: ask the worker to score
worker.postMessage({ type: 'score', target: t.vector, weights: state.weights, filters, alpha, ... });

// worker.ts: answer
self.onmessage = (ev) => {
  if (ev.data.type === 'score') { /* compute, then */ self.postMessage(result); }
};
```

If the user drags a slider quickly, `main.ts` does not queue 100 requests. It keeps one request in flight and always sends the newest settings next (`requestScore` / `pump`).

---

## 4. The data

### Where it comes from

Each of the 18 features has a **list of sources, tried in order** (`pipeline/config.py`):

```python
Feature("temp_mean", "Mean temperature", "°C", ..., ("modis_lst", "power", "synthetic"), ...)
```

The pipeline tries `modis_lst` first (needs a NASA Earthdata token). If that fails or is skipped, it tries `power`. The last resort, `synthetic`, produces fake placeholder data so the app still runs. This is the **fallback chain** (`compute_feature` in `run.py`). It is a reasonable design for flaky downloads, but it means you must check which source was actually used. That is recorded per feature in `meta.json`.

In the current published data (`meta.json`), nothing is synthetic. Several features used their fallback because no Earthdata token was set: temperature (NASA POWER), NDVI, ice, night lights and aerosols (NASA GIBS or GLiM).

| Group | Features | Main sources |
|---|---|---|
| Terrain | elevation, mean slope, slope p90, roughness, relief | AWS Terrain Tiles |
| Climate | mean/min/range temperature, precipitation, humidity, solar | NASA POWER |
| Surface | vegetation (NDVI), soil carbon, sand, basalt, ice | NASA GIBS, ISRIC SoilGrids, GLiM geology map |
| Remoteness | night-time light, aerosol/dust | NASA GIBS (Black Marble, aerosol) |

The Moon/Mars side is **not downloaded**. `pipeline/targets.py` contains hand-entered values from published papers (e.g. Lunar south pole mean slope, Mars Jezero temperatures), each with a citation key.

### The grid

Everything is resampled onto one global grid so layers line up. Cell number = `row * 3600 + col`, row 0 at the north (`grid.py`). Only **land** cells are kept (about 2.14 million).

### Normalisation: why everything becomes a percentile

Features have different units (metres, °C, mm/year). You cannot subtract metres from degrees. So each feature is converted to its **Earth percentile**: "this cell is higher than 73% of all land" becomes 0.73 (`normalize.py`, class `EarthCDF`). Now every feature lives on the same 0–1 scale and can be compared and weighted.

Planet values go through the same conversion, clamped to Earth's range first: `t = percentile(clamp(planet_value))`. A lunar temperature of −230 °C is colder than anywhere on Earth, so it becomes "as cold as Earth gets". The question the app really asks is *"how close can Earth get?"*

### How it is stored

A percentile in 0–1 is stored as **one byte** (0–255) to save space:

```
features.bin.gz : [cell0: f0 f1 ... f17][cell1: f0 ... f17]...   (2.14 M cells x 18 bytes, ~27 MB gzipped)
cells.bin.gz    : the grid index of each land cell (uint32)
countries.bin.gz: country id of each land cell (1 byte)
```

Cell-major order (all 18 values of one cell together) makes scoring fast, because the loop reads one contiguous run of memory per cell.

### The published files (`web/public/data/`)

| File | Contents | Made by |
|---|---|---|
| `features.bin.gz`, `cells.bin.gz`, `countries.bin.gz` | The grid data above | `run` |
| `meta.json` | Feature names, units, sources, coverage notes, the 101 percentile breakpoints per feature (to convert a percentile back to real units) | `run` |
| `targets.json` | The 6 target sites: percentile vector, raw values, references | `run` (from `targets.py`) |
| `known_analogs.json` | 17 famous analog sites (Atacama, Dry Valleys, Hawaii lava tubes...) | `run` (from `analogs.py`) |
| `validation.json` | How well the known analogs score | `run` (`validate.py`) |
| `discoveries.json`, `spotlight.json` | Headline "new" places | `publish` (`discoveries.py`) |

These are plain files committed to git. Large (about 60 MB), but simple: the hosting needs nothing but a file server.

### Missing data

Gaps are handled per source inside the pipeline (nearest-neighbour fill, or a documented rule). How much was filled is saved in `meta.json` (`coverage`, `notes`). Two known cases: SoilGrids has no soil under ice sheets, and the pipeline stored 0 there (30% of land cells). The browser engine detects those cells and **skips** the soil layers there instead of scoring them as zero (`noSoilMask` in `scoring.ts`). Details and one remaining case (NDVI over ice) are in `docs/weights.md`.

---

## 5. The core logic

### The score

For one cell and one target, with `z` = the cell's percentile for each feature, `t` = the target's percentile, `w` = the weight:

```
score = 1 − sqrt( Σ w·(z − t)²  /  Σ w )
```

Read it as: *measure the gap on each feature, square it so big gaps count extra, weight it by importance, average, and flip it so 1 = perfect twin.* (This is a weighted root-mean-square distance.) It is documented in `docs/scoring.md` and mirrored in Python (`pipeline/scoring.py`) and TypeScript (`web/src/scoring.ts`). A shared test fixture checks that both give identical numbers.

Tiny worked example (made-up numbers): weights `[2,1,1]`, target `[0.9, 0.2, 0.5]`, a cell `[0.8, 0.4, 0.5]`.
Gaps: 0.1, 0.2, 0 → `2·0.01 + 1·0.04 + 0 = 0.06` → `0.06 / 4 = 0.015` → `sqrt = 0.122` → **score 0.878**.

### Why it is fast: the lookup table

A byte can only be one of 256 values, so the engine precomputes each feature's answer for all 256 possibilities once per request, then scoring a cell is just 18 table lookups and additions:

```ts
// scoring.ts
lut[f * 256 + q] = (w * (q/255 - t) ** 2) / wsum;     // built once per request
...
for (let f = 0; f < F; f++) s += lut[(f << 8) + q[base + f]];   // per cell
out[i] = 1 - Math.sqrt(s);
```

2 million cells x 18 lookups is about 40 million operations, which finishes in a fraction of a second.

### Weights and the six scoring modes

Weights say how much each feature matters. `web/src/presets.ts` holds six default sets: Moon and Mars, each with *Exploration*, *Direct Comparison* and *Direct + Earth Factors*. Each set adds up to 100. A switched-off feature has weight 0, so it adds nothing and the rest are re-divided automatically (that is the `Σ w` in the formula). The user's saved edits are stored in the browser's `localStorage`, not on a server. Reasons for each weight: `docs/weights.md`.

### Filters, novelty and candidate sites

- **Hard filters** ("exclude ice", "exclude vegetation"): cells past a limit get score 0. Implemented by setting that feature's table entries to infinity.
- **Novelty** ("favour new places"): at start-up the worker calculates each cell's distance to the nearest known analog. A slider blends this in: `blended = (1−a)·score + a·novelty`. This pushes results away from sites that are already famous.
- **Candidate list**: the worker takes roughly the best 6000 cells, groups touching cells into blobs (a "union-find" merge over the 8 neighbours), and reports each blob's best cell. Those are the numbered circles on the map.
- **Map image**: scores are turned into colours and drawn into one world-sized PNG that MapLibre lays over the map.

### Validation

`validate.py` asks: *do the known analog sites rank above random land?* It uses ROC-AUC (probability that a known analog outscores a random cell: 0.5 is chance, 1.0 is perfect). The repo itself notes this is a sanity check, not an independent test, because the known analogs were chosen by the authors. The in-app badge is now recomputed live in the worker for the weights in use.

---

## 6. Key files

### Python pipeline (`pipeline/`)

| File | What it does |
|---|---|
| `cli.py`, `__main__.py` | The command line: `doctor`, `run`, `status`, `publish`, `patch`, `discoveries`, `assets` |
| `run.py` | The main recipe (section 3A). Tries each source, caches results, calls everything below |
| `config.py` | The list of 18 features and their source chains. **Order here = byte order on disk** |
| `sources/*.py` | One adapter per dataset (`power.py`, `terrain.py`, `soilgrids.py`, `glim.py`, ...). Each downloads and returns a grid. `synthetic.py` is the fake fallback |
| `grid.py` | The 0.1° grid and coordinate helpers |
| `normalize.py` | Converts values to percentiles and bytes, writes the binary files |
| `targets.py` | Hand-entered Moon/Mars values and their citations |
| `analogs.py` | The known analog sites |
| `scoring.py` | Reference version of the score formula |
| `validate.py` | The ROC-AUC check, writes `report.md` |
| `discoveries.py` | Picks headline new sites from the published data |
| `util.py` | Downloads with retries, cache markers, `.env` token reading, logging |

### Web app (`web/src/`)

| File | What it does |
|---|---|
| `data.ts` | Downloads and unpacks the data files |
| `main.ts` | Owns the app state, creates the worker, wires every panel and the URL link state |
| `worker.ts` | Holds the big arrays, scores cells, builds the image and candidates, answers cell lookups |
| `scoring.ts` | The formula, lookup table, filters, no-soil skipping |
| `presets.ts` | The six default weight sets, saving and loading them |
| `map.ts` | MapLibre map, markers, score overlay |
| `links.ts` | Shareable links: settings are stored in the URL `#...` part |
| `ui/dossier.ts` | The side panel for a clicked location |
| `drill.ts` | The optional "terrain close-up" |
| `settings.ts`, `start.ts` | Settings page (theme, weights) and start screen |

---

## 7. Connections: what talks to what

| Connection | When | How |
|---|---|---|
| Pipeline → NASA POWER, GIBS, AWS tiles, SoilGrids, GLiM, Macrostrat, Earthdata | Only when you run the pipeline | HTTP downloads with retries (`util.download`, `get_json`) |
| Pipeline → `web/public/data/` | `publish` command | File copy |
| Browser → your hosting (Vercel) | Page load | `fetch()` of static JSON and `.gz` files |
| Browser ↔ Worker | Constantly | `postMessage` |
| Browser → map tiles (Esri) and labels | While using the map | Image requests, no key |
| Browser → AWS elevation tiles | Only when the user presses "Run terrain close-up" (`drill.ts`) | `fetch()` from the browser |
| Browser → NASA Trek tiles | Only when the user opens the Moon/Mars "side by side" (`ui/planet.ts`) | Image requests |
| Browser → `localStorage` | Settings and saved weights | Browser storage on the user's own device |
| Database | **None** | n/a |

Hosting is Vercel, configured by `web/vercel.json` (build command, and long cache headers for data files). Deploys happen on push to `main`.

---

## 8. If someone asks you...

- **"What is the backend?"** An offline Python pipeline that prepares data, plus a scoring engine that runs in the browser. There is no live server.
- **"Where is the database?"** There isn't one. The data is binary and JSON files in git, loaded into browser memory.
- **"How can it recalculate instantly?"** Percentile bytes, a 256-entry lookup table per feature, and a Web Worker.
- **"Why percentiles?"** So different units can be compared and weighted on a common 0–1 scale.
- **"How are Moon and Mars represented?"** As a vector of target percentiles, built from published values and clamped to Earth's range.
- **"What happens if a data source is down?"** The pipeline falls to the next source in that feature's chain, ending at synthetic placeholders, and records which was used.
- **"How do you update the data?"** Run `pipeline run`, then `publish`, then commit and push.
- **"Is the score scientifically proven?"** No. The repo is open about this: it is a screening tool, the validation is a sanity check, and weights are expert judgement.

---

## 9. What I could not verify

- **`pipeline/patch.py`** (recompute only some features on top of published data): I read its description in the CLI help but did not trace its code.
- **Each individual source adapter**: I read the shared structure (`sources/__init__.py`, `run.py`, `power.py`'s header) but not the internals of every adapter.
- **Python scoring vs the browser scoring**: the formula matches and a fixture test exists, but the Python side does not yet have the browser's skip-the-soil-layers rule or the six-mode weights. `validate.py` and `discoveries.py` still use the original per-target weights from `targets.py`.
- **Whether the automated tests run in CI**: `README.md` says GitHub Actions was unavailable, so tests probably need to be run by hand (`npm test` in `web/`, `python -m pytest pipeline/tests`). I did not run the Python tests.
- **Vercel project settings**: only `web/vercel.json` is in the repo. Dashboard settings can't be seen from the code.
- **Real-world accuracy of the data**: I checked how the data is built and handled, not whether each downloaded dataset is correct.
