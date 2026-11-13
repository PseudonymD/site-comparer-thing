import pytest


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path, monkeypatch):
    """Every test gets its own cache dir so markers/grids never touch pipeline/cache."""
    import pipeline.util as util

    monkeypatch.setattr(util, "CACHE_DIR", tmp_path / "cache")
    return tmp_path / "cache"
