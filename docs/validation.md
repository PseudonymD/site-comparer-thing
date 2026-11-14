# Known-analog validation

The validation tab uses the generated `validation.json` results and the known-analog registry. It reports ranks and top-10/top-25/top-50 counts for the selected planetary target without recomputing or changing the live similarity model.

The registry is not an independent hold-out set. All listed sites were known before evaluation. Registry entries are therefore classified as development sites, with University Valley marked as parameter-tuning because it was added during the Arcadia analog-list revision. The remaining registry notes are marked as incomplete validation documentation because they do not contain a complete independent evaluation protocol or source record.

The pipeline evaluates every land cell using the target's default weights and filters. A site's score is the best cell within approximately ±2 grid cells (~20 km) of its published coordinate, compared with the configured random-land sample. ROC-AUC is a method sanity check, not predictive accuracy.
