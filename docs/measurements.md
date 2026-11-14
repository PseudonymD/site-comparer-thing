# Physical measurements and Earth complications

The dossier keeps three quantities separate:

- **Physical measurement**: the feature value reconstructed from the selected Earth cell and its unit.
- **Percentile**: the feature's rank within the Earth-land normalization domain.
- **Similarity contribution**: the weighted normalized interval mismatch used by the existing score.

Each feature's expandable provenance row identifies the selected source, measurement class, native or aggregate resolution, temporal coverage, coverage/gap policy, data quality, and whether the source publishes an uncertainty estimate. A missing uncertainty is shown explicitly; it is not inferred from a percentile.

Planetary values remain literature-derived target inputs. Their references and target classification are shown separately from the Earth measurement. User-selected intervals are displayed in Earth units through the existing breakpoints, but they remain comparison tolerances rather than suitability claims.

## Earth complications

Comparison + Earth complications adds contextual evidence without modifying the similarity score. It covers:

- atmospheric pressure and gravity differences using NASA Moon and Mars fact sheets;
- available weather and moisture summaries;
- NDVI as a vegetation proxy;
- mapped soil and lithology context;
- aerosol optical depth as a column dust proxy;
- terrain-only accessibility context.

Unavailable fields are identified rather than filled with synthetic values. Wind, local atmospheric pressure, route connectivity, infrastructure, local dust flux, regolith mineralogy, and reduced-gravity behavior are not inferred by this interface.
