# Scoring modes and default weights

Defaults live in `web/src/presets.ts` (`DEFAULT_TABLE`, `APPLICABILITY`). Weights are percentage points: in every
mode the enabled weights add up to exactly 100. A switched-off layer is weight 0 in the engine and the rest are
divided by their own sum, so it contributes nothing.

**What these numbers are.** No published source gives a weight vector for ranking Earth places against the Moon or
Mars. These are expert-judgement priors. Each layer's weight follows how much the analog and site-selection
literature relies on that property, how directly the Earth layer measures the same physical quantity, and how
strongly it overlaps with other layers. They were set before any validation run on them and were not fitted to the
known analogs.

## Sources consulted

| Topic | Source |
|---|---|
| What an analog is, and choosing analogs by the aspect of the body they represent | Lee et al., *Terrestrial analogs for lunar science and exploration: a systematic approach*, LPI 2008. https://www.lpi.usra.edu/meetings/leagilewg2008/pdf/4126.pdf |
| Analog sites as natural laboratories for geologic processes (Moon, asteroids) | NASA NTRS 20140012035. https://ntrs.nasa.gov/api/citations/20140012035/downloads/20140012035.pdf |
| Lunar site selection balances science value against safe landing | NASA NTRS 20230016267, *Lunar Site Selection*. https://ntrs.nasa.gov/api/citations/20230016267/downloads/Lunar%20Site%20Selection.pdf |
| Lunar surface temperatures (about 387–397 K at the equator by day, about 95 K before sunrise) | Williams et al. 2017, Icarus 283:300. http://ui.adsabs.harvard.edu/abs/2017Icar..283..300W/abstract |
| Polar cold traps and water ice (subsurface down to 38 K at the LCROSS site) | Paige et al. 2010, Science. https://www.usgs.gov/publications/diviner-lunar-radiometer-observations-cold-traps-moons-south-polar-region |
| Polar illumination (a Shackleton rim point is sunlit about 240 days a year) | Mazarico et al. 2011, Icarus 211:1066. https://ui.adsabs.harvard.edu/abs/2011Icar..211.1066M |
| Lunar lava-tube skylight, basaltic maria | Haruyama et al. 2009, GRL. https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2009GL040635 |
| Mars surface composition is basaltic or andesitic | Bandfield et al. 2000 (TES). https://gemelli.spacescience.org/jbandfield/publications/bandfield_global_TES.pdf |
| Mars landing-site engineering limits: elevation, relief, slope, rock, trafficable non-dusty ground | Golombek et al. 2012, Space Sci. Rev. https://pubs.usgs.gov/publication/70047380 |
| Mars dust optical depth at rover sites, dust storms | Lemmon et al. 2015, Icarus. https://ntrs.nasa.gov/api/citations/20150008268/downloads/20150008268.pdf |
| Mars water-ice clouds and snow from Phoenix lidar (precipitation exists, as ice crystals) | Whiteway et al. 2009, Science. https://pubmed.ncbi.nlm.nih.gov/19574386/ |
| Hyper-aridity is the reason the Atacama is used as a Mars analog | *The Atacama Desert in Northern Chile as an Analog Model of Mars*, Frontiers in Astronomy and Space Sciences 2021. https://www.frontiersin.org/articles/10.3389/fspas.2021.810426 |

Target values and their own references (Rosenburg 2011, Li 2018, Colaprete 2010, Martinez 2017, Farley 2022, ...)
are in `web/public/data/targets.json` (`references`). I did not re-read those papers for this change.

## What the data supports

- **Collinearity (computed on the 2.14 M land cells, Pearson r of the percentile scores).** The four terrain
  roughness layers overlap heavily: mean slope vs slope p90 0.99, vs roughness 0.90, vs relief 0.85. Mean, minimum
  and range of temperature overlap too: mean vs minimum 0.94, mean vs range 0.77. So terrain and temperature are
  given a family budget and split inside it, instead of letting four near-copies count as four separate findings.
- **Earth-only layers overlap with climate and ice.** NDVI vs precipitation 0.83, NDVI vs ice −0.78, aerosol vs ice
  −0.78. That is why the Earth block is capped at 12 of 100 points.
- **Missing data.** Layers with a `coverage` below 1 in `meta.json` are the two SoilGrids layers (68.4% / 68.6%).
  No other layer reports gaps. Details below.

## Default weights (percentage points)

`—` means the layer is switched off in that mode.

| Layer | Moon Exploration | Moon Direct | Moon Direct + Earth | Mars Exploration | Mars Direct | Mars Direct + Earth |
|---|---:|---:|---:|---:|---:|---:|
| Elevation | 3 | 4 | 3.5 | 3 | 4 | 3.5 |
| Mean slope | 6 | 8 | 7 | 5 | 7 | 6 |
| Slope p90 | 6 | 7 | 6 | 4 | 6 | 5.5 |
| Roughness (TRI) | 5 | 7 | 6 | 5 | 6 | 5.5 |
| Local relief | 7 | 8 | 7 | 6 | 7 | 6 |
| Mean temperature | 5 | 8 | 7 | 7 | 8 | 7 |
| Diurnal range | 6 | 9 | 8 | 4 | 6 | 5.5 |
| Annual min temperature | 12 | 10 | 9 | 7 | 8 | 7 |
| Precipitation | — | — | 3 | 5 | — | 4.5 |
| Relative humidity | — | — | 1.5 | 8 | 8 | 7 |
| Solar irradiance | 10 | 6 | 5.5 | 4 | 5 | 4.5 |
| Vegetation (NDVI) | — | — | 3 | — | — | 3.5 |
| Soil organic carbon | — | — | 1 | — | — | 1.5 |
| Sand / fine regolith | 8 | 9 | 8 | 5 | 7 | 6 |
| Basaltic / volcanic | 18 | 18 | 16 | 16 | 15 | 13 |
| Permanent ice / snow | 14 | 6 | 5 | 11 | 7 | 6 |
| Light pollution | — | — | 2.5 | — | — | 2.5 |
| Aerosol / dust AOD | — | — | 1 | 10 | 6 | 5.5 |
| **Layers on** | 12 | 12 | 18 | 15 | 14 | 18 |
| **Total** | 100 | 100 | 100 | 100 | 100 | 100 |
| Earth-only share | 0 | 0 | 12 | 5 (precip) | 0 | 12 |

A layer that a mode switches off keeps its Direct + Earth weight, so switching it on starts at a sensible value.

## Why these weights

**Direct Comparison (Moon).** Only layers that exist on both bodies. Terrain family 34 (slope, roughness, relief
30; elevation 4): slopes and relief are what site studies constrain first (Golombek 2012 for Mars; the same
quantities from LOLA for the Moon) and Earth DEMs measure the same quantity. Thermal family 27, split towards the
minimum (10) and diurnal range (9): with no atmosphere to buffer it, the thermal swing is the Moon's defining
property, but Earth can only approach it, so the targets are clamped to Earth's extremes and these layers find the
coldest, widest-swing land. Geology and regolith 27 (basalt 18, sand 9): mare basalt, lava tubes (Haruyama 2009) and
basaltic analog fields are the standard Earth stand-ins. Ice 6 and sunlight 6 are low because Earth ice sheets and
sea-level sunlight are weak stand-ins for lunar regolith ice and airless illumination. Elevation 4 is a pressure
stand-in only.

**Exploration (Moon).** Same 12 layers, with the exploration drivers raised: cold traps (annual min 12; Paige
2010), polar sunlight for power (solar 10; Mazarico 2011) and ice (14). Terrain, mean temperature and range are
lowered to pay for it. Humidity, aerosols and the other Earth-only layers stay off.

**Direct Comparison (Mars).** Terrain 30 including elevation 4 (Golombek 2012 limits). Temperature 22, lower than
for the Moon because Mars's air dilutes the thermal extremes and Earth's cold deserts get nearer. Basalt 15 (Bandfield
2000). Humidity 8 and dust 6: Mars has a measured atmosphere, so these are real physical measures and not Earth
factors. Ice 7, sand 7, solar 5. Rain, vegetation, soil carbon and artificial light are off.

**Exploration (Mars).** Dust 10 (global dust storms are the main atmospheric driver; Lemmon 2015), humidity 8, ice 11
(ground ice and polar deposits), basalt 16 (the only geology layer; there is no global Earth mineralogy layer, so
"mineralogy" is represented by basalt alone). Precipitation 5 is on here only as the hyper-aridity indicator that Mars
analog work uses for water (Atacama). Terrain is lowered to 23.

**Direct + Earth Factors.** Direct Comparison scaled to 88, plus 12 points of Earth conditions. Each direct weight is
within 20% of a pure rescale (checked in a test). On the Moon the Earth block is precipitation 3, vegetation 3,
light 2.5, humidity 1.5, soil carbon 1, aerosols 1. On Mars it is precipitation 4.5, vegetation 3.5, light 2.5,
soil carbon 1.5, and humidity and dust are already direct. Precipitation is heaviest on Mars because aridity is the
dominant Mars-analog criterion. No Earth factor outweighs any of the three heaviest physical layers.

## Measured zero, missing and not applicable

A target value of 0 in `targets.json` means different things. `APPLICABILITY` in `presets.ts` records which, per body
and layer, with a note:

| Kind | Meaning | Examples |
|---|---|---|
| measured | from spacecraft or literature | slopes, temperatures, Mars humidity and dust |
| proxy | Earth layer stands in for the property | elevation for air pressure, basalt for geology, sand for fines |
| absent | genuine physical zero | vegetation and artificial light on both bodies, Moon soil carbon |
| trace | near zero, not zero | Mars precipitation (ice-crystal snow, frost; no rain), Mars organics |
| inapplicable | the quantity does not exist there | Moon precipitation, humidity, aerosols (no atmosphere) |

Mars precipitation is therefore not treated as "no atmosphere": the Mars target is the driest Earth value, which
expresses hyper-aridity. Humidity and dust on Mars are measurements.

**Missing values are never read as zero**, in three places:

1. *Target side.* A target value that is not a finite number removes that layer from the score for that target and
   the rest renormalise (`targetUsable`). None are missing in the shipped targets; the guard is tested.
2. *Cell side, soil.* The pipeline wrote 0 for sand and soil carbon where SoilGrids has no soil (30.3% of land cells,
   almost all permanent ice; see the notes in `meta.json`). That is "no soil", not a measured zero. The browser
   engine finds those cells (both layers sitting at the lowest percentile level, which is a value of 0), and skips the
   two soil layers there. The remaining weights are renormalised. The dossier says so and shows "n/a (no soil)".
3. *Other layers.* The pipeline fills gaps by nearest neighbour or by documented rules per source
   (`pipeline/sources`), with coverage recorded in `meta.json`. NDVI over permanent ice, where the sensor returns
   nothing, is set to 0 (bare ground) by design (`gibs_ndvi.py`). That one is still a conversion of no-retrieval to 0 in
   the data and cannot be undone without re-running the pipeline.

## Units and normalisation

Every comparison is between percentile scores over Earth's land cells (z = Earth CDF of the value), so units cancel.
A target outside Earth's range is clamped to Earth's minimum or maximum before conversion (`beyond Earth` in the
UI). This means a clamped target can only say "as extreme as Earth gets" and cannot tell a very cold place from a
colder one. That is a limit of comparing against Earth only.

## Check against known analogs (not used to set weights)

Mean percentile of each target's known analogs among all land cells (AUC; `tests/presets-data.test.ts`):

| Target | Moon/Mars Exploration | Direct | Direct + Earth |
|---|---:|---:|---:|
| Moon South Pole | 0.77 | 0.76 | 0.79 |
| Moon Mare / lava tube | 0.71 | 0.67 | 0.62 |
| Mars Jezero | 0.78 | 0.76 | 0.83 |
| Mars Gale | 0.76 | 0.73 | 0.82 |
| Mars Arcadia | 0.63 | 0.63 | 0.68 |
| Mars North Polar | 0.62 | 0.64 | 0.68 |

These are lower than the 0.9+ the pipeline reported with the old per-target weights (`pipeline/report.md`). The old
weights gave 18 layers a heavy Earth-climate emphasis (vegetation 3.0, precipitation 2.5, humidity 1.5) and the known
analogs are famous deserts, so they scored high mostly by being dry and bare. Direct Comparison removes that on
purpose. The app's validation badge is now recomputed live for the mode in use.

## Not changed

`python -m pipeline` still scores and validates with the original per-target weights (`pipeline/targets.py`), so
`validation.json`, `discoveries.json` and `spotlight.json` are unchanged. The Python reference scorer does not know
about the per-cell soil exclusion. Regenerating them with the six modes needs a pipeline change and a full run.
