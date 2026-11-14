// Guided tour content (DOM-free). Every sentence is either built from loaded data (counts, names)
// or taken from wording that already exists in the app: about.ts, main.ts, dossier.ts, discoveries.ts.
// The tour describes controls; it must not claim anything about places or scores beyond that wording.
import type { LeftTab, RightTab } from './tourState';

export interface GuideContext {
  nCells: number;
  nFeatures: number;
  nTargets: number;
  nAnalogs: number;
  nDiscoveries: number;
  noveltyKm: number;
  moon: string[];
  mars: string[];
  proxies: string[]; // names of layers flagged proxy in meta.json
  regionName: string | null; // set only when a region limit (r=...) is active
}

export interface GuideLive {
  dossierOpen: boolean;
  found: boolean; // whether the step's highlight target is on screen right now
  narrow: boolean;
}

/** UI-only preparation: reveal the control. Never touches target, weights, filters or the map. */
export interface StepPrep {
  left?: LeftTab | 'current'; // open the controls panel (on this tab, or the tab already showing)
  right?: RightTab; // open the candidates panel on this tab
  clear?: boolean; // narrow screens: close the panels so the map and legend are visible
  guide?: boolean; // narrow screens: open the Guide sheet
}

export type StepAction = 'demo' | 'example' | 'about' | 'limits';

export interface GuideStep {
  id: string;
  title: string;
  /** Selectors, first one that is on screen is highlighted. */
  targets: string[];
  prep?: StepPrep;
  actions?: StepAction[];
  /** Narrow screens: show the card at the top instead of the bottom so it does not hide the target. */
  cardTop?: boolean;
  paras(c: GuideContext, l: GuideLive): string[];
}

const n = (v: number) => v.toLocaleString('en-US');
const list = (a: string[]) => (a.length ? a.join(', ') : 'none loaded');

export const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'intro',
    title: 'What this site explores',
    targets: [],
    actions: ['demo'],
    paras: (c) => [
      `Where on Earth is most like the Moon or Mars? Every one of ${n(c.nCells)} land cells is scored against ${c.nTargets} Moon and Mars target sites using ${c.nFeatures} open data layers, live in your browser.`,
      'Astronauts train, and rovers get tested, in places on Earth that look and behave like the Moon or Mars. In this site’s words, those are terrestrial analogs. It ranks the known analogs and also turns up new ones.',
      'This tour only describes the real controls, one step at a time. It does not change your settings, and when it ends your view is put back. The one optional exception is a button you press yourself to open an example location.',
    ],
  },
  {
    id: 'map',
    title: 'Move around the map',
    targets: ['.maplibregl-ctrl-top-right .maplibregl-ctrl-group'],
    paras: () => [
      'Drag to pan. Scroll, or use the + and − buttons, to zoom. Click any land to open the details for that spot; a message appears if you click outside the data.',
      'Numbered circles mark the best-ranked candidates for the current settings. Diamonds mark known analog sites. The legend shows both symbols.',
    ],
  },
  {
    id: 'targets',
    title: 'Choose a target',
    targets: ['#targets', '#target-select'],
    paras: (c) => [
      `The target is the Moon or Mars site that every land cell is compared with. Moon: ${list(c.moon)}. Mars: ${list(c.mars)}.`,
      'Choosing one re-scores every cell against that site. It also resets the layer weights and filters to that target’s defaults, closes any open location, and switches the colour theme between Moon and Mars.',
      'The tour does not change your choice.',
    ],
  },
  {
    id: 'brief',
    title: 'About the selected target',
    targets: ['#evidence-row', '.brief'],
    prep: { left: 'current' },
    paras: () => [
      'The card names the target and describes it. The button under it reports how well this method recovered known analogs for that target: ROC-AUC, the median percentile of the known analogs, and a label (works well, works moderately or weak). Click it for the method and the numbers for every target.',
      'ROC-AUC is the probability that a known analog outranks a random cell (0.5 = chance, 1 = perfect). All analogs are famous sites known to us from the start, so none is a strict hold-out, but none was used to fit weights. The polar and ice targets are weaker.',
      'Fly to the best match opens the top-ranked candidate. Limitations opens the list of caveats.',
    ],
  },
  {
    id: 'weights',
    title: 'Weights: how much each layer counts',
    targets: ['#pane-weights'],
    prep: { left: 'weights' },
    paras: (c) => {
      const out = [
        `Each of the ${c.nFeatures} layers has a weight from 0 to 3. Under each name: the target’s value and its Earth percentile (p0 lowest, p100 highest). Layers are grouped as Terrain, Climate, Surface and Remoteness; open a group to see its sliders.`,
        'Reset puts the weights back to the target’s defaults. At least one weight must stay above zero.',
      ];
      if (c.proxies.length) out.push(`Layers tagged proxy in this build: ${c.proxies.join(', ')}. See Limitations for what proxies mean.`);
      return out;
    },
  },
  {
    id: 'filters',
    title: 'Filters: leave cells out',
    targets: ['#filters'],
    prep: { left: 'filters' },
    paras: () => [
      'Tick a limit to leave out cells past it: vegetation (NDVI), ice cover, lit areas (night lights) or steep slopes (slope p90). Cells past a limit score zero. Untick it to put them back. The number box sets the limit.',
      'Some targets start with the ice limit on. The count on the Filters tab adds up active limits, geography choices and the novelty setting.',
    ],
  },
  {
    id: 'geography',
    title: 'Geography: keep only some places',
    targets: ['.geo-filter'],
    prep: { left: 'filters' },
    paras: (c) => {
      const out = [
        'Tick continents under Regions, or find countries with the search box. Only cells matching every selected geography remain. Remove a chip with × or press Reset to clear all of it.',
      ];
      if (c.regionName) out.push(`A region limit (${c.regionName} only) is active, shown above the candidate list. Use “Show the whole world” there to clear it.`);
      return out;
    },
  },
  {
    id: 'novelty',
    title: 'Favour new places',
    targets: ['#alpha'],
    prep: { left: 'filters' },
    paras: (c) => [
      `Mixes in distance from the ${c.nAnalogs} known analog sites (levels off at ${n(c.noveltyKm)} km), so candidates nobody has used yet rise. The value shows as off at 0.`,
    ],
  },
  {
    id: 'view',
    title: 'View: how the map is drawn',
    targets: ['#pane-view'],
    prep: { left: 'view' },
    paras: () => [
      'These controls change how the map and the score layer are drawn: Flat or Globe map shape, Satellite or Plain dark background, the Earth percentile where the colour scale starts, an option to hide cells below that percentile, and the score layer’s opacity.',
    ],
  },
  {
    id: 'legend',
    title: 'Reading the legend',
    targets: ['#legend'],
    prep: { clear: true },
    cardTop: true,
    paras: (_c, l) => {
      const out = [
        'The legend shows how the scores on the map are spread, from the lowest to the highest shown, with the 99th percentile marked. Scores are out of 100 and are re-scored live as you change the target, weights or filters.',
        'A higher score means a cell’s layers sit closer to the target’s, across the layers you weight. It describes similarity on those layers only. 0.1° cells (~11 km) blur features such as individual craters, lava tubes or dune fields, and some analog qualities (mineralogy, microbiology, regolith mechanics) are not in any global layer.',
      ];
      if (!l.found) out.push('The legend is hidden while a location is open. Its Show heatmap button brings the score layer and the legend back.');
      return out;
    },
  },
  {
    id: 'candidates',
    title: 'Candidates',
    targets: ['#rv-cand'],
    prep: { right: 'cand' },
    paras: (_c, l) => [
      'The best 50 clusters of cells for the current settings, with rank, country, location, area and score. “new” marks places more than 500 km from any known analog site. Click a row to open its details.',
      ...(l.dossierOpen ? ['A location is open, so the list is hidden behind it. Its “← All candidates” button brings the list back.'] : []),
    ],
  },
  {
    id: 'discoveries',
    title: 'Discoveries',
    targets: ['.rtabs button[data-r="disc"]'],
    prep: { right: 'disc' },
    paras: (c) =>
      c.nDiscoveries
        ? [
            `${c.nDiscoveries} new candidates the scoring itself picked: Earth’s top 1% for a target and at least 500 km from every known analog. The rule is stated at the top of the tab.`,
            'Each card shows what matches, the biggest gaps and the caveats, with two buttons. Copy link copies a link. Fly there changes the target, the novelty setting and the view, so the tour never presses it.',
          ]
        : ['This build has no discoveries list.'],
  },
  {
    id: 'location',
    title: 'Reading a location',
    targets: ['#dossier .d-head'],
    prep: { right: 'cand' },
    actions: ['example'],
    paras: (_c, l) => [
      ...(l.dossierOpen ? [] : ['No location is open. Click land on the map or a candidate to open one, or use the example button below.']),
      'A location shows its coordinates and country, its score (“filtered” if one of your filters excludes it), where it ranks among all of Earth’s land, and how far it is from the nearest known analog.',
      '“Matches on” names the layers that agree most with the target. “Biggest gaps” names the layers that differ most, with values.',
      'Step through candidates with the ↑ and ↓ buttons or keys, go back with “← All candidates” or Esc, and share this exact view with Copy link.',
    ],
  },
  {
    id: 'evidence',
    title: 'The evidence behind a score',
    targets: ['#dossier .d-sec'],
    prep: { right: 'cand' },
    actions: ['example'],
    paras: () => [
      '“Where it differs” has one row per weighted layer: the target’s position and this site’s position among Earth’s land (low to high), and the layer’s share of the gap. Layers flagged proxy are indirect stand-ins; layers flagged placeholder are not real measurements.',
      '“Show all values” lists every layer. Percentiles rank a value among all land on Earth (0–100). Targets that lie beyond anything on Earth are highlighted and were clamped before comparison.',
    ],
  },
  {
    id: 'sidebyside',
    title: 'Side by side',
    targets: ['#pm-btn'],
    prep: { right: 'cand' },
    actions: ['example'],
    paras: () => [
      'Shows the target’s real terrain next to this candidate at a similar ground scale, with NASA Trek imagery for the Moon or Mars and Esri imagery for Earth. The images come from outside services and may not load; the panel says so if they fail.',
      'Press the button yourself to show or hide it. The tour never does.',
    ],
  },
  {
    id: 'drill',
    title: 'Terrain close-up',
    targets: ['#drill-btn'],
    prep: { right: 'cand' },
    actions: ['example'],
    paras: () => [
      'Fetches ~30 m elevation for a 20 km box around this cell and compares its slopes with the target’s. It needs a network connection and runs only when you press the button. Elevation source resolution varies by region.',
    ],
  },
  {
    id: 'about',
    title: 'Methods, data sources and caveats',
    targets: ['#guide-sheet', '.guide'],
    prep: { clear: true, guide: true },
    actions: ['about', 'limits'],
    paras: () => [
      'How it works explains the method step by step. Its “Data, references and credits” section lists the validation for each target, the data source used for each layer, and the limitations. Data and limitations opens straight to that section.',
      'You can leave any time: Skip tour or Esc closes the guide and restores your view. Restart goes back to step 1, and Take the tour starts it again.',
    ],
  },
];
