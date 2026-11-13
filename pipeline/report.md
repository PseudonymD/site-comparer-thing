# Validation report

Generated 2026-11-13 15:59. Land cells scored: 2,143,220.

For each planetary target we score every land cell with the target's default weights and default filters (non-ice targets exclude cells with > 50 % permanent ice), then compare the **known analog sites** used for that body against **1000 random land cells**. A site's score is the best cell within ±2 cells (~±20 km) of its published coordinates; random cells use the same rule. ROC-AUC = probability that a known analog outranks a random land cell (0.5 = chance, 1.0 = perfect).

> ⚠️ **1 feature(s) were SYNTHETIC in this run** (basalt). These numbers are only a smoke test of the method until the real pipeline run replaces them.

| Target | ROC-AUC | Median analog percentile | Random median score |
|---|---|---|---|
| Moon – South Pole (Artemis) | 0.749 | 87.9 | 0.505 |
| Moon – Mare / lava tube (Marius Hills) | 0.630 | 74.5 | 0.465 |
| Mars – Jezero crater | 0.920 | 98.8 | 0.455 |
| Mars – Gale crater | 0.944 | 99.0 | 0.453 |
| Mars – Arcadia Planitia (mid-latitude ice) | 0.343 | 24.4 | 0.539 |
| Mars – North polar layered deposits | 0.636 | 75.8 | 0.519 |

## Moon – South Pole (Artemis)

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Haughton Crater, Devon Island | 0.542 | 79.7 | 435,391 |
| McMurdo Dry Valleys | 0.654 | 99.5 | 11,578 |
| Svalbard (Bockfjord, AMASE) | 0.484 | 54.8 | 969,897 |
| Meteor Crater (Barringer) | 0.606 | 96.1 | 84,242 |

## Moon – Mare / lava tube (Marius Hills)

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Hawaiian lava tubes (Kazumura) | 0.452 | 56.2 | 938,343 |
| Kīlauea | 0.512 | 74.5 | 546,282 |
| Black Point Lava Flow | 0.664 | 98.6 | 29,448 |
| Lanzarote (Timanfaya) | 0.568 | 85.8 | 303,401 |
| Askja, Iceland | 0.436 | 51.1 | 1,048,777 |
| Holuhraun lava field | 0.430 | 49.4 | 1,084,526 |
| Mauna Kea | 0.512 | 74.5 | 547,175 |

## Mars – Jezero crater

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Atacama Desert (Yungay) | 0.674 | 99.4 | 13,093 |
| Death Valley | 0.671 | 99.2 | 16,083 |
| Pilbara Craton | 0.585 | 89.9 | 215,576 |
| Mars Desert Research Station | 0.663 | 98.8 | 26,086 |
| Río Tinto | 0.572 | 88.0 | 257,517 |

## Mars – Gale crater

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Atacama Desert (Yungay) | 0.679 | 99.3 | 14,177 |
| Mars Desert Research Station | 0.667 | 98.7 | 27,959 |
| Death Valley | 0.678 | 99.3 | 14,750 |
| Pilbara Craton | 0.582 | 89.8 | 219,237 |

## Mars – Arcadia Planitia (mid-latitude ice)

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Haughton Crater, Devon Island | 0.536 | 60.0 | 856,905 |
| Svalbard (Bockfjord, AMASE) | 0.467 | 24.4 | 1,621,051 |
| McMurdo Dry Valleys | 0.610 | 89.3 | 230,207 |
| Askja, Iceland | 0.460 | 21.4 | 1,684,610 |
| Holuhraun lava field | 0.451 | 18.0 | 1,757,871 |

## Mars – North polar layered deposits

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| McMurdo Dry Valleys | 0.622 | 97.2 | 59,419 |
| Svalbard (Bockfjord, AMASE) | 0.483 | 42.1 | 1,240,867 |
| Haughton Crater, Devon Island | 0.543 | 75.8 | 517,541 |
