"""NASA Earthdata helpers: CMR granule search + token-authenticated downloads.

Token: set EARTHDATA_TOKEN in .env (generate at https://urs.earthdata.nasa.gov -> Generate Token).
Downloads keep the Authorization header across the DAAC -> URS redirects (plain `requests`
strips it on cross-host redirects, which is the usual cause of mysterious 401s).
"""
from __future__ import annotations

import logging
from pathlib import Path
from urllib.parse import urlparse

from ..util import USER_AGENT, DownloadError, download, earthdata_token, get_json

log = logging.getLogger("pipeline.earthdata")

CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
HOST = "https://cmr.earthdata.nasa.gov"
TRUSTED_REDIRECT_SUFFIXES = (".nasa.gov", ".nsidc.org")


def trusted_redirect_host(hostname: str | None) -> bool:
    """Return whether a redirect host is within a trusted Earthdata domain."""
    host = (hostname or "").rstrip(".").lower()
    return host == "nasa.gov" or host.endswith(TRUSTED_REDIRECT_SUFFIXES)


class _EarthdataSession:
    _s = None

    @classmethod
    def get(cls):
        if cls._s is None:
            import requests

            class S(requests.Session):
                def rebuild_auth(self, prepared_request, response):
                    host = urlparse(prepared_request.url).hostname or ""
                    if trusted_redirect_host(host):
                        return  # keep the bearer token for NASA hosts
                    return super().rebuild_auth(prepared_request, response)

            cls._s = S()
            cls._s.headers["User-Agent"] = USER_AGENT
        return cls._s


def require_token() -> str:
    tok = earthdata_token()
    if not tok:
        raise DownloadError("EARTHDATA_TOKEN not set")
    return tok


def search(short_name: str, temporal: str, version: str | None = None, bbox: str | None = None,
           page_size: int = 200) -> list[dict]:
    """Return CMR granule entries [{title, links:[...]}, ...] (all pages)."""
    out, page = [], 1
    while True:
        params = {"short_name": short_name, "temporal": temporal, "page_size": page_size, "page_num": page}
        if version:
            params["version"] = version
        if bbox:
            params["bounding_box"] = bbox
        js = get_json(CMR, params=params, timeout=60)
        entries = js.get("feed", {}).get("entry", [])
        out.extend(entries)
        if len(entries) < page_size:
            break
        page += 1
    return out


def data_url(entry: dict, suffixes=(".hdf", ".h5", ".nc4", ".nc")) -> str | None:
    for link in entry.get("links", []):
        href = link.get("href", "")
        if link.get("rel", "").endswith("/data#") and href.startswith("https") and href.lower().endswith(suffixes):
            return href
    return None


def fetch_file(url: str, dest_dir: Path, min_bytes: int = 10_000) -> Path:
    tok = require_token()
    dest = Path(dest_dir) / url.rsplit("/", 1)[-1]
    return download(url, dest, headers={"Authorization": f"Bearer {tok}"}, min_bytes=min_bytes,
                    timeout=600, sess=_EarthdataSession.get())
