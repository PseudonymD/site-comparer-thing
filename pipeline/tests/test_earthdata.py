from types import SimpleNamespace

import requests

from pipeline.sources.earthdata import _EarthdataSession, trusted_redirect_host


def test_trusted_redirect_domains_reject_lookalikes():
    assert trusted_redirect_host("urs.earthdata.nasa.gov")
    assert trusted_redirect_host("n5eil01u.ecs.nsidc.org")
    assert trusted_redirect_host("evilnasa.gov") is False
    assert trusted_redirect_host("nasa.gov.evil.example") is False


def test_redirect_auth_is_removed_for_untrusted_host():
    session = _EarthdataSession.get()
    original = requests.Request("GET", "https://urs.earthdata.nasa.gov/file").prepare()
    request = requests.Request("GET", "https://evilnasa.gov/file").prepare()
    request.headers["Authorization"] = "Bearer secret"
    response = SimpleNamespace(request=original)
    session.rebuild_auth(request, response)
    assert "Authorization" not in request.headers
