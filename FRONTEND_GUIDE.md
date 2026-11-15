# Frontend Guide: Terrestrial Analog Finder

Read time: about 20 minutes. Everything here comes from reading the code in `web/`. Things I could not confirm are listed in [section 10](#10-what-i-could-not-verify). For the data side, see `BACKEND_GUIDE.md`.

---

## 1. The big picture

- **No frontend framework.** There is no React, Vue or Svelte. The app is plain **TypeScript** that builds HTML as text and attaches event handlers by hand. (Checked: `package.json` has one runtime dependency, `maplibre-gl`.)
- **Vite** is the build tool. It runs the dev server, compiles TypeScript, and bundles the files for release. **Vitest** runs the tests.
- **MapLibre GL** draws the interactive map.
- **Charts are hand-drawn** as SVG, canvas or styled `<div>`s. There is no chart library.
- **It is a single page.** `index.html` is loaded once; panels, pages and overlays are shown and hidden inside it.
- **There is no web server logic.** The "backend" is a scoring engine in a background thread of the same page (a *Web Worker*). Details in [section 6](#6-frontend-to-backend-communication).

Why no framework? The project is a small, single-screen tool whose heavy work (scoring millions of map cells) is in a worker. The authors chose to keep dependencies to a minimum. The cost: one very large file (`main.ts`, about 1,500 lines) wires nearly everything by hand.

---

## 2. Architecture

```
index.html  ── the page skeleton (empty panels + overlays) and a tiny script that sets the theme
    │
    ▼  loads
src/main.ts ── "the controller": app state, builds panels, handles clicks, talks to the worker
    │
    ├── data.ts        download the data files
    ├── map.ts         MapLibre map, markers, score overlay
    ├── worker.ts ◄──► scoring.ts    (background thread: all the heavy maths)
    ├── presets.ts     the six weight modes + saving
    ├── settings.ts    Settings page + light/dark preferences
    ├── start.ts       Start screen
    ├── links.ts       shareable URLs
    └── ui/            dossier, discoveries, tour, "how it works", fingerprint chart, planet viewer
style.css ── all styling, one file, driven by CSS variables
```

Technology table:

| Piece | Tool | What it's for |
|---|---|---|
| Language | TypeScript (strict mode) | JavaScript with types, so mistakes are caught before running (`tsc --noEmit` is part of `npm run build`) |
| Build / dev server | Vite | Instant reload while developing; bundles for release; MapLibre is split into its own cached file |
| Map | MapLibre GL 5 | WebGL map with a globe mode |
| Heavy computation | Web Worker | A separate thread, so the page never freezes while scoring |
| Styling | One plain CSS file | Variables for themes, media queries for phones |
| Fonts | Google Fonts (loaded from the internet) | Bricolage Grotesque, Instrument Sans, Martian Mono |
| Tests | Vitest | Logic tests only (links, scoring, presets, tour data). Nothing tests the visual UI |

---

## 3. What is on screen

Everything lives in `index.html` as "slots". `main.ts` then fills them.

```
┌────────────────────────────────────────────────────────────────────────┐
│ TOP BAR: logo/Start │ Moon: [South Pole][Mare]  Mars: [Jezero]... │ Tour · How it works · Limitations · Settings │
├──────────────┬──────────────────────────────────────┬──────────────────┤
│ LEFT PANEL   │                                      │ RIGHT PANEL      │
│ target card  │      FULL-SCREEN MAP                 │ [Candidates]     │
│ scoring mode │      heatmap + numbered circles      │ [Discoveries]    │
│ [Filters]    │      + diamonds (known analogs)      │  ranked list     │
│ [View]       │                                      │  ── or ──        │
│              │   LEGEND (bottom)   [Show heatmap]   │  DOSSIER of one  │
└──────────────┴──────────────────────────────────────┴──────────────────┘
Overlays that cover the page: Start screen · Loader · Settings page · "How it works" page · Tour card · Toast message
On phones: panels become bottom sheets, and a bottom nav bar (Map / Candidates / Controls / Guide) appears.
```

| Section | Where it is built | What it does |
|---|---|---|
| **Start screen** (`#start`) | `index.html`, `start.ts` | Logo, title, Start and Settings buttons. Skipped if the URL already contains a `#...` |
| **Simple Mode** (`body.simple`) | `ui/simple.ts`, `ui/plain.ts` | A plain-language panel over the same map and scoring engine, chosen on the start screen. It hides the Normal panels with CSS and shows the best matches and a result view with a short explanation. See `docs/decisions.md` item 43 |
| **Loader** (`#loader`) | `index.html`, `main.ts` | Progress card while the ~30 MB of data downloads |
| **Top bar** | `index.html`, target buttons built in `main.ts` | Choose one of six targets (2 Moon, 4 Mars); links to Tour, How it works, Limitations, Settings |
| **Left panel** | `buildLeft()` in `main.ts` | Target description, "Scoring mode" button, validation badge, tabs **Filters** (leave-out limits, geography, novelty slider) and **View** (flat/globe, background, colour stretch, opacity) |
| **Right panel** | `index.html`, `main.ts` | **Candidates**: ranked best places. **Discoveries**: pre-computed headline finds (`ui/discoveries.ts`) |
| **Dossier** (replaces the list in the right panel) | `ui/dossier.ts` | Details for one location: score, fingerprint chart, per-feature gap bars, all values, side-by-side planet view, terrain close-up |
| **Legend** | `drawLegend()` in `main.ts` | Histogram of scores and the colour scale |
| **Settings page** | `settings.ts` + `buildWeightsEditor()` in `main.ts` | Theme, Moon→Mars colour switch, the six scoring modes and weights, and copies of the filter/view controls |
| **How it works** (`#about`) | `about.ts`, `ui/howitworks.ts` | Long explainer page with interactive demos, data sources, references |
| **Guided tour** | `ui/tour.ts`, `tourSteps.ts` | Step-by-step spotlight with captions, plus an optional 30-second demo |

---

## 4. Key files

| File | Lines | Why it matters |
|---|---:|---|
| `main.ts` | ~1,500 | The controller. Creates the state, builds the left panel and weights editor, starts the worker, handles nearly every click. **Start here.** |
| `index.html` | ~150 | The skeleton and the no-flash theme script |
| `style.css` | ~800 | All styles |
| `worker.ts` / `scoring.ts` | ~340 / ~170 | The scoring engine (see `BACKEND_GUIDE.md`) |
| `map.ts` | ~210 | Wraps MapLibre: tiles, score overlay, markers, camera |
| `data.ts` | ~100 | Downloads and unpacks the data |
| `presets.ts` | ~280 | Weight modes and saving (pure logic, no screen code) |
| `settings.ts` | ~260 | Settings page, theme preferences |
| `links.ts` | ~100 | Reads and writes the URL hash |
| `types.ts` | ~230 | TypeScript descriptions of all data shapes |
| `format.ts`, `colormap.ts`, `geography.ts` | small | Number formatting, the score colour ramp, region lists |
| `ui/dossier.ts` | ~180 | The location detail panel |
| `ui/howitworks.ts` | ~700 | The explainer page and its demos |
| `ui/tour.ts` + `tourSteps.ts` + `tourState.ts` | ~480 + 240 + 55 | The tour (behaviour, text, and "what to save/restore") |
| `ui/fingerprint.ts`, `ui/rail.ts` | tiny | The SVG radar chart and the gap-bar chart |
| `drill.ts` | ~245 | Terrain close-up (fetches elevation tiles, draws canvas and SVG) |

---

## 5. How the UI works

### 5.1 No components: build HTML as text, then wire it up

Where a framework would use components, this app writes HTML as a template string and sets it into a slot. Then it attaches handlers:

```ts
// the shortcut used everywhere in main.ts
const $ = (sel) => document.querySelector(sel);

left.innerHTML = `<div class="brief"> ... <button id="best-site">Fly to the best match</button> ...</div>`;
$('#best-site').onclick = () => { const s = lastResult?.sites[0]; if (s) selectSite(s, 0); };
```

**Why this matters:** the screen does not update by itself. When data changes, *your code* must update the right element (`textContent`, `innerHTML`, `classList.toggle(...)`). If you change a variable and forget to update the screen, nothing happens. Most bugs here would come from that.

Because of `innerHTML`, any text that comes from data is passed through `esc()` (in `format.ts`) to escape HTML characters first.

### 5.2 State

State is a plain object in `main.ts`:

```ts
const state: AppState = { t: 0 /* chosen target */, weights: [...], filters: [...],
                          alpha: 0 /* novelty */, opacity: 0.85, projection: 'mercator', ... };
```

There are a few other places state lives:

| What | Where | Survives refresh? |
|---|---|---|
| Current settings (target, filters, view) | `state` object | Only through the **URL hash** (`links.ts`) |
| Selected map location | `current` variable | In the URL hash |
| Scoring modes and saved weights | `localStorage` key `analog-finder-presets-v2` | Yes |
| Theme and colour-switch choice | `localStorage` key `analog-finder-settings` | Yes |
| "How it works" page theme | `localStorage` key `hiw-theme` | Yes |
| Which panels are open | **CSS classes on `<body>`**: `left-closed`, `right-closed`, `dossier-open`, `site-focus`, `guide-open` | No |

Using body classes for layout state is a neat trick: one `classList.toggle('left-closed')` and the CSS moves the panel and the map padding.

### 5.3 The update loop

Nearly every interaction follows the same path:

```
User moves a slider / picks a target / ticks a filter
        │
        ▼
 event handler changes `state`  (e.g. state.weights[j] = 12)
        │
        ▼
 requestScore()  ──►  worker.postMessage({type:'score', ...})      (one request at a time;
        │                                                           newest settings win)
        ▼
 worker answers with: heatmap image, top candidate sites, histogram, how known analogs rank
        │
        ▼
 onScored() in main.ts:  map overlay ← image
                         candidate list ← sites
                         legend ← histogram
                         open dossier ← re-rendered with new weights
        │
        ▼
 updateHash()  →  the URL is rewritten, so the page can be shared
```

`requestScore()` sets a "dirty" flag; if the worker is busy, the next request waits and then uses the latest settings. **Why:** dragging a slider can fire hundreds of events a second, and queuing them all would make the map lag behind your hand.

### 5.4 Passing the app around

Modules like `ui/dossier.ts` do not import state directly. `main.ts` builds an `app` object (state, dataset, map, helper functions) and passes it in: `renderDossier(app, info, lat, lon, nav)`. This avoids circular imports and makes it clear what each module is allowed to touch. For debugging, `window.app` is also exposed in the browser console.

### 5.5 Interactions worth knowing

- **Target buttons:** `selectTarget(i)` loads that body's active scoring mode, resets default filters, closes any open location, recolours the interface, and requests a score. The buttons are built from `targets.json`, not hard-coded.
- **Clicking the map:** `map.onCellClick` → `showCell(lat, lon)` → asks the worker for that cell's 18 values → `renderDossier`. Clicking a numbered circle does the same. Clicking a known-analog diamond opens the same dossier with extra "known analog" text.
- **Focus mode:** opening a candidate collapses the left panel, hides the heatmap and zooms in (`site-focus` body class). A "Show heatmap" button toggles it back.
- **Tabs:** buttons with `role="tab"` and `aria-selected`; left/right arrow keys move between them (`tabArrowKeys`).
- **Keyboard:** `Esc` closes the About page, Settings or the dossier. Up/Down arrows step through candidates when a dossier is open.
- **Settings controls that copy others:** the Filters and Map view sections of the Settings page do not own state. They **mirror** the left-panel controls: changing one sets the original control's value and fires its event (`settings.ts`, `mirrorRange`). So there is one code path. The weights editor is different: it is the only place weights are edited, built by `buildWeightsEditor()` in `main.ts`.
- **Unsaved changes:** weight edits are drafts. They apply to the map immediately, show an "Unsaved changes" label, and are only stored when you press **Save** (`presets.ts`).

### 5.6 Shareable links

`links.ts` turns the view into the URL part after `#`, for example `#t=mars_jezero&m=direct&a=0.3&v=-24.1,-69.9,9`. On load, `parseHash` reads it back. **Why:** the app has no accounts or server, so the URL *is* the way to share a view. A side effect: a URL with a hash skips the Start screen.

---

## 6. Frontend-to-backend communication

There is **no request to any server of ours after the page loads**. There are three kinds of communication:

### 6.1 Loading data (once, at start): `fetch`

`data.ts` downloads static files from `/data/`: small JSON files first (so the map and markers appear quickly), then three large `.gz` binary files with a progress bar. They are decompressed in the browser using `DecompressionStream`. The URL gets `?v=<build time>` so a new data release is not served from the one-year cache.

### 6.2 Page ↔ Worker (constantly): messages

The page and the worker share nothing; they send messages:

| Page sends | Worker replies | Used for |
|---|---|---|
| `init` (data arrays, **moved**, not copied) | `ready` | Start-up |
| `score` (target, weights, filters, region, novelty...) | `scored` (heatmap image, candidate sites, histogram, analog check) | Every change |
| `cell` (a grid index) | `cell` (that cell's values) | Map click |

The big arrays are sent as "transferables": ownership moves to the worker instantly, with no copy. After that the page itself no longer holds the data.

The worker returns the heatmap as a PNG image (`blob`). `map.ts` turns it into a temporary URL and hands it to MapLibre as an image layer stretched over the world. The numbered circles and diamonds are ordinary HTML elements placed by MapLibre.

### 6.3 Third-party image/data services (from the browser directly)

| Service | When |
|---|---|
| Esri tiles (satellite, dark, labels) | Always, as the map background |
| Google Fonts | At page load |
| AWS elevation tiles | Only when you press "Run terrain close-up" (`drill.ts`) |
| NASA Trek tiles (Moon/Mars imagery) | Only when you open "Side by side" (`ui/planet.ts`) |

### 6.4 "Forms"

There are no forms that submit anywhere. Inputs (sliders, checkboxes, number boxes, the country search box) only change local state. The country search filters a list that is already on the page.

---

## 7. Charts and visuals

| Visual | How it is drawn |
|---|---|
| Heatmap on the map | A PNG made by the worker; colours from `colormap.ts` (the "inferno" ramp: dark purple → orange → yellow) |
| Legend histogram | Row of `<i>` elements with computed heights (`drawLegend`) |
| **Fingerprint** radar | An SVG built as a string: one spoke per feature, the target as an outline, the site as a filled shape (`ui/fingerprint.ts`). The gap between the shapes is the mismatch |
| **Gap bars** ("Where it differs") | Styled `<div>`s: target tick, site dot, and a line whose thickness shows how much that feature costs the score (`ui/rail.ts`) |
| Terrain close-up | A `<canvas>` hillshade plus SVG charts (`drill.ts`) |
| How-it-works demos | Mostly SVG and `<div>` bars, updated from the live data (`ui/howitworks.ts`) |

**Why hand-drawn?** The charts are small and specific, and drawing them as strings keeps the bundle small and lets them use the CSS variables, so they follow the theme automatically.

Note: the score colour ramp is **separate** from the light/dark theme. The theme colours the panels; the inferno ramp is reserved for scores so they look the same in every theme.

---

## 8. Styling

All styling is in `src/style.css`. The important ideas:

**1. CSS variables (custom properties) are the theme.** Colours are defined once on the root element and used everywhere:

```css
:root { --paper:#e8eaed; --ink:#14181f; --accent:#2f4e8c; ... }
.sheet { background: var(--paper); color: var(--ink); }
```

Change the variables and every panel, chart and button changes with them.

**2. Three attributes on `<html>` switch the variables:**

| Attribute | Values | Effect |
|---|---|---|
| `data-body` | `moon` / `mars` | Mars gets a warm red/brown palette (set by the selected target) |
| `data-theme` | `light` / `dark` | Dark palette |
| `data-tint` | `off` | Turns the Moon-blue / Mars-red switch off (Settings option) |

Example of how they combine: `:root[data-theme='dark'][data-body='mars']:not([data-tint='off']) { ... }`.

**3. No theme flash.** A small inline script in `index.html` reads the saved theme from `localStorage` and sets `data-theme` *before* the page paints. Without it you would see a white flash on every load in dark mode. The first visit follows the operating system setting (`prefers-color-scheme`).

**4. Layout: floating panels over a full-screen map.** The map is `position: fixed; inset: 0`. The top bar and panels are fixed-position cards (class `.sheet`) on top. CSS variables `--inset-l` and `--inset-r` hold the space the panels take, and `main.ts` passes the same numbers to MapLibre as padding so the map's "visual centre" stays in the uncovered area.

**5. Responsive design:**

| Breakpoint | What changes |
|---|---|
| ≤ 1280 px | The row of target buttons is replaced by a dropdown |
| ≤ 1100 px | The "Data and limitations" link is hidden from the top bar |
| ≤ 700 px | The "Analog Finder" text next to the logo is hidden |
| **≤ 900 px** ("narrow") | Panels become **bottom sheets**, one at a time; a bottom nav bar appears; the Guide links move into a sheet. `isNarrow()` in `main.ts` uses the same 900 px number |
| ≤ 600 px | Settings rows and cards compact further |
| `prefers-reduced-motion` | Animations are turned off |

**6. Accessibility touches (verified in code):** ARIA roles on tabs and dialogs, `aria-pressed` on toggle buttons, focus outlines (`:focus-visible`), `aria-live` regions for changing text, keyboard shortcuts, and `Esc` to close overlays. I did not run an accessibility audit.

---

## 9. Quick reference: how the main features work

| Feature | Short version |
|---|---|
| **Map** | `map.ts` creates MapLibre with three tile sources; the score image is a map layer; markers are HTML elements; globe/flat and background switch via MapLibre calls |
| **Target switching** | Buttons from `targets.json` → `selectTarget` → rescore |
| **Weights and modes** | `presets.ts` (logic) + `buildWeightsEditor` (screen). Sliders edit a draft; Save writes to `localStorage` |
| **Filters** | Checkboxes + number boxes in `state.filters`; sent to the worker as limits |
| **Candidates** | Worker returns best places; `main.ts` builds the list and numbered markers |
| **Dossier** | `ui/dossier.ts` asks the worker for one cell and draws the fingerprint, gap bars and a values table |
| **Guided tour** | `tour.ts` highlights a real on-screen element with a spotlight and a caption card. Texts live in `tourSteps.ts`. It saves a snapshot of your settings and restores them afterwards |
| **Start / Settings** | `start.ts` and `settings.ts`: overlays toggled with the `hidden` class |
| **Share link** | `links.ts`, URL hash |

---

## 10. What I could not verify

- **Internals of `ui/tour.ts` and `ui/howitworks.ts`.** I read their structure, exports and key helpers, not every line. I know what they do from their headers and how `main.ts` uses them.
- **Real devices.** I ran the app in desktop Chrome (scripted) and checked the CSS breakpoints by reading them. I did not test on an actual phone or tablet, nor in Firefox or Safari.
- **Browser support.** The code relies on newer features (Web Workers with modules, `DecompressionStream`, WebGL). I did not find a stated list of supported browsers.
- **Visual correctness.** There are no automated UI tests. Only logic is tested.
- **Fonts offline.** The fonts load from Google; I did not check what the page looks like if they are blocked (CSS has fallbacks listed).
- **`web/vite.config.ts` dev-server hosts.** It lists two specific host names (a Tailscale name and an IP) that only matter for developers on that network. Their purpose is not explained in the code.

---

## 11. If someone asks you...

- **"What framework is it?"** None. TypeScript and Vite, with MapLibre for the map. HTML is generated from template strings.
- **"How does the screen update?"** Event handler → change `state` → ask the worker to rescore → when the answer arrives, update each part of the page by hand.
- **"Where does it talk to the server?"** It only downloads static data files once. After that, everything runs in the browser; the "backend" is a Web Worker.
- **"Why a Web Worker?"** Scoring about 2 million cells takes a few hundred milliseconds; on the main thread it would freeze the interface.
- **"How do dark mode and Mars red work?"** CSS variables switched by `data-theme` and `data-body` attributes on `<html>`.
- **"How do I share my view?"** Copy the URL; all settings are in the hash.
- **"Where do I start reading?"** `index.html`, then `main.ts` from the top, then `style.css` variables.
