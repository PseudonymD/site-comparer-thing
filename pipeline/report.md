# Validation report

Generated 2026-11-13 17:36. Land cells scored: 2,143,220.

For each planetary target we score every land cell with the target's default weights and default filters (non-ice targets exclude cells with > 50 % permanent ice), then compare the **known analog sites** used for that body against **1000 random land cells**. A site's score is the best cell within ±2 cells (~±20 km) of its published coordinates; random cells use the same rule. ROC-AUC = probability that a known analog outranks a random land cell (0.5 = chance, 1.0 = perfect).

> ⚠️ **3 feature(s) were SYNTHETIC in this run** (ndvi, basalt, aod). These numbers are only a smoke test of the method until the real pipeline run replaces them.

| Target | ROC-AUC | Median analog percentile | Random median score |
|---|---|---|---|
| Moon – South Pole (Artemis) | 0.719 | 84.6 | 0.515 |
| Moon – Mare / lava tube (Marius Hills) | 0.538 | 56.6 | 0.500 |
| Mars – Jezero crater | 0.929 | 97.5 | 0.488 |
| Mars – Gale crater | 0.948 | 98.2 | 0.487 |
| Mars – Arcadia Planitia (mid-latitude ice) | 0.309 | 15.9 | 0.549 |
| Mars – North polar layered deposits | 0.620 | 77.3 | 0.530 |

## Moon – South Pole (Artemis)

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Haughton Crater, Devon Island | 0.542 | 76.0 | 513,324 |
| McMurdo Dry Valleys | 0.640 | 98.9 | 24,498 |
| Svalbard (Bockfjord, AMASE) | 0.489 | 51.3 | 1,044,557 |
| Meteor Crater (Barringer) | 0.592 | 93.1 | 147,652 |

## Moon – Mare / lava tube (Marius Hills)

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Hawaiian lava tubes (Kazumura) | 0.457 | 44.6 | 1,186,710 |
| Kīlauea | 0.494 | 57.3 | 914,646 |
| Black Point Lava Flow | 0.656 | 98.0 | 42,740 |
| Lanzarote (Timanfaya) | 0.569 | 82.9 | 366,078 |
| Askja, Iceland | 0.438 | 40.4 | 1,277,556 |
| Holuhraun lava field | 0.430 | 38.8 | 1,312,511 |
| Mauna Kea | 0.492 | 56.6 | 929,654 |

## Mars – Jezero crater

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Atacama Desert (Yungay) | 0.698 | 99.9 | 2,717 |
| Death Valley | 0.673 | 99.1 | 18,609 |
| Pilbara Craton | 0.610 | 92.5 | 160,117 |
| Mars Desert Research Station | 0.651 | 97.5 | 54,025 |
| Río Tinto | 0.593 | 89.9 | 216,209 |

## Mars – Gale crater

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Atacama Desert (Yungay) | 0.703 | 99.8 | 3,728 |
| Mars Desert Research Station | 0.652 | 97.3 | 58,048 |
| Death Valley | 0.680 | 99.2 | 16,953 |
| Pilbara Craton | 0.607 | 92.0 | 171,827 |

## Mars – Arcadia Planitia (mid-latitude ice)

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Haughton Crater, Devon Island | 0.553 | 63.0 | 793,046 |
| Svalbard (Bockfjord, AMASE) | 0.465 | 13.7 | 1,849,134 |
| McMurdo Dry Valleys | 0.599 | 84.6 | 329,833 |
| Askja, Iceland | 0.471 | 15.9 | 1,802,319 |
| Holuhraun lava field | 0.458 | 11.1 | 1,905,965 |

## Mars – North polar layered deposits

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| McMurdo Dry Valleys | 0.612 | 96.0 | 84,797 |
| Svalbard (Bockfjord, AMASE) | 0.485 | 36.2 | 1,368,031 |
| Haughton Crater, Devon Island | 0.554 | 77.3 | 486,673 |
