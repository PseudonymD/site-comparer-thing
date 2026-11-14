# Validation report

Generated 2026-11-14 11:48. Land cells scored: 2,143,220.

For each planetary target we score every land cell with the target's default weights and default filters (non-ice targets exclude cells with > 50 % permanent ice), then compare the **known analog sites** used for that body against **1000 random land cells**. A site's score is the best cell within ±2 cells (~±20 km) of its published coordinates; random cells use the same rule. ROC-AUC = probability that a known analog outranks a random land cell (0.5 = chance, 1.0 = perfect).

**What was seen when.** The target values and default weights in `pipeline/targets.py` were written from the literature and the challenge brief in the first commit, before any validation had been run on real data, and no weight has been changed since. Every analog in `known_analogs.json` was known to the authors at that time (they are the famous sites), so none is a hold-out in the strict sense; but none was used to fit weights. Changes made after seeing results, and therefore not blind: (1) the default ice filter for non-ice targets (added after a synthetic-data smoke test); (2) the SoilGrids gap policy (a data bug found while diagnosing Arcadia: Antarctica had been filled with peat-like soil carbon); (3) the Arcadia surface-ice target and its analog list. See `docs/decisions.md`. The AUC is therefore a sanity check of the method, not an independent accuracy estimate.

| Target | ROC-AUC | Median analog percentile | Random median score |
|---|---|---|---|
| Moon – South Pole (Artemis) | 0.724 | 85.2 | 0.512 |
| Moon – Mare / lava tube (Marius Hills) | 0.682 | 80.0 | 0.476 |
| Mars – Jezero crater | 0.915 | 98.1 | 0.471 |
| Mars – Gale crater | 0.944 | 98.6 | 0.468 |
| Mars – Arcadia Planitia (mid-latitude ice) | 0.632 | 77.4 | 0.554 |
| Mars – North polar layered deposits | 0.566 | 61.8 | 0.541 |

Targets whose analog list was revised after seeing earlier results (not a blind test):

- Mars – Arcadia Planitia (mid-latitude ice): AUC 0.632 with the revised list, 0.382 with the original list (haughton, svalbard, mcmurdo, askja, holuhraun).

## Moon – South Pole (Artemis)

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Haughton Crater, Devon Island | 0.540 | 75.7 | 520,699 |
| McMurdo Dry Valleys | 0.721 | 100.0 | 26 |
| Svalbard (Bockfjord, AMASE) | 0.485 | 49.3 | 1,085,697 |
| Meteor Crater (Barringer) | 0.609 | 94.6 | 115,826 |

## Moon – Mare / lava tube (Marius Hills)

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Hawaiian lava tubes (Kazumura) | 0.484 | 63.9 | 774,625 |
| Kīlauea | 0.544 | 80.2 | 424,921 |
| Black Point Lava Flow | 0.725 | 99.9 | 2,284 |
| Lanzarote (Timanfaya) | 0.560 | 83.3 | 358,215 |
| Askja, Iceland | 0.480 | 62.6 | 800,714 |
| Holuhraun lava field | 0.478 | 61.9 | 815,936 |
| Mauna Kea | 0.544 | 80.0 | 427,605 |

## Mars – Jezero crater

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Atacama Desert (Yungay) | 0.667 | 98.7 | 27,667 |
| Death Valley | 0.665 | 98.6 | 30,492 |
| Pilbara Craton | 0.593 | 90.1 | 212,763 |
| Mars Desert Research Station | 0.658 | 98.1 | 41,274 |
| Río Tinto | 0.574 | 86.8 | 282,287 |

## Mars – Gale crater

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Atacama Desert (Yungay) | 0.672 | 98.9 | 23,939 |
| Mars Desert Research Station | 0.662 | 98.2 | 37,696 |
| Death Valley | 0.672 | 98.9 | 23,897 |
| Pilbara Craton | 0.592 | 90.3 | 207,305 |

## Mars – Arcadia Planitia (mid-latitude ice)

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Haughton Crater, Devon Island | 0.542 | 56.0 | 943,025 |
| Svalbard (Bockfjord, AMASE) | 0.476 | 22.2 | 1,667,321 |
| McMurdo Dry Valleys | 0.686 | 98.8 | 24,546 |
| University Valley (Dry Valleys) | 0.697 | 99.3 | 15,089 |

## Mars – North polar layered deposits

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| McMurdo Dry Valleys | 0.679 | 100.0 | 728 |
| Svalbard (Bockfjord, AMASE) | 0.478 | 31.1 | 1,475,897 |
| Haughton Crater, Devon Island | 0.538 | 61.8 | 818,869 |
