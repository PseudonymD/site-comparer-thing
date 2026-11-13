"""Unit tests of each source's gridding on tiny synthetic inputs (no network)."""
import io
import json
import math

import numpy as np
import pytest
from PIL import Image

from pipeline.grid import Grid


# ------------------------------------------------------------------ terrain
def _terrarium_png(elev: np.ndarray) -> bytes:
    v = elev + 32768.0
    r = np.floor(v / 256)
    g = np.floor(v - r * 256)
    b = np.round((v - r * 256 - g) * 256)
    img = np.stack([r, g, b], -1).clip(0, 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, format="PNG")
    return buf.getvalue()


def test_terrarium_roundtrip():
    from pipeline.sources.terrain import decode_terrarium

    e = np.linspace(-100, 4000, 256 * 256).reshape(256, 256).astype(np.float32)
    assert np.abs(decode_terrarium(_terrarium_png(e)) - e).max() < 0.01


def test_terrain_plane_slope(tmp_path):
    """A tilted plane (constant dz/dx in metres) must give that slope everywhere."""
    from pipeline.sources import terrain

    z = 7
    terrain.set_zoom(z)
    bbox = (10.0, 40.0, 11.0, 41.0)
    grid = Grid(0.25, bbox)
    tiles = terrain.tiles_for_bbox(z, *bbox)
    slope_deg = 2.0  # keeps the plane inside Terrarium's 0..32 km encodable range
    px_min = min(x for x, _ in tiles) * 256
    for x, y in tiles:
        px = np.arange(256) + x * 256
        py = np.arange(256) + y * 256
        lat = terrain.px_to_lat(py + 0.5, z)
        pix_m = terrain.EARTH_CIRC / (256 * 2 ** z) * np.cos(np.radians(lat))
        # elevation rises eastwards: dz = tan(slope) * ground distance (per row pixel size)
        e = 100 + np.tan(np.radians(slope_deg)) * (px[None, :] - px_min) * pix_m[:, None]
        p = terrain.tile_path(tmp_path, z, x, y)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(_terrarium_png(e.astype(np.float32)))
    land = np.zeros(grid.shape, bool)
    rs, cs = grid.bbox_slices()
    land[rs, cs] = True
    out = terrain.compute(grid, tmp_path, land & grid.bbox_mask())
    s = out["slope_mean"][rs, cs]
    s = s[np.isfinite(s)]
    assert s.size > 0
    assert np.allclose(s, slope_deg, atol=0.1)
    p90 = out["slope_p90"][rs, cs]
    assert np.nanmax(np.abs(p90[np.isfinite(p90)] - slope_deg)) < 0.5
    relief = out["relief"][rs, cs]
    assert np.nanmin(relief) > 0


def test_terrain_slope_tri_kernel():
    from pipeline.sources.terrain import slope_and_tri

    e = np.zeros((5, 5), np.float32)
    e[2, 2] = 80.0
    s, t = slope_and_tri(e, np.full(5, 100.0))
    assert t[1, 1] == pytest.approx(80.0)  # centre differs by 80 from all 8 neighbours
    assert s[1, 1] == pytest.approx(0.0)  # central differences cancel at a symmetric peak


# ------------------------------------------------------------------ regrid helpers
def test_cmg_block_mean():
    from pipeline.sources._regrid import cmg_to_grid

    a = np.arange(3600 * 7200, dtype=np.float32).reshape(3600, 7200) % 7
    out = cmg_to_grid(a, Grid(0.1))
    assert out.shape == (1800, 3600)
    assert out[0, 0] == pytest.approx(a[:2, :2].mean())


def test_regular_to_grid_linear_field():
    from pipeline.sources._regrid import regular_to_grid

    lat = np.arange(90, -90.01, -0.5)
    lon = np.arange(-180, 180, 0.625)
    field = np.repeat(lat[:, None], lon.size, axis=1)
    out = regular_to_grid(field, lat, lon, Grid(0.5))
    assert np.allclose(out[:, 10], Grid(0.5).lats(), atol=1e-3)


def test_points_to_grid():
    from pipeline.sources._regrid import points_to_grid

    lat, lon = np.meshgrid(np.arange(-89.75, 90, 0.5), np.arange(-179.75, 180, 0.5), indexing="ij")
    val = np.cos(np.radians(lat)) * 10
    out = points_to_grid(lon.ravel(), lat.ravel(), val.ravel(), Grid(1.0), 0.5, 0.5)
    expect = np.cos(np.radians(Grid(1.0).lats())) * 10
    assert np.allclose(out[:, 0], expect, atol=0.05)


# ------------------------------------------------------------------ NASA POWER
def test_power_to_grid_from_cached_json(isolated_cache):
    from pipeline.sources import power

    grid = Grid(0.5, (20.0, 0.0, 30.0, 10.0))
    land = grid.bbox_mask()
    feats = []
    for la in np.arange(0.25, 10, 0.5):
        for lo in np.arange(20.3125, 30, 0.625):
            feats.append({"geometry": {"coordinates": [lo, la, 500.0]},
                          "properties": {"parameter": {"PRECTOTCORR": {"JAN": 1.0, "ANN": 2.0}}}})
    p = power._box_path(isolated_cache, 20, 0, "PRECTOTCORR")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"features": feats}))
    for prm in power.PARAMS:  # mark other params present so fetch() makes no requests
        q = power._box_path(isolated_cache, 20, 0, prm)
        if not q.exists():
            q.write_text(json.dumps({"features": []}))
    out = power.to_grid(grid, isolated_cache, "precip", land=land)
    rs, cs = grid.bbox_slices()
    assert np.allclose(out[rs, cs], 2.0 * 365.25, rtol=1e-4)


# ------------------------------------------------------------------ GIBS colormap decoding
def test_gibs_decode():
    from pipeline.sources._gibs import _parse_value, decode

    palette = np.array([[0, 0, 0], [255, 0, 0], [0, 255, 0]], np.uint8)
    values = np.array([np.nan, 0.1, 0.9])
    img = np.zeros((2, 2, 4), np.uint8)
    img[0, 0] = [255, 0, 0, 255]
    img[0, 1] = [0, 250, 3, 255]  # near-green -> nearest colour
    img[1, 0] = [0, 0, 0, 0]  # transparent -> NaN
    img[1, 1] = [0, 0, 0, 255]  # nodata colour -> NaN
    v = decode(img, palette, values)
    assert v[0, 0] == pytest.approx(0.1) and v[0, 1] == pytest.approx(0.9)
    assert math.isnan(v[1, 0]) and math.isnan(v[1, 1])
    assert _parse_value("[0.1,0.2)") == pytest.approx(0.15)
    assert _parse_value("[0.9,+INF)") == pytest.approx(0.9)


# ------------------------------------------------------------------ SoilGrids warp
def test_soilgrids_warp(tmp_path):
    import rasterio
    from rasterio.transform import from_origin

    from pipeline.sources.soilgrids import warp_to_grid

    data = np.full((180, 360), 250, np.int16)  # 25.0 g/kg in dg/kg
    data[:10] = -32768
    p = tmp_path / "soc.tif"
    with rasterio.open(p, "w", driver="GTiff", width=360, height=180, count=1, dtype="int16",
                       crs="EPSG:4326", transform=from_origin(-180, 90, 1, 1), nodata=-32768) as dst:
        dst.write(data, 1)
    out = warp_to_grid(p, Grid(2.0), 0.1)
    assert np.nanmean(out[10:]) == pytest.approx(25.0)
    assert np.isnan(out[0, 0])


# ------------------------------------------------------------------ GLiM rasterisation
def test_glim_fraction():
    import geopandas as gpd
    from shapely.geometry import box

    from pipeline.sources.glim import BASALT, _fraction

    gdf = gpd.GeoDataFrame({"cls": ["vb", "su"]}, geometry=[box(0, 0, 1, 0.5), box(0, 0.5, 1, 1)], crs=4326)
    out = _fraction(gdf, BASALT, Grid(1.0))
    g = Grid(1.0)
    assert out[g.row_of_lat(0.5), g.col_of_lon(0.5)] == pytest.approx(0.6, abs=0.11)


# ------------------------------------------------------------------ synthetic
def test_synthetic_layers_complete_and_finite():
    from pipeline.config import FEATURE_IDS
    from pipeline.sources.synthetic import layers

    L = layers(Grid(1.0))
    assert set(FEATURE_IDS) <= set(L)
    for k in FEATURE_IDS:
        assert np.isfinite(L[k]).all(), k
