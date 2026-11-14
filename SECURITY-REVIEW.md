# Security and Codebase Audit

## Scope

Read-only audit of the frontend, offline Python pipeline, generated data contract,
scientific/geospatial logic, deployment configuration, and local tests. `.github`,
generated assets, dependencies, and GitHub Actions were excluded. No application
code or generated data was changed as part of the audit.

## Executive summary

The project is a static Vite/TypeScript application with a browser Web Worker for
scoring and an offline Python pipeline that publishes quantised global data. The
architecture is coherent and the scoring specification is shared between Python
and TypeScript. The main risks are credential handling in the Earthdata downloader,
inconsistent edge-case scoring, and expensive full-world recomputation on every
control change.

Overall assessment: **functional prototype / challenge submission quality**.
The deployment model is appropriate for a public demo, but the Earthdata
credential issue should be fixed before running the pipeline with a real token.

## Security findings

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| 1 | 🟠 HIGH | `pipeline/sources/earthdata.py` | 30-34, 78-79 | Earthdata bearer credentials are retained across redirects to any hostname ending in `nasa.gov`, which also matches attacker-controlled lookalikes such as `evilnasa.gov`. Download URLs come from CMR metadata and redirects are followed by the shared downloader, so a malicious URL or redirect could receive the token. | 9/10 |

### Recommended security remediation

Restrict credential forwarding to an explicit allowlist of trusted Earthdata
hosts, or require a dot-delimited suffix such as `.nasa.gov` plus an allowlist
for the known DAAC/URS hosts. Validate every redirect destination before
forwarding `Authorization`.

## Confirmed correctness findings

| # | Severity | Location | Finding |
|---|----------|----------|---------|
| 2 | 🟡 MEDIUM | `web/src/scoring.ts:19-25`; `pipeline/scoring.py:19-23`; `docs/scoring.md` | The documented all-zero-weight behavior is inconsistent: Python returns score 0, while the TypeScript LUT path returns score 1 for every cell. The UI permits every weight slider to be set to zero. |
| 3 | 🟡 MEDIUM | `web/src/worker.ts:101-119` | When a rectangular `safrica` region is active, `regHist` is used for candidate extraction but `hist`, `valid`, percentile stretch, and legend counts still include cells outside the region. The UI therefore reports global counts while saying the list is region-scoped. |
| 4 | 🟡 MEDIUM | `web/src/ui/dossier.ts:34` | A country- or region-filtered cell has `info.blended === 0`, so `info.blended || s` falls back to its unfiltered raw score when computing the displayed percentile. A filtered cell can therefore be labelled “top X%” despite being excluded from the current result set. |
| 5 | 🟡 MEDIUM | `pipeline/discoveries.py:247-269` | Discovery generation assumes both the Southern Africa spotlight box and every local-place window contain cells. Regional/bbox outputs can make `box_idx` or `win` empty, causing `argmax`/`max` to raise instead of producing a controlled result. |
| 6 | 🟡 MEDIUM | `pipeline/sources/naturalearth.py:94-105` | The committed country raster is sliced from global row/column zero even when a non-global processing bbox is requested. Since `Grid` remains global-shaped and the bbox is a mask, this can associate bbox cells with incorrect countries in bbox pipeline runs. |

## Lower-severity and resilience findings

| # | Severity | Location | Finding |
|---|----------|----------|---------|
| 7 | ⚪ LOW | `web/src/map.ts:135-137` | Known-analog metadata is interpolated into MapLibre popup HTML without escaping. The current generated data is repository-controlled, but a compromised published data artifact would become an XSS path. |
| 8 | ⚪ LOW | `web/src/ui/fingerprint.ts:6-22`; caller `web/src/ui/dossier.ts:84` | The fingerprint `aria-label` is interpolated without escaping. It currently receives target metadata from published JSON; escaping should be enforced at the renderer boundary. |
| 9 | ⚪ LOW | `web/src/worker.ts:37-54`, `web/src/worker.ts:84-167` | Initial novelty distance construction and each score request scan roughly 2.1 million cells. Image painting also loops over a full 3600-column raster. This is acceptable on a strong desktop but can cause long interaction stalls or memory pressure on mobile devices. |
| 10 | ⚪ LOW | `pipeline/run.py:79-126` | Source adapters catch every exception and silently continue through fallback chains. This is useful operationally, but programming errors can be hidden behind synthetic data unless logs and metadata are checked carefully. |

## Architecture

- **Frontend:** Vite, strict TypeScript, MapLibre GL JS, static HTML/CSS, and a
  module Web Worker.
- **Runtime data flow:** `web/src/data.ts` fetches JSON and compressed binary
  arrays; the worker owns feature arrays, novelty distances, scoring, histograms,
  raster generation, and site clustering.
- **Pipeline:** Python fetches/caches sources, regrids them onto a global
  EPSG:4326 grid, masks land, normalises each feature into Earth percentiles,
  quantises to `uint8`, and writes `web/public/data`.
- **Deployment:** Vercel serves a static Vite build. There is no runtime backend,
  database, or application API.

The separation is appropriate for a public, read-heavy demo. The main coupling is
the duplicated scoring implementation and the published binary schema; both have
tests and documentation, but edge-case parity is incomplete.

## Scientific and geospatial assessment

Strengths:

- The score is explicitly defined and mirrored in Python and TypeScript.
- Target values are cited and clamped to the Earth feature range.
- Synthetic and proxy layers are surfaced in metadata and UI.
- The validation report openly states that the analog lists are author-selected
  and that post-result changes are not a blind test.
- Country IDs come from Natural Earth and geography filters use stable ISO codes.

Limitations:

- A 0.1-degree cell is approximately 11 km north/south and is much smaller east/
  west near the poles; current percentile and random-baseline statistics count
  cells rather than area.
- Elevation is used as a thin-atmosphere/vacuum proxy rather than a physical
  atmospheric measurement.
- Relative humidity penalises cold dry environments; absolute humidity would be
  more physically meaningful for several targets.
- Mixed source semantics (surface MODIS LST versus 2 m POWER air temperature)
  reduce comparability when fallbacks are used.
- Terrain drill-down and planetary mosaics are useful context, not a substitute
  for mineralogy, regolith mechanics, subsurface ice, or local landing hazards.

## NASA challenge alignment

The project has strong alignment through NASA POWER/GIBS and Earthdata-capable
pipeline sources, NASA Moon Trek/Mars Trek imagery, planetary target references,
and an explainable Earth-to-target ranking. The strongest improvements would be
to replace proxy layers where possible, add area-weighted statistics, validate
against a genuinely held-out analog set, and add uncertainty/source-quality
propagation to rankings.

## Validation performed

- Frontend tests: **13 passed** (`cd web && npm test -- --run`).
- Frontend type check: **passed** (`cd web && ./node_modules/.bin/tsc --noEmit`).
- Pipeline tests: **28 passed**, 39 existing warnings, with pytest cache
  disabled.
- `git diff --check`: **passed**.
- The production build had already passed earlier in the implementation session;
  it was not rerun during this read-only audit because the Vite build writes
  generated output.

## Prioritised roadmap

### P0

1. Restrict Earthdata `Authorization` forwarding to trusted exact hosts and
   validate redirect destinations.

### P1

2. Make zero-weight behavior identical in Python, TypeScript, docs, and UI.
3. Make regional statistics and dossier percentiles use the same filtered
   population as candidate extraction.
4. Guard discovery generation against empty bbox/place windows.
5. Correct country-raster indexing for bbox runs and add a regression test.

### P2

6. Escape all data-derived HTML/SVG attribute content at renderer boundaries.
7. Add source-quality/uncertainty indicators to ranking and validation.
8. Add area-weighted percentiles and baselines as an optional scientific mode.

### P3

9. Reduce mobile recomputation cost through cached transforms, lower-resolution
   raster paths, or incremental scoring.
10. Add a held-out analog evaluation and reproducible published-data checksum
    verification.

## Final verdict

The application is a credible, well-documented geospatial challenge prototype
with a sound static-data architecture and transparent scientific caveats. It is
not ready for unattended pipeline use with production Earthdata credentials
until finding #1 is fixed. The remaining findings are primarily correctness,
edge-case, and mobile-performance work rather than architectural blockers.

The five most important changes are:

1. Fix Earthdata redirect credential handling.
2. Align zero-weight scoring behavior.
3. Align regional filtering statistics and dossier rank semantics.
4. Harden discovery and bbox generation.
5. Add escaping and published-data integrity checks.
