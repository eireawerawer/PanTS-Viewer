"""End-to-end tests for the auth endpoints via a Flask test client.

Only the auth blueprint is registered (it doesn't pull in the heavy nibabel/
scipy stack), so the full register -> cookie -> me -> logout flow, the
require_auth guard, and /me/jobs are exercised without the whole app.
"""

import importlib

import pytest


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'auth_ep.db'}")
    import constants
    importlib.reload(constants)
    import models.engine as engine
    importlib.reload(engine)
    import models.user  # noqa: F401
    import models.auth_session  # noqa: F401
    import services.auth_store as auth_store
    importlib.reload(auth_store)
    import services.job_store  # noqa: F401
    import api.auth as auth_mod
    importlib.reload(auth_mod)
    import api.auth_blueprint as bp_mod
    importlib.reload(bp_mod)

    engine.reset_engine_for_tests()
    engine.create_all()
    auth_store.ensure_system_user()

    from flask import Flask
    app = Flask(__name__)
    app.register_blueprint(bp_mod.auth_blueprint, url_prefix="/api")
    with app.test_client() as c:
        yield c
    engine.reset_engine_for_tests()


def test_register_sets_cookie_and_me_works(client):
    r = client.post("/api/auth/register", json={"email": "a@b.com", "password": "password1"})
    assert r.status_code == 201
    assert r.get_json()["user"]["email"] == "a@b.com"
    assert "bm_session" in r.headers.get("Set-Cookie", "")

    # cookie persists on the test client -> /me is authenticated
    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.get_json()["user"]["email"] == "a@b.com"


def test_me_requires_auth(client):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/me/jobs").status_code == 401


def test_register_validation_and_duplicate(client):
    assert client.post("/api/auth/register", json={"email": "x@y.com", "password": "short"}).status_code == 400
    assert client.post("/api/auth/register", json={"email": "", "password": "password1"}).status_code == 400
    client.post("/api/auth/register", json={"email": "dup@y.com", "password": "password1"})
    dup = client.post("/api/auth/register", json={"email": "dup@y.com", "password": "password2"})
    assert dup.status_code == 409


def test_login_wrong_password(client):
    client.post("/api/auth/register", json={"email": "c@d.com", "password": "password1"})
    client.get("/api/auth/logout")  # drop the auto-login cookie
    bad = client.post("/api/auth/login", json={"email": "c@d.com", "password": "nope"})
    assert bad.status_code == 401
    good = client.post("/api/auth/login", json={"email": "c@d.com", "password": "password1"})
    assert good.status_code == 200


def test_logout_clears_session(client):
    client.post("/api/auth/register", json={"email": "e@f.com", "password": "password1"})
    assert client.get("/api/auth/me").status_code == 200
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401


def test_me_jobs_empty_for_new_user(client):
    client.post("/api/auth/register", json={"email": "g@h.com", "password": "password1"})
    r = client.get("/api/me/jobs")
    assert r.status_code == 200
    assert r.get_json() == {"jobs": []}
