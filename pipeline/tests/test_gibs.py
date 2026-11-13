import numpy as np

from pipeline.grid import Grid
from pipeline.sources import _gibs

CAPS = (
    "<Layer><ows:Identifier>MODIS_Terra_L3_NDVI_Monthly</ows:Identifier>"
    "<ows:Metadata xlink:type='simple' xlink:href='https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_L3_NDVI.xml'"
    " xlink:title='GIBS Color Map: Data - RGB Mapping'/>"
    "<ows:Metadata xlink:href='https://gibs.earthdata.nasa.gov/colormaps/v1.0/MODIS_L3_NDVI.xml'/></Layer>"
)


def test_capabilities_colormap_single_quoted(tmp_path, monkeypatch):
    p = tmp_path / "gibs" / "WMTSCapabilities.xml"
    p.parent.mkdir(parents=True)
    p.write_text(CAPS)
    monkeypatch.setattr(_gibs, "download", lambda *a, **k: None)
    assert _gibs.capabilities_colormap(tmp_path, "MODIS_Terra_L3_NDVI_Monthly") == "MODIS_L3_NDVI"


def test_layer_mean_coverage_judged_inside_bbox(tmp_path, monkeypatch):
    grid = Grid(0.5, (-120.0, 30.0, -100.0, 45.0))
    H, W = int(180 / _gibs.PIX_DEG), int(360 / _gibs.PIX_DEG)

    def fake_fetch(cache_dir, layer, time, grid_):
        rgba = np.zeros((H, W, 4), np.uint8)
        rs, cs = grid_.bbox_slices()
        k = grid_.res / _gibs.PIX_DEG
        rgba[int(rs.start * k):int(rs.stop * k), int(cs.start * k):int(cs.stop * k)] = 255
        return rgba

    monkeypatch.setattr(_gibs, "fetch_layer", fake_fetch)
    out = _gibs.layer_mean(tmp_path, grid, "x", [None], mode="luminance")
    assert np.isfinite(out[grid.bbox_mask()]).all()
