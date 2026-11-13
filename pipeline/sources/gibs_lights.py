"""Night lights from NASA GIBS (no auth): VIIRS Black Marble true-colour composite.

There is no published colormap, so the value is image *luminance* (0-1) - a relative-brightness proxy,
flagged as such in meta.json. The preferred source is black_marble (VNP46A4 radiance, Earthdata).
"""
import numpy as np

from ._gibs import HOST, PROBE  # noqa: F401
from ._gibs_source import make

NAME = "gibs_lights"
FEATURES = ["lights"]
REQUIRES_TOKEN = False
UNIT = "relative brightness (proxy)"


def _post(a):
    # Remove the dim land-surface background so unlit land reads ~0.
    base = np.nanpercentile(a, 40)
    return np.clip(a - base, 0, None).astype(np.float32)


fetch, to_grid = make(NAME, "lights", [
    ("VIIRS_Black_Marble", ["2016-01-01"], "luminance"),
    ("VIIRS_CityLights_2012", [None], "luminance"),
], post=_post)
