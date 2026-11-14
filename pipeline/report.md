# Validation report

Generated 2026-11-14 07:21. Land cells scored: 2,143,220.

For each planetary target we score every land cell with the target's default weights and default filters (non-ice targets exclude cells with > 50 % permanent ice), then compare the **known analog sites** used for that body against **1000 random land cells**. A site's score is the best cell within ±2 cells (~±20 km) of its published coordinates; random cells use the same rule. ROC-AUC = probability that a known analog outranks a random land cell (0.5 = chance, 1.0 = perfect).

**What was seen when.** The target values and default weights in `pipeline/targets.py` were written from the literature and the challenge brief in the first commit, before any validation had been run on real data, and no weight has been changed since. Every analog in `known_analogs.json` was known to the authors at that time (they are the famous sites), so none is a hold-out in the strict sense; but none was used to fit weights. Changes made after seeing results, and therefore not blind: (1) the default ice filter for non-ice targets (added after a synthetic-data smoke test); (2) the SoilGrids gap policy (a data bug found while diagnosing Arcadia: Antarctica had been filled with peat-like soil carbon); (3) the Arcadia surface-ice target and its analog list. See `docs/decisions.md`. The AUC is therefore a sanity check of the method, not an independent accuracy estimate.

> ⚠️ **1 feature(s) were SYNTHETIC in this run** (basalt). These numbers are only a smoke test of the method until the real pipeline run replaces them.

| Target | ROC-AUC | Median analog percentile | Random median score |
|---|---|---|---|
| Moon – South Pole (Artemis) | 0.727 | 84.7 | 0.511 |
| Moon – Mare / lava tube (Marius Hills) | 0.625 | 72.6 | 0.465 |
| Mars – Jezero crater | 0.915 | 98.2 | 0.459 |
| Mars – Gale crater | 0.940 | 98.7 | 0.456 |
| Mars – Arcadia Planitia (mid-latitude ice) | 0.625 | 77.2 | 0.554 |
| Mars – North polar layered deposits | 0.582 | 62.7 | 0.543 |

Targets whose analog list was revised after seeing earlier results (not a blind test):

- Mars – Arcadia Planitia (mid-latitude ice): AUC 0.625 with the revised list, 0.360 with the original list (haughton, svalbard, mcmurdo, askja, holuhraun).

## Moon – South Pole (Artemis)

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Haughton Crater, Devon Island | 0.540 | 75.8 | 518,266 |
| McMurdo Dry Valleys | 0.736 | 100.0 | 26 |
| Svalbard (Bockfjord, AMASE) | 0.493 | 53.9 | 988,431 |
| Meteor Crater (Barringer) | 0.603 | 93.5 | 139,452 |

## Moon – Mare / lava tube (Marius Hills)

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Hawaiian lava tubes (Kazumura) | 0.448 | 54.9 | 965,754 |
| Kīlauea | 0.504 | 72.8 | 583,771 |
| Black Point Lava Flow | 0.662 | 98.7 | 28,621 |
| Lanzarote (Timanfaya) | 0.561 | 84.8 | 326,392 |
| Askja, Iceland | 0.445 | 53.9 | 988,905 |
| Holuhraun lava field | 0.443 | 53.2 | 1,002,539 |
| Mauna Kea | 0.503 | 72.6 | 586,910 |

## Mars – Jezero crater

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Atacama Desert (Yungay) | 0.667 | 98.8 | 25,036 |
| Death Valley | 0.665 | 98.7 | 27,753 |
| Pilbara Craton | 0.580 | 88.8 | 239,197 |
| Mars Desert Research Station | 0.658 | 98.2 | 38,043 |
| Río Tinto | 0.574 | 87.8 | 262,133 |

## Mars – Gale crater

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Atacama Desert (Yungay) | 0.672 | 99.0 | 21,937 |
| Mars Desert Research Station | 0.662 | 98.4 | 35,004 |
| Death Valley | 0.672 | 99.0 | 21,896 |
| Pilbara Craton | 0.577 | 89.0 | 234,658 |

## Mars – Arcadia Planitia (mid-latitude ice)

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Haughton Crater, Devon Island | 0.542 | 56.3 | 936,000 |
| Svalbard (Bockfjord, AMASE) | 0.474 | 21.5 | 1,682,815 |
| McMurdo Dry Valleys | 0.674 | 98.1 | 40,188 |
| University Valley (Dry Valleys) | 0.683 | 98.8 | 25,773 |

## Mars – North polar layered deposits

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| McMurdo Dry Valleys | 0.704 | 100.0 | 51 |
| Svalbard (Bockfjord, AMASE) | 0.493 | 36.4 | 1,363,977 |
| Haughton Crater, Devon Island | 0.540 | 62.7 | 800,143 |
