# Running the data pipeline

This guide is for whoever runs the data pipeline on their own computer. No Python experience is needed. Copy and paste the commands in order.

The pipeline downloads open NASA and partner datasets and turns them into a few small files in `web/public/data/` that the website uses. It runs **once**. When it finishes, you commit the output files and push.

---

## 1. Prerequisites

| You need | Check | Get it |
|---|---|---|
| Git | `git --version` | https://git-scm.com/downloads |
| Internet access | | Downloads ~1.5 GB without a NASA token, ~10–12 GB with one |
| Free disk space | | **≥ 10 GB** without a token, **≥ 25 GB** with one |
| RAM | | 8 GB is enough, 16 GB is comfortable |
| Python | *not needed*: the setup script installs its own Python with `uv` | (or install Python 3.10–3.13 from python.org) |
| Docker (alternative) | `docker --version` | only if you prefer the Docker route (section 3c) |

**Optional: NASA Earthdata token.** With a token the pipeline uses the *preferred* datasets (MODIS temperature, vegetation and land cover, Black Marble night lights, MERRA-2 dust). Without one it uses no-login NASA sources (NASA POWER and GIBS). Both routes work.

To get a token: create a free account at https://urs.earthdata.nasa.gov, open **Generate Token**, and copy the token.

## 2. Clone

```bash
git clone https://github.com/PseudonymD/site-comparer-thing.git
```

```bash
cd site-comparer-thing
```

Run every command below from this `site-comparer-thing` folder (the repository root).

## 3. Setup (pick ONE)

### 3a. Windows (PowerShell)

```powershell
powershell -ExecutionPolicy Bypass -File pipeline\setup.ps1
```

```powershell
.venv\Scripts\Activate.ps1
```

If `Activate.ps1` is blocked, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or skip activation and type `.venv\Scripts\python.exe` instead of `python` in every command below.

### 3b. macOS / Linux

```bash
bash pipeline/setup.sh
```

```bash
source .venv/bin/activate
```

### 3c. Docker (any OS)

```bash
docker compose build
```

With Docker, replace `python -m pipeline` with `docker compose run --rm pipeline` in every command below. For example:

```bash
docker compose run --rm pipeline doctor
```

### Add your token (optional)

The setup created a file named `.env` in the repository root. Open it in any text editor and paste your token after the `=`:

```
EARTHDATA_TOKEN=eyJ0eXAiOiJKV1Qi...
```

`.env` is git-ignored, so it never gets committed.

## 4. Check, test, run, publish

**1. Check your machine** (about 30 s). This prints a ✅ / ⚠️ table covering Python, disk, RAM, each data server and your token.

```bash
python -m pipeline doctor
```

A ⚠️ on one data server is not fatal. That feature falls back to another source automatically.

**2. Quick test** (a few minutes). This processes a small region (US South-West) at coarse resolution to prove everything works.

```bash
python -m pipeline run --quick
```

It should end with a **Summary** that lists which features came from the preferred source, a fallback, or a synthetic placeholder.

**3. Full run** (about 1–3 h without a token, 3–6 h with one, mostly downloading):

```bash
python -m pipeline run
```

- You can stop it at any time with **Ctrl-C**. Run the same command again and it resumes: finished downloads and steps are never repeated.
- Progress bars show each step, and a full log goes to `pipeline/logs/run-<time>.log`.
- To check progress from another terminal:

```bash
python -m pipeline status
```

**4. Publish.** This copies the outputs into `web/public/data/`, checks file sizes and formats, and prints the git commands to run next.

```bash
python -m pipeline publish
```

**5. Commit and push.** The exact commands are printed by `publish`. They look like this:

```bash
git add web/public/data pipeline/report.md
```

```bash
git commit -m "data: full pipeline run"
```

```bash
git push
```

The website rebuilds automatically on push to `main`. If you pushed to another branch, open a pull request.

### Useful options

| Command | What it does |
|---|---|
| `python -m pipeline run --only climate` | Recompute one group (`terrain`, `climate`, `surface`, `remoteness`) and keep the rest |
| `python -m pipeline run --force` | Recompute features even if cached (downloads are still reused) |
| `python -m pipeline run --bbox -10,35,5,45` | Process a region only (`minlon,minlat,maxlon,maxlat`) |
| `python -m pipeline run --terrain-zoom 6` | Lighter terrain (≈4× fewer tiles than the default zoom 7) |
| `python -m pipeline run --offline` | No network: reuse cached results, synthetic placeholders for the rest |

## 5. Expected disk and time

| Step | Download | Time (typical home broadband) |
|---|---|---|
| Terrain (Terrarium z7, ~6,000 tiles) | ~0.6 GB | 15–40 min |
| NASA POWER climate (~2,400 requests) | ~0.3 GB | 30–90 min |
| GIBS NDVI / night lights / AOD | ~0.3 GB | 10–20 min |
| SoilGrids (2 rasters) | ~0.2 GB | 5 min |
| GLiM lithology | ~1 GB | 10–20 min + ~10 min processing |
| *with token:* MODIS LST, NDVI, land cover | ~2.5 GB | 20–40 min |
| *with token:* Black Marble night lights | ~6 GB | 30–90 min |
| *with token:* MERRA-2 aerosols | ~0.8 GB | 10 min |
| Normalise, export, validate | – | ~2 min |

All downloads go to `pipeline/cache/` (git-ignored). You can delete that folder after publishing.

## 6. Troubleshooting

**`doctor` shows ⚠️ for every server / "ProxyError" / timeouts.** You are probably behind a proxy (corporate or university network). Set your proxy before running, then run `doctor` again:

macOS / Linux:

```bash
export HTTPS_PROXY=http://proxy.example.com:8080
```

Windows:

```powershell
$env:HTTPS_PROXY="http://proxy.example.com:8080"
```

If the proxy inspects TLS, also point `REQUESTS_CA_BUNDLE` at your organisation's CA file. Alternatively, use a home or phone-hotspot connection for the download, then run with `--offline` later.

**"No space left on device" / low disk.** Free space, or move the repository to a bigger drive. Use `--terrain-zoom 6`, and skip the token, which removes the ~9 GB of MODIS and Black Marble downloads. You can delete `pipeline/cache/black_marble` once its feature is done.

**Earthdata `401` / `403`.**
- The token may have expired (tokens last 60 days). Generate a new one.
- Some datasets need you to approve the data provider once: log in at https://urs.earthdata.nasa.gov, open **Applications → Authorized Apps**, and approve *LP DAAC Data Pool*, *LAADS DAAC* and *NASA GESDISC DATA ARCHIVE*.
- Without a working token everything still runs on the no-login fallbacks.

**Windows: very slow, or "permission denied" while writing files.** Antivirus real-time scanning slows down writing tens of thousands of small files. Add an exclusion for the repository folder (Windows Security → Virus & threat protection → Exclusions), or for `pipeline\cache` only. Also keep the repository out of OneDrive-synced folders.

**`pyhdf` failed to install (Intel Macs).** This is fine. MODIS needs it, so those features fall back to NASA POWER and GIBS automatically.

**GLiM download fails.** Download "LiMW_GIS 2015.gdb.zip" manually from https://doi.org/10.1594/PANGAEA.788537 and put it in `pipeline/cache/glim/`. Then run again.

**The run crashed or the computer slept.** Run the same command again. It resumes from where it stopped.

**Something is marked SYNTHETIC in the summary.** That source could not be reached at all, so a clearly-flagged placeholder was generated so the website still works. Check `doctor`, fix the connection, then recompute that group:

```bash
python -m pipeline run --only climate --force
```

**Output files are bigger than 50 MB.** `publish` warns about this. Push the other files, then run the **Release data files** workflow from the GitHub Actions tab. The site build fetches the data from the latest release instead.

When asking for help, include the latest log file from `pipeline/logs/` and the output of `python -m pipeline status`.
