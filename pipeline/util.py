"""Shared helpers: logging, .env loading, resumable downloads, done-markers."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import random
import time
from datetime import datetime
from pathlib import Path

import numpy as np

from .config import CACHE_DIR, LOG_DIR, REPO_DIR

log = logging.getLogger("pipeline")

USER_AGENT = "terrestrial-analog-finder/1.0 (NASA Space Apps 2026 data pipeline)"


# --------------------------------------------------------------------------- logging
def setup_logging(verbose: bool = False) -> Path:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    path = LOG_DIR / f"run-{datetime.now():%Y%m%d-%H%M%S}.log"
    root = logging.getLogger("pipeline")
    root.setLevel(logging.DEBUG)
    root.handlers.clear()
    fh = logging.FileHandler(path, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s"))
    root.addHandler(fh)
    sh = logging.StreamHandler()
    sh.setLevel(logging.DEBUG if verbose else logging.INFO)
    sh.setFormatter(logging.Formatter("%(message)s"))
    root.addHandler(sh)
    return path


# --------------------------------------------------------------------------- env
def load_dotenv() -> None:
    """Minimal .env reader (KEY=VALUE lines). Real environment variables win."""
    for candidate in (REPO_DIR / ".env", REPO_DIR / "pipeline" / ".env"):
        if not candidate.exists():
            continue
        for line in candidate.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k and v and k not in os.environ:
                os.environ[k] = v


def earthdata_token() -> str | None:
    load_dotenv()
    tok = os.environ.get("EARTHDATA_TOKEN", "").strip()
    return tok or None


# --------------------------------------------------------------------------- http
_session = None


def session():
    global _session
    if _session is None:
        import requests

        _session = requests.Session()
        _session.headers["User-Agent"] = USER_AGENT
    return _session


class DownloadError(RuntimeError):
    pass


def download(url: str, dest: Path, *, headers: dict | None = None, retries: int = 5,
             timeout: float = 60.0, min_bytes: int = 1, params: dict | None = None,
             accept_404: bool = False, sess=None) -> Path | None:
    """Download url -> dest atomically (via dest.part) with retries + exponential backoff.

    Returns dest, or None when accept_404 and the server says the file does not exist.
    Existing complete files are never re-downloaded.
    """
    dest = Path(dest)
    if dest.exists() and dest.stat().st_size >= min_bytes:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            with (sess or session()).get(url, headers=headers or {}, params=params, stream=True,
                               timeout=timeout, allow_redirects=True) as r:
                if r.status_code == 404 and accept_404:
                    return None
                if r.status_code in (401, 403):
                    raise DownloadError(f"HTTP {r.status_code} (auth) for {url}")
                r.raise_for_status()
                with open(part, "wb") as f:
                    for chunk in r.iter_content(chunk_size=1 << 20):
                        if chunk:
                            f.write(chunk)
            if part.stat().st_size < min_bytes:
                raise DownloadError(f"file too small ({part.stat().st_size} B) from {url}")
            os.replace(part, dest)
            return dest
        except DownloadError as e:
            if "auth" in str(e):
                raise
            last_err = e
        except Exception as e:  # network errors, timeouts, 5xx
            last_err = e
        sleep = min(60, (2 ** attempt) + random.random())
        log.debug("download retry %d/%d for %s in %.1fs (%s)", attempt + 1, retries, url, sleep, last_err)
        time.sleep(sleep)
    raise DownloadError(f"failed to download {url}: {last_err}")


def get_json(url: str, *, params: dict | None = None, retries: int = 4, timeout: float = 120.0,
             headers: dict | None = None):
    last_err = None
    for attempt in range(retries):
        try:
            r = session().get(url, params=params, timeout=timeout, headers=headers or {})
            if r.status_code == 429 or r.status_code >= 500:
                raise RuntimeError(f"HTTP {r.status_code}")
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last_err = e
            time.sleep(min(60, (2 ** attempt) + random.random()))
    raise DownloadError(f"failed GET {url}: {last_err}")


def reachable(url: str, timeout: float = 8.0) -> tuple[bool, str]:
    try:
        r = session().get(url, timeout=timeout, stream=True, allow_redirects=True)
        code = r.status_code
        r.close()
        return (code < 500 and code not in (403, 407)), f"HTTP {code}"
    except Exception as e:
        return False, type(e).__name__


# --------------------------------------------------------------------------- markers / cache
def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def marker_path(name: str) -> Path:
    return CACHE_DIR / "markers" / f"{name}.done"


def is_done(name: str) -> bool:
    return marker_path(name).exists()


def mark_done(name: str, info: dict | None = None, files: list[Path] | None = None) -> None:
    p = marker_path(name)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = {"time": datetime.now().isoformat(timespec="seconds"), **(info or {})}
    if files:
        payload["checksums"] = {str(f.name): sha256_file(f) for f in files if Path(f).exists()}
    p.write_text(json.dumps(payload, indent=1), encoding="utf-8")


def read_marker(name: str) -> dict | None:
    p = marker_path(name)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def clear_marker(name: str) -> None:
    marker_path(name).unlink(missing_ok=True)


def grid_cache_path(source: str, feature: str, grid_key: str) -> Path:
    return CACHE_DIR / "grids" / grid_key / f"{source}__{feature}.npy"


def save_grid(path: Path, arr: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part.npy")
    np.save(tmp, arr.astype(np.float32))
    os.replace(tmp, path)


def free_disk_gb(path: Path) -> float:
    import shutil

    path.mkdir(parents=True, exist_ok=True)
    return shutil.disk_usage(path).free / 1e9


def total_ram_gb() -> float | None:
    try:
        if os.name == "nt":
            import ctypes

            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                            ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                            ("sullAvailExtendedVirtual", ctypes.c_ulonglong)]

            st = MEMORYSTATUSEX()
            st.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st))
            return st.ullTotalPhys / 1e9
        if hasattr(os, "sysconf") and "SC_PHYS_PAGES" in os.sysconf_names:
            return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1e9
    except Exception:
        pass
    return None
