# Space Apps 2026 submission text (paste-ready)

Challenge: **Identify Earth Locations that Analog the Permanent Moon Base Locations and Mars**.
Deadline: **Sun 15 Nov 2026, 23:59 SAST** (it can't be edited afterwards).

> Before pasting: fill in the `[TEAM: …]` placeholders, check the AI section matches what you actually did, and update the validation numbers if the basalt hot-fix has been published (copy them from `pipeline/report.md`). Every link below is public, with no login.

---

## Project Name

Terrestrial Analog Finder

## High-Level Project Summary

*(~150 words)*

Astronauts train, and rovers get tested, in places on Earth that resemble the Moon or Mars. Those analog sites are still chosen mostly by expert intuition. Terrestrial Analog Finder makes the choice measurable and searchable. We describe every one of Earth's 2.1 million land cells (0.1°, ~11 km) with 18 open data layers covering terrain, climate, soil, rock, ice, night lights and dust, mostly from NASA. We score each cell against six base and landing sites: the lunar south pole (Artemis), a lunar lava-tube mare, and Jezero, Gale, Arcadia Planitia and the north polar cap on Mars. Scoring runs live in the browser. Anyone can reweight factors, filter, and favour places far from today's known analogs. Each candidate explains itself in real units, gets a 30 m terrain close-up, and sits beside real Moon or Mars imagery. We also report honestly where the method works and where it doesn't.

## Link to Project "Demo"

[TEAM: paste the YouTube/Drive link to the ≤30 s video, or to the ≤7-slide deck]

## Link to Final Project

- Live app: https://site-comparer-thing.vercel.app
- Source code: https://github.com/PseudonymD/site-comparer-thing
- Guided tour (opens and plays automatically): https://site-comparer-thing.vercel.app/#tour

## Detailed Project Description

**What it does.** The app answers one question: *where on Earth is most like this place on the Moon or Mars?* It does this for six sites that space agencies are actually considering. It ranks all of Earth's land, lists the best candidate sites, and explains each one: which properties match the target, which don't, and by how much, in real units (°C, mm of rain per year, degrees of slope). A **Discoveries** tab lists 10 new candidates that the scoring picked by its own rule. To qualify, a site has to be in Earth's top 1% for a target and at least 500 km from every known analog. Southern African landscapes remain represented in the generated data and regional filtering. Every view can be shared as a link.

**How it works.**
1. An offline Python pipeline downloads each dataset, regrids it to a common 0.1° grid, and converts every value into its **Earth percentile**. For example, "steeper than 97% of Earth's land".
2. Each planetary target is described in the same 18 terms from published mission science (LOLA, Diviner, MOLA, Curiosity REMS, Perseverance MEDA, HiRISE/CRISM studies). Values beyond anything on Earth, like −120 °C or zero air, are clamped to Earth's extreme, so the question becomes *how close can Earth get?*
3. A Web Worker scores all 2.1 million cells in a few hundred milliseconds whenever a slider moves. The score is a weighted distance in percentile space, and the same formula is implemented in Python and TypeScript and checked against a shared test fixture. Neighbouring high-scoring cells are merged into candidate sites.
4. A site card shows the match breakdown, a live 30 m elevation close-up compared with the target's slope distribution, and NASA Moon/Mars Trek imagery side by side with Earth imagery.

**Is it valid?** We test whether famous analog sites outrank random land. Jezero (ROC-AUC 0.92) and Gale (0.94) work well: the Atacama, Death Valley and the Mars Desert Research Station all land in Earth's top 2%. The polar and ice targets are weaker (0.58–0.73). They find the Antarctic Dry Valleys (McMurdo ranks #26 of 2.1 million cells for the lunar south pole) but undervalue humid Arctic sites. The lava-tube target (0.63) waits on a real basalt layer. While building it we found and fixed a data bug: Antarctica had inherited peat-like soil carbon from gap-filling. We also corrected the Arcadia analog list, and we report the original list's score alongside the new one. The app shows these numbers in a badge on every target.

**Benefits.** Agencies and field teams get a transparent, reproducible shortlist and a way to defend site choices. Countries without famous analog sites, ours included, can find and characterise their own. Students and the public get an intuitive way into planetary science and Earth-observation data.

**Goals.** Make analog-site selection evidence-based and open. Next steps are absolute humidity, real lithology everywhere, finer grids for small features like lava tubes, and expert review of the Discoveries.

**Tools and languages.** Python (NumPy, SciPy, rasterio, GeoPandas) for the pipeline. TypeScript, Vite and MapLibre GL for the web app. Hosting is a static site on Vercel. The code is open source.

## NASA Data

Only sources that the published build actually uses are listed. `web/public/data/meta.json` records the source of every layer.

| NASA data | How we used it |
|---|---|
| **NASA POWER** climatology API (MERRA-2 / CERES based): T2M, T2M_RANGE, T2M_MIN, PRECTOTCORR, RH2M, ALLSKY_SFC_SW_DWN, https://power.larc.nasa.gov | Mean temperature, day–night range, coldest-month minimum, precipitation, relative humidity and sunlight for every land cell |
| **NASA GIBS** (Global Imagery Browse Services), MODIS Terra NDVI imagery (MODIS_Terra_L3_NDVI_Monthly, or the 16-day/8-day layer when unavailable), https://nasa-gibs.github.io/gibs-api-docs/ | Vegetation layer (colour-map decoded to NDVI) |
| **NASA GIBS**, MERRA-2 total aerosol optical thickness 550 nm, monthly (MODIS combined AOD as fallback) | Dust and aerosol layer |
| **NASA GIBS**, VIIRS Black Marble night lights | Remoteness and light-pollution layer (a brightness proxy, flagged in the app) |
| **SRTM** elevation (NASA/NGA), inside the AWS Terrain Tiles mosaic | Elevation, slope, roughness and relief at ~1 km, plus the 30 m terrain close-up |
| **NASA Moon Trek / Mars Trek** WMTS imagery (LRO WAC global mosaic; Viking MDIM 2.1 colour mosaic), https://trek.nasa.gov | Planetary terrain shown side by side with Earth candidates |
| **NASA mission science (published values)**: LRO LOLA and Diviner, LCROSS, Chandrayaan-1 M³ (NASA instrument), MGS MOLA, Mars Odyssey / MRO SHARAD studies, Curiosity REMS, Perseverance MEDA, MRO HiRISE/CRISM studies | Target values for the six Moon and Mars sites, with every value cited in `targets.json` and on the app's "How it works" page |

## Space Agency Partner & Other Data

**Data**
- ISRIC **SoilGrids 2.0**: topsoil organic carbon and sand fraction, CC-BY 4.0. https://soilgrids.org
- **AWS Terrain Tiles** (Mapzen/Tilezen Terrarium; SRTM, GMTED2010, ETOPO1, NED and others), open data. https://registry.opendata.aws/terrain-tiles/ (attribution: https://github.com/tilezen/joerd/blob/master/docs/attribution.md)
- **Natural Earth**: land, countries, glaciated areas, Antarctic ice shelves; public domain. https://www.naturalearthdata.com
- **GLiM** global lithological map (Hartmann & Moosdorf 2012, PANGAEA), CC-BY 3.0. Basalt layer, once the hot-fix is published. https://doi.org/10.1594/PANGAEA.788537 [TEAM: delete this line if basalt is still a placeholder at submission]
- **Macrostrat** geologic map API, CC-BY 4.0. Fallback basalt source. [TEAM: keep only if it was used]
- **Esri** World Imagery, World Dark Gray Canvas, World Boundaries and Places: basemaps and labels, attribution shown on the map.
- Known analog sites and planetary target values: published literature, cited in the app.

**Code libraries (open source)**
- Web: MapLibre GL JS 5.24 (BSD-3-Clause), Vite 6 (MIT), TypeScript 5.9 (Apache-2.0), Vitest 3 (MIT)
- Pipeline: NumPy, SciPy, rasterio, Shapely, GeoPandas, h5py (BSD); pyproj, pyogrio, pyhdf (MIT); Requests (Apache-2.0); Pillow (MIT-CMU); tqdm (MPL-2.0/MIT); pytest (MIT)
- Fonts: Bricolage Grotesque, Instrument Sans, Martian Mono (SIL Open Font License, via Google Fonts)

**Images.** All screenshots are of our own app. Planetary imagery is NASA's (Trek), Earth imagery is Esri's, and both are credited on screen. No NASA logos or insignia are used.

## Use of Artificial Intelligence

[TEAM: check every sentence describes what you actually did.]

We used Anthropic's **Claude**, through the **Claude Code** coding assistant, throughout the project.

- **AI-assisted.** Most of the code (the Python data pipeline, the TypeScript web app, the tests) was written by Claude under our direction. We reviewed it, ran it and tested it. Claude also drafted documentation, including parts of this submission text, the README and the demo script, which we edited. Claude helped diagnose problems: for example, it traced Arcadia Planitia's poor validation score to a soil gap-fill bug in Antarctica and to two misplaced analog sites.
- **Human-designed.** We chose the challenge and the framing: finding analogs for actual planned Moon and Mars base sites, plus a southern Africa angle. We chose the method: percentile normalisation, clamping to Earth's range, a weighted distance, and a novelty bonus. We designed the validation (known analogs against random land, reported honestly, including weak targets), chose the target sites and set the default weights. The data pipeline was run on a team member's computer.
- **Checks.** Literature values come from cited papers, and the citations are listed in the app. Python and TypeScript scoring are cross-checked by a shared test fixture. Decisions are logged in `docs/decisions.md`.
- **Images and video.** No AI-generated images or video are used. [TEAM: if you add any, they need a visible "AI-generated" watermark.]
