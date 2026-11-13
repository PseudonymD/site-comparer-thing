"""Aerosol optical depth from NASA GIBS (no auth), colormap-decoded, mean of 4 seasonal months."""
from ._gibs import HOST, PROBE  # noqa: F401
from ._gibs_source import make

NAME = "gibs_aod"
FEATURES = ["aod"]
REQUIRES_TOKEN = False
YEAR = 2023
TIMES = [f"{YEAR}-{m:02d}-01" for m in (1, 4, 7, 10)]
fetch, to_grid = make(NAME, "aod", [
    ("MERRA2_Total_Aerosol_Optical_Thickness_550nm_Extinction_Monthly", TIMES, "colormap"),
    ("MERRA2_Total_Aerosol_Optical_Thickness_550nm_Scattering_Monthly", TIMES, "colormap"),
    ("MODIS_Combined_Value_Added_AOD", TIMES, "colormap"),
])
