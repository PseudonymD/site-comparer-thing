# Validation report

Generated 2026-11-13 14:18. Land cells scored: 2,143,220.

For each planetary target we score every land cell with the target's default weights, then compare the **known analog sites** used for that body against **1000 random land cells**. A site's score is the best cell within ±2 cells (~±20 km) of its published coordinates; random cells use the same rule. ROC-AUC = probability that a known analog outranks a random land cell (0.5 = chance, 1.0 = perfect).

> ⚠️ **12 feature(s) were SYNTHETIC in this run** (temp_mean, temp_range, temp_min, precip, humidity, solar, ndvi, soc, sand, basalt, lights, aod). These numbers are only a smoke test of the method until the real pipeline run replaces them.

| Target | ROC-AUC | Median analog percentile | Random median score |
|---|---|---|---|
| Moon – South Pole (Artemis) | 0.782 | 89.0 | 0.543 |
| Moon – Mare / lava tube (Marius Hills) | 0.584 | 70.7 | 0.566 |
| Mars – Jezero crater | 0.474 | 48.6 | 0.568 |
| Mars – Gale crater | 0.512 | 55.4 | 0.571 |
| Mars – Arcadia Planitia (mid-latitude ice) | 0.744 | 81.9 | 0.577 |
| Mars – North polar layered deposits | 0.825 | 91.4 | 0.532 |

## Moon – South Pole (Artemis)

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Haughton Crater, Devon Island | 0.684 | 82.6 | 372,453 |
| McMurdo Dry Valleys | 0.755 | 97.0 | 64,533 |
| Svalbard (Bockfjord, AMASE) | 0.741 | 95.4 | 98,827 |
| Meteor Crater (Barringer) | 0.553 | 58.2 | 896,179 |

## Moon – Mare / lava tube (Marius Hills)

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Hawaiian lava tubes (Kazumura) | 0.573 | 61.6 | 822,294 |
| Kīlauea | 0.600 | 70.7 | 628,596 |
| Black Point Lava Flow | 0.556 | 56.5 | 931,478 |
| Lanzarote (Timanfaya) | 0.558 | 57.0 | 921,516 |
| Askja, Iceland | 0.631 | 82.8 | 368,442 |
| Holuhraun lava field | 0.617 | 77.2 | 487,553 |
| Mauna Kea | 0.610 | 74.5 | 546,723 |

## Mars – Jezero crater

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Atacama Desert (Yungay) | 0.643 | 76.8 | 497,304 |
| Death Valley | 0.525 | 48.6 | 1,102,388 |
| Pilbara Craton | 0.585 | 61.3 | 828,618 |
| Mars Desert Research Station | 0.518 | 47.1 | 1,134,011 |
| Río Tinto | 0.501 | 43.2 | 1,217,576 |

## Mars – Gale crater

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Atacama Desert (Yungay) | 0.647 | 78.5 | 459,847 |
| Mars Desert Research Station | 0.523 | 47.9 | 1,116,888 |
| Death Valley | 0.530 | 49.5 | 1,081,919 |
| Pilbara Craton | 0.586 | 61.3 | 828,699 |

## Mars – Arcadia Planitia (mid-latitude ice)

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Haughton Crater, Devon Island | 0.693 | 81.9 | 388,265 |
| Svalbard (Bockfjord, AMASE) | 0.722 | 89.5 | 225,130 |
| McMurdo Dry Valleys | 0.713 | 87.3 | 271,826 |
| Askja, Iceland | 0.670 | 76.0 | 513,777 |
| Holuhraun lava field | 0.657 | 72.9 | 580,231 |

## Mars – North polar layered deposits

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| McMurdo Dry Valleys | 0.740 | 91.4 | 184,544 |
| Svalbard (Bockfjord, AMASE) | 0.764 | 96.1 | 84,005 |
| Haughton Crater, Devon Island | 0.684 | 76.6 | 502,063 |
