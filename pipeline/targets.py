"""Planetary target vectors (Moon / Mars) in Earth units, mapped into Earth-percentile space.

Every raw value is clamped to Earth's land min/max for that feature, then passed through the same
Earth CDF as the cells: t_f = CDF_f(clamp(T_f)). So the question we ask is "how close can Earth get?".

Terrain values are given at the scale of the Earth features (~1 km DEM pixels, ~10 km cells).
Values come from the literature cited per target (PDS DEM extraction is not done automatically; see
docs/decisions.md). `elevation` is used as an *atmosphere-thinness proxy*: vacuum targets (Moon) map to
Earth's highest terrain, Mars targets to a high-plateau 4500 m (classic Altiplano/Atacama analogs for
low pressure and high UV) - a modelling choice, not a measured elevation.
"""
from __future__ import annotations

import math

import numpy as np

from .config import FEATURE_IDS

# Shared references (key -> citation)
REFS = {
    "rosenburg2011": "Rosenburg M.A. et al. (2011) Global surface slopes and roughness of the Moon from LOLA. JGR 116, E02001.",
    "barker2016": "Barker M.K. et al. (2016) A new lunar digital elevation model from LOLA and SELENE (SLDEM2015). Icarus 273, 346-355.",
    "paige2010": "Paige D.A. et al. (2010) Diviner observations of cold traps in the lunar south polar region. Science 330, 479-482.",
    "williams2017": "Williams J.-P. et al. (2017) The global surface temperatures of the Moon as measured by Diviner. Icarus 283, 300-325.",
    "mazarico2011": "Mazarico E. et al. (2011) Illumination conditions of the lunar polar regions using LOLA topography. Icarus 211, 1066-1081.",
    "colaprete2010": "Colaprete A. et al. (2010) Detection of water in the LCROSS ejecta plume. Science 330, 463-468.",
    "li2018": "Li S. et al. (2018) Direct evidence of surface exposed water ice in the lunar polar regions. PNAS 115, 8907-8912.",
    "mckay1991": "McKay D.S. et al. (1991) The lunar regolith. In: Lunar Sourcebook, CUP, 285-356.",
    "haruyama2009": "Haruyama J. et al. (2009) Possible lunar lava tube skylight observed by SELENE. GRL 36, L21206.",
    "kreslavsky2000": "Kreslavsky M.A. & Head J.W. (2000) Kilometer-scale roughness of Mars. JGR 105, 26695-26711.",
    "golombek2012": "Golombek M. et al. (2012) Selection of the Mars Science Laboratory landing site. Space Sci. Rev. 170, 641-737.",
    "martinez2017": "Martínez G.M. et al. (2017) The modern near-surface Martian climate: a review of in-situ meteorological data. Space Sci. Rev. 212, 295-338.",
    "munguira2023": "Munguira A. et al. (2023) Near surface atmospheric temperatures at Jezero from Mars 2020 MEDA. JGR Planets 128, e2022JE007559.",
    "lemmon2015": "Lemmon M.T. et al. (2015) Dust aerosol, clouds, and the atmospheric optical depth record over 5 Mars years. Icarus 251, 96-111.",
    "farley2022": "Farley K.A. et al. (2022) Aqueously altered igneous rocks sampled on the floor of Jezero crater. Science 377, eabo2196.",
    "goudge2015": "Goudge T.A. et al. (2015) Assessing the mineralogy of the watershed and fan deposits of Jezero crater. JGR Planets 120, 775-808.",
    "grotzinger2014": "Grotzinger J.P. et al. (2014) A habitable fluvio-lacustrine environment at Yellowknife Bay, Gale crater. Science 343, 1242777.",
    "vasavada2017": "Vasavada A.R. et al. (2017) Thermophysical properties along Curiosity's traverse in Gale crater. Icarus 284, 372-386.",
    "bramson2015": "Bramson A.M. et al. (2015) Widespread excess ice in Arcadia Planitia, Mars. GRL 42, 6566-6574.",
    "morgan2021": "Morgan G.A. et al. (2021) Availability of subsurface water-ice resources in the northern mid-latitudes of Mars. Nature Astronomy 5, 230-236.",
    "tanaka2014": "Tanaka K.L. et al. (2014) Geologic map of Mars. USGS SIM 3292.",
    "byrne2009": "Byrne S. (2009) The polar deposits of Mars. Annu. Rev. Earth Planet. Sci. 37, 535-560.",
    "horgan2009": "Horgan B.H. et al. (2009) Distribution of hydrated minerals in the north polar region of Mars. JGR 114, E01005.",
    "kopp2011": "Kopp G. & Lean J.L. (2011) A new, lower value of total solar irradiance. GRL 38, L01706.",
    "heldmann2013": "Heldmann J.L. et al. (2013) The high elevation Dry Valleys in Antarctica as analog sites for subsurface ice on Mars. Planet. Space Sci. 85, 53-58.",
    "burkins2000": "Burkins M.B. et al. (2000) Origin and distribution of soil organic matter in Taylor Valley, Antarctica. Ecology 81, 2377-2391.",
    "appelbaum1990": "Appelbaum J. & Flood D.J. (1990) Solar radiation on Mars. Solar Energy 45, 353-363.",
}

BASE_WEIGHTS = {
    "elevation": 0.5, "slope_mean": 1.0, "slope_p90": 0.75, "tri": 0.75, "relief": 0.75,
    "temp_mean": 1.0, "temp_range": 1.0, "temp_min": 0.75, "precip": 2.5, "humidity": 1.5, "solar": 0.5,
    "ndvi": 3.0, "soc": 1.5, "sand": 1.0, "basalt": 1.0, "ice": 0.0, "lights": 1.0, "aod": 0.5,
}


def _w(**over):
    w = dict(BASE_WEIGHTS)
    w.update(over)
    return w


# Raw values in Earth units: (value, ref keys). EARTH_MAX / EARTH_MIN = clamp to Earth's extreme.
EARTH_MAX = math.inf
EARTH_MIN = -math.inf

TARGETS = [
    {
        "id": "moon_south_pole", "body": "Moon", "name": "Moon – South Pole (Artemis)",
        "lat": -89.5, "lon": 0.0,
        "blurb": "Artemis III candidate ridges near Shackleton: grazing sunlight, extreme cold traps, rugged highland terrain and water ice in permanently shadowed regions.",
        "raw": {
            "elevation": (EARTH_MAX, ["vacuum proxy"]), "slope_mean": (10.0, ["rosenburg2011", "barker2016"]),
            "slope_p90": (25.0, ["rosenburg2011"]), "tri": (180.0, ["rosenburg2011"]), "relief": (2500.0, ["barker2016"]),
            "temp_mean": (-120.0, ["paige2010", "williams2017"]), "temp_range": (100.0, ["williams2017"]),
            "temp_min": (-230.0, ["paige2010"]), "precip": (0.0, []), "humidity": (0.0, []),
            "solar": (0.7, ["mazarico2011", "kopp2011"]), "ndvi": (0.0, []), "soc": (0.0, []),
            "sand": (45.0, ["mckay1991"]), "basalt": (0.05, ["mckay1991"]), "ice": (0.05, ["colaprete2010", "li2018"]),
            "lights": (0.0, []), "aod": (0.0, []),
        },
        "weights": _w(ice=1.5, basalt=0.5, temp_mean=1.5, temp_min=1.25, solar=1.0, relief=1.0, slope_p90=1.0),
        "slope_hist": {"median": 10.0, "p90": 24.0, "baseline_m": 20, "refs": ["barker2016", "rosenburg2011"]},
        "validation": ["haughton", "mcmurdo", "svalbard", "meteor_crater"],
    },
    {
        "id": "moon_mare_lava_tube", "body": "Moon", "name": "Moon – Mare / lava tube (Marius Hills)",
        "lat": 14.1, "lon": -56.8,
        "blurb": "Flat basaltic mare plains with skylights into lava tubes (Marius Hills Hole) - natural radiation and thermal shelter for a base.",
        "raw": {
            "elevation": (EARTH_MAX, ["vacuum proxy"]), "slope_mean": (2.5, ["rosenburg2011"]),
            "slope_p90": (6.0, ["rosenburg2011"]), "tri": (45.0, ["rosenburg2011"]), "relief": (350.0, ["haruyama2009"]),
            "temp_mean": (-58.0, ["williams2017"]), "temp_range": (290.0, ["williams2017"]),
            "temp_min": (-178.0, ["williams2017"]), "precip": (0.0, []), "humidity": (0.0, []),
            "solar": (10.4, ["kopp2011"]), "ndvi": (0.0, []), "soc": (0.0, []),
            "sand": (45.0, ["mckay1991"]), "basalt": (1.0, ["haruyama2009"]), "ice": (0.0, []),
            "lights": (0.0, []), "aod": (0.0, []),
        },
        "weights": _w(basalt=3.0, slope_mean=1.5, temp_mean=0.75, temp_min=0.5),
        "slope_hist": {"median": 3.5, "p90": 9.0, "baseline_m": 25, "refs": ["rosenburg2011"]},
        "validation": ["hawaii_lava_tubes", "kilauea", "black_point", "lanzarote", "askja", "holuhraun", "mauna_kea"],
    },
    {
        "id": "mars_jezero", "body": "Mars", "name": "Mars – Jezero crater",
        "lat": 18.4, "lon": 77.5,
        "blurb": "Perseverance's ancient lake and river delta on olivine-rich basaltic crater floor - a prime astrobiology site.",
        "raw": {
            "elevation": (4500.0, ["low-pressure proxy"]), "slope_mean": (3.0, ["kreslavsky2000"]),
            "slope_p90": (10.0, ["kreslavsky2000"]), "tri": (55.0, ["kreslavsky2000"]), "relief": (500.0, ["goudge2015"]),
            "temp_mean": (-55.0, ["munguira2023"]), "temp_range": (80.0, ["munguira2023"]),
            "temp_min": (-100.0, ["munguira2023"]), "precip": (0.0, []), "humidity": (5.0, ["martinez2017"]),
            "solar": (3.1, ["appelbaum1990"]), "ndvi": (0.0, []), "soc": (0.0, []),
            "sand": (60.0, ["farley2022"]), "basalt": (0.8, ["farley2022"]), "ice": (0.0, []),
            "lights": (0.0, []), "aod": (0.55, ["lemmon2015"]),
        },
        "weights": _w(),
        "slope_hist": {"median": 3.0, "p90": 10.0, "baseline_m": 30, "refs": ["golombek2012", "kreslavsky2000"]},
        "validation": ["atacama", "death_valley", "pilbara", "utah_mdrs", "rio_tinto"],
    },
    {
        "id": "mars_gale", "body": "Mars", "name": "Mars – Gale crater",
        "lat": -5.4, "lon": 137.8,
        "blurb": "Curiosity's lake-bed mudstones at the foot of Aeolis Mons (Mt Sharp): layered sediments, dunes and a dusty sky.",
        "raw": {
            "elevation": (4500.0, ["low-pressure proxy"]), "slope_mean": (5.0, ["golombek2012"]),
            "slope_p90": (15.0, ["golombek2012"]), "tri": (90.0, ["golombek2012"]), "relief": (1200.0, ["grotzinger2014"]),
            "temp_mean": (-50.0, ["martinez2017", "vasavada2017"]), "temp_range": (85.0, ["martinez2017"]),
            "temp_min": (-95.0, ["martinez2017"]), "precip": (0.0, []), "humidity": (5.0, ["martinez2017"]),
            "solar": (3.3, ["appelbaum1990"]), "ndvi": (0.0, []), "soc": (0.0, []),
            "sand": (55.0, ["grotzinger2014"]), "basalt": (0.6, ["grotzinger2014"]), "ice": (0.0, []),
            "lights": (0.0, []), "aod": (0.6, ["lemmon2015"]),
        },
        "weights": _w(),
        "slope_hist": {"median": 5.0, "p90": 16.0, "baseline_m": 30, "refs": ["golombek2012"]},
        "validation": ["atacama", "utah_mdrs", "death_valley", "pilbara"],
    },
    {
        "id": "mars_arcadia", "body": "Mars", "name": "Mars – Arcadia Planitia (mid-latitude ice)",
        "lat": 45.0, "lon": -160.0,
        "blurb": "Smooth volcanic plains with excess water ice within metres of the surface - a leading candidate for the first crewed landing.",
        "raw": {
            "elevation": (4500.0, ["low-pressure proxy"]), "slope_mean": (1.0, ["kreslavsky2000"]),
            "slope_p90": (3.0, ["kreslavsky2000"]), "tri": (15.0, ["kreslavsky2000"]), "relief": (150.0, ["kreslavsky2000"]),
            "temp_mean": (-70.0, ["martinez2017"]), "temp_range": (60.0, ["martinez2017"]),
            "temp_min": (-125.0, ["martinez2017"]), "precip": (0.0, []), "humidity": (5.0, ["martinez2017"]),
            "solar": (2.6, ["appelbaum1990"]), "ndvi": (0.0, []), "soc": (0.0, []),
            "sand": (40.0, ["tanaka2014"]), "basalt": (0.9, ["tanaka2014"]),
            # Surface ice = 0: Arcadia's excess ice is buried under a dry, ice-free regolith lag (metres to tens of
            # metres deep), so the surface is not glaciated. Our ice feature measures surface ice/snow cover.
            # v1 used 0.3 (the subsurface ice fraction), which rewarded partly glaciated cells. See decisions.md.
            "ice": (0.0, ["bramson2015", "morgan2021"]),
            "lights": (0.0, []), "aod": (0.4, ["lemmon2015"]),
        },
        "weights": _w(ice=1.5, slope_mean=1.5, slope_p90=1.25),
        "slope_hist": {"median": 1.2, "p90": 4.0, "baseline_m": 30, "refs": ["kreslavsky2000", "bramson2015"]},
        # Ground-ice analogs: ice-cemented permafrost under a cold, dry surface. v1 also listed Askja and
        # Holuhraun, which are volcanic (lava) analogs with no ground ice, and lacked University Valley, the
        # canonical Mars subsurface-ice analog (Heldmann et al. 2013). Revised AFTER seeing v1 results, so the
        # report also prints the v1 list's AUC.
        "validation": ["haughton", "svalbard", "mcmurdo", "university_valley"],
        "validation_v1": ["haughton", "svalbard", "mcmurdo", "askja", "holuhraun"],
    },
    {
        "id": "mars_north_polar", "body": "Mars", "name": "Mars – North polar layered deposits",
        "lat": 85.0, "lon": 0.0,
        "blurb": "The residual water-ice cap and layered deposits cut by spiral troughs, ringed by dark basaltic dunes.",
        "raw": {
            "elevation": (4500.0, ["low-pressure proxy"]), "slope_mean": (2.0, ["byrne2009"]),
            "slope_p90": (8.0, ["byrne2009"]), "tri": (40.0, ["byrne2009"]), "relief": (800.0, ["byrne2009"]),
            "temp_mean": (-100.0, ["martinez2017"]), "temp_range": (25.0, ["martinez2017"]),
            "temp_min": (-125.0, ["byrne2009"]), "precip": (0.0, []), "humidity": (10.0, ["martinez2017"]),
            "solar": (1.6, ["appelbaum1990"]), "ndvi": (0.0, []), "soc": (0.0, []),
            "sand": (30.0, ["horgan2009"]), "basalt": (0.3, ["horgan2009"]), "ice": (0.9, ["byrne2009"]),
            "lights": (0.0, []), "aod": (0.3, ["lemmon2015"]),
        },
        "weights": _w(ice=2.5, temp_mean=1.5, temp_min=1.0, solar=1.0, basalt=0.5),
        "slope_hist": {"median": 2.5, "p90": 10.0, "baseline_m": 30, "refs": ["byrne2009"]},
        "validation": ["mcmurdo", "svalbard", "haughton"],
    },
]

DEFAULT_ICE_MAX = 0.5  # fraction; default hard filter for non-ice targets
HIST_BINS = list(range(0, 62, 2))  # slope histogram bin edges (degrees), shared with the web drill-down


def lognormal_slope_hist(median: float, p90: float, edges=HIST_BINS) -> list[float]:
    """Probability mass per bin of a lognormal slope distribution matching the given median and p90."""
    mu = math.log(median)
    sigma = max(1e-3, (math.log(p90) - mu) / 1.2815515655446004)
    def cdf(x):
        if x <= 0:
            return 0.0
        return 0.5 * (1 + math.erf((math.log(x) - mu) / (sigma * math.sqrt(2))))
    probs = [cdf(edges[i + 1]) - cdf(edges[i]) for i in range(len(edges) - 1)]
    probs[-1] += 1 - cdf(edges[-1])
    s = sum(probs)
    return [round(p / s, 5) for p in probs]


def build_targets(cdfs: dict) -> dict:
    out = []
    for t in TARGETS:
        vec, raw_out, clamped = [], {}, {}
        for fid in FEATURE_IDS:
            val, refs = t["raw"][fid]
            cdf = cdfs[fid]
            c = float(np.clip(val, cdf.min, cdf.max))
            vec.append(round(cdf.clamp_cdf(val), 5))
            raw_out[fid] = {"value": None if math.isinf(val) else val, "clamped": round(c, 4),
                            "beyond_earth": bool(val > cdf.max or val < cdf.min),
                            "refs": refs}
        sh = t["slope_hist"]
        out.append({
            "id": t["id"], "body": t["body"], "name": t["name"], "lat": t["lat"], "lon": t["lon"],
            "blurb": t["blurb"], "vector": vec, "raw": raw_out,
            "weights": [t["weights"][f] for f in FEATURE_IDS],
            "slope_hist": {"edges": HIST_BINS, "probs": lognormal_slope_hist(sh["median"], sh["p90"]),
                           "median": sh["median"], "p90": sh["p90"], "baseline_m": sh["baseline_m"],
                           "refs": sh["refs"], "method": "lognormal fit to literature median/p90"},
            "validation": t["validation"],
            **({"validation_v1": t["validation_v1"]} if "validation_v1" in t else {}),
            # Targets that do not weight ice exclude ice sheets by default (user-toggleable in the UI).
            "default_filters": [] if t["weights"]["ice"] > 0 else [{"feature": "ice", "max": DEFAULT_ICE_MAX}],
        })
    return {"features": FEATURE_IDS, "targets": out, "references": REFS}
