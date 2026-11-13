# Validation report

Generated 2026-11-13 14:23. Land cells scored: 2,143,220.

For each planetary target we score every land cell with the target's default weights and default filters (non-ice targets exclude cells with > 50 % permanent ice), then compare the **known analog sites** used for that body against **1000 random land cells**. A site's score is the best cell within ±2 cells (~±20 km) of its published coordinates; random cells use the same rule. ROC-AUC = probability that a known analog outranks a random land cell (0.5 = chance, 1.0 = perfect).

> ⚠️ **12 feature(s) were SYNTHETIC in this run** (temp_mean, temp_range, temp_min, precip, humidity, solar, ndvi, soc, sand, basalt, lights, aod). These numbers are only a smoke test of the method until the real pipeline run replaces them.

| Target | ROC-AUC | Median analog percentile | Random median score |
|---|---|---|---|
| Moon – South Pole (Artemis) | 0.782 | 89.0 | 0.543 |
| Moon – Mare / lava tube (Marius Hills) | 0.861 | 94.1 | 0.445 |
| Mars – Jezero crater | 0.774 | 79.8 | 0.431 |
| Mars – Gale crater | 0.806 | 85.7 | 0.432 |
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
| Hawaiian lava tubes (Kazumura) | 0.573 | 89.7 | 220,393 |
| Kīlauea | 0.600 | 94.1 | 126,281 |
| Black Point Lava Flow | 0.556 | 86.2 | 294,739 |
| Lanzarote (Timanfaya) | 0.558 | 86.6 | 287,335 |
| Askja, Iceland | 0.631 | 97.7 | 49,049 |
| Holuhraun lava field | 0.617 | 96.3 | 79,196 |
| Mauna Kea | 0.610 | 95.5 | 97,184 |

## Mars – Jezero crater

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Atacama Desert (Yungay) | 0.643 | 97.4 | 55,518 |
| Death Valley | 0.525 | 79.8 | 431,870 |
| Pilbara Craton | 0.585 | 90.9 | 194,099 |
| Mars Desert Research Station | 0.518 | 78.4 | 462,367 |
| Río Tinto | 0.501 | 74.6 | 543,948 |

## Mars – Gale crater

| Known analog | Score | Earth percentile | Rank |
|---|---|---|---|
| Atacama Desert (Yungay) | 0.647 | 97.5 | 53,575 |
| Mars Desert Research Station | 0.523 | 79.2 | 446,021 |
| Death Valley | 0.530 | 80.8 | 412,632 |
| Pilbara Craton | 0.586 | 90.7 | 198,950 |

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
