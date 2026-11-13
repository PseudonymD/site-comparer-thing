"""NDVI from NASA GIBS (no auth): MODIS Terra monthly NDVI imagery, colormap-decoded, 4 seasonal months."""
import numpy as np

from ._gibs import HOST, PROBE  # noqa: F401
from ._gibs_source import make

NAME = "gibs_ndvi"
FEATURES = ["ndvi"]
REQUIRES_TOKEN = False
YEAR = 2023
TIMES = [f"{YEAR}-{m:02d}-01" for m in (1, 4, 7, 10)]


def _no_retrieval_is_bare(arr: np.ndarray) -> np.ndarray:
    # GIBS NDVI has no data over permanent ice/snow (Antarctica, inner Greenland): that is bare ground,
    # not a gap to fill from the nearest vegetated pixel.
    return np.where(np.isfinite(arr), arr, 0.0).astype(np.float32)


fetch, to_grid = make(NAME, "ndvi", [
    ("MODIS_Terra_L3_NDVI_Monthly", TIMES, "colormap"),
    ("MODIS_Terra_L3_NDVI_16Day", TIMES, "colormap"),
    ("MODIS_Terra_NDVI_8Day", TIMES, "colormap"),
], post=_no_retrieval_is_bare)
