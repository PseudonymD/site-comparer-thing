"""NASA GIBS (Global Imagery Browse Services, no auth) WMS reader with colormap decoding.

GIBS serves visualised PNGs, not science values. For layers with a published colormap we invert the
palette (exact RGB match, nearest colour otherwise) back to the physical value; layers without one
(e.g. Black Marble true colour) are decoded as luminance and flagged as a proxy in meta.json.
"""
from __future__ import annotations

import io
import logging
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np

from ..grid import Grid
from ..util import download
from ._regrid import cmg_to_grid

log = logging.getLogger("pipeline.gibs")

HOST = "https://gibs.earthdata.nasa.gov"
WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
PROBE = WMS + "?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0"
COLORMAP = "https://gibs.earthdata.nasa.gov/colormaps/v1.3/{name}.xml"
TILE_DEG = 30
PIX_DEG = 0.05


def _tile_path(cache_dir: Path, layer: str, time: str, lon0: int, lat0: int) -> Path:
    return Path(cache_dir) / "gibs" / layer / time / f"{lon0}_{lat0}.png"


def fetch_layer(cache_dir: Path, layer: str, time: str | None, grid: Grid) -> np.ndarray:
    """Global RGBA mosaic (uint8, H x W x 4) at PIX_DEG for one layer/time (tiles cached)."""
    from PIL import Image
    from tqdm import tqdm

    npx = int(round(TILE_DEG / PIX_DEG))
    H, W = int(round(180 / PIX_DEG)), int(round(360 / PIX_DEG))
    out = np.zeros((H, W, 4), dtype=np.uint8)
    rs, cs = grid.bbox_slices()
    lat_hi = 90 - rs.start * grid.res
    lat_lo = 90 - rs.stop * grid.res
    lon_lo = -180 + cs.start * grid.res
    lon_hi = -180 + cs.stop * grid.res
    tiles = [(lo, la) for la in range(-90, 90, TILE_DEG) for lo in range(-180, 180, TILE_DEG)
             if la < lat_hi and la + TILE_DEG > lat_lo and lo < lon_hi and lo + TILE_DEG > lon_lo]
    for lon0, lat0 in tqdm(tiles, desc=f"GIBS {layer[:32]} {time or ''}", unit="tile", leave=False):
        params = {
            "SERVICE": "WMS", "REQUEST": "GetMap", "VERSION": "1.3.0", "LAYERS": layer, "STYLES": "",
            "CRS": "EPSG:4326", "BBOX": f"{lat0},{lon0},{lat0 + TILE_DEG},{lon0 + TILE_DEG}",
            "WIDTH": npx, "HEIGHT": npx, "FORMAT": "image/png", "TRANSPARENT": "TRUE",
        }
        if time:
            params["TIME"] = time
        p = _tile_path(cache_dir, layer, time or "default", lon0, lat0)
        download(WMS, p, params=params, min_bytes=100, timeout=120)
        head = p.read_bytes()[:8]
        if not head.startswith(b"\x89PNG"):
            p.unlink(missing_ok=True)
            raise RuntimeError(f"GIBS returned a non-PNG response for {layer} (layer name or time invalid?)")
        im = np.asarray(Image.open(p).convert("RGBA"))
        r0 = int(round((90 - (lat0 + TILE_DEG)) / PIX_DEG))
        c0 = int(round((lon0 + 180) / PIX_DEG))
        out[r0:r0 + npx, c0:c0 + npx] = im
    return out


def load_colormap(cache_dir: Path, name: str) -> tuple[np.ndarray, np.ndarray]:
    """Return (rgb palette (N,3) uint8, values (N,) float; NaN for no-data entries)."""
    p = Path(cache_dir) / "gibs" / "colormaps" / f"{name}.xml"
    download(COLORMAP.format(name=name), p, min_bytes=100, timeout=60)
    root = ET.fromstring(p.read_bytes())
    rgbs, vals = [], []
    for cmap in root.iter():
        if not cmap.tag.endswith("ColorMap"):
            continue
        for e in cmap.iter():
            if not e.tag.endswith("ColorMapEntry"):
                continue
            rgb = [int(x) for x in e.attrib.get("rgb", "0,0,0").split(",")]
            nodata = e.attrib.get("nodata", "false") == "true" or e.attrib.get("transparent", "false") == "true"
            vals.append(np.nan if nodata else _parse_value(e.attrib.get("value") or e.attrib.get("label", "")))
            rgbs.append(rgb[:3])
    if not rgbs:
        raise RuntimeError(f"empty colormap {name}")
    return np.array(rgbs, dtype=np.uint8), np.array(vals, dtype=np.float64)


_num = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")


def _parse_value(s: str) -> float:
    """'[0.1,0.2)' -> 0.15 ; '[0.9,+INF)' -> 0.9 ; '0.3' -> 0.3 ; unparseable -> NaN."""
    nums = [float(x) for x in _num.findall(s.replace("INF", ""))]
    if not nums:
        return np.nan
    if len(nums) == 1:
        return nums[0]
    return (nums[0] + nums[1]) / 2


def decode(rgba: np.ndarray, palette: np.ndarray, values: np.ndarray) -> np.ndarray:
    """Invert a colormap: nearest palette colour for each opaque pixel."""
    from scipy.spatial import cKDTree

    out = np.full(rgba.shape[:2], np.nan, dtype=np.float32)
    opaque = rgba[..., 3] > 0
    if not opaque.any():
        return out
    px = rgba[..., :3][opaque].astype(np.int32)
    keys = (px[:, 0] << 16) | (px[:, 1] << 8) | px[:, 2]
    uniq, inv = np.unique(keys, return_inverse=True)
    urgb = np.stack([(uniq >> 16) & 255, (uniq >> 8) & 255, uniq & 255], axis=1)
    _, idx = cKDTree(palette.astype(np.float32)).query(urgb.astype(np.float32))
    out[opaque] = values[idx][inv]
    return out


def luminance(rgba: np.ndarray) -> np.ndarray:
    rgb = rgba[..., :3].astype(np.float32) / 255.0
    lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    return np.where(rgba[..., 3] > 0, lum, np.nan).astype(np.float32)


def capabilities_colormap(cache_dir: Path, layer: str) -> str | None:
    """Look up the colormap file name of a layer from the WMTS capabilities document."""
    url = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml"
    p = Path(cache_dir) / "gibs" / "WMTSCapabilities.xml"
    try:
        download(url, p, min_bytes=1000, timeout=120)
    except Exception:
        return None
    text = p.read_text(encoding="utf-8", errors="ignore")
    i = text.find(f"<ows:Identifier>{layer}</ows:Identifier>")
    if i < 0:
        return None
    j = text.rfind("<Layer>", 0, i)
    k = text.find("</Layer>", i)
    block = text[j:k]
    # Capabilities use single-quoted attributes; stop at any quote, whitespace or tag delimiter.
    m = re.search(r"""colormaps/v1\.3/([^\s"'<>]+?)\.xml""", block)
    return m.group(1) if m else None


def layer_mean(cache_dir: Path, grid: Grid, layer: str, times: list[str | None], mode: str = "colormap",
               colormap: str | None = None) -> np.ndarray:
    """Decode and average a layer over several times, then pool to the grid."""
    acc = cnt = None
    if mode == "colormap":
        cm = colormap or capabilities_colormap(cache_dir, layer) or layer
        palette, values = load_colormap(cache_dir, cm)
    for t in times:
        rgba = fetch_layer(cache_dir, layer, t, grid)
        v = decode(rgba, palette, values) if mode == "colormap" else luminance(rgba)
        if acc is None:
            acc = np.zeros(v.shape, np.float64)
            cnt = np.zeros(v.shape, np.float64)
        ok = np.isfinite(v)
        acc[ok] += v[ok]
        cnt[ok] += 1
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = np.where(cnt > 0, acc / cnt, np.nan)
    # Judge coverage only over the requested bbox (tiles outside it are never fetched).
    rs, cs = grid.bbox_slices()
    k = grid.res / PIX_DEG
    sub = mean[int(rs.start * k):int(round(rs.stop * k)), int(cs.start * k):int(round(cs.stop * k))]
    if sub.size == 0 or np.isfinite(sub).mean() < 0.05:
        raise RuntimeError(f"GIBS layer {layer} decoded to almost no valid pixels")
    return cmg_to_grid(mean, grid, PIX_DEG)
