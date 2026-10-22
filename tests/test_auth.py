# -*- coding: utf-8 -*-
"""اختبارات المصادقة والصلاحيات (SQLite في الذاكرة — لا تلمس قاعدة الإنتاج).
التشغيل:  cd backend && pytest ../tests -q
"""
import os
import sys

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["JWT_SECRET"] = "test-secret-test-secret-test-secret-123456"
os.environ.pop("ADMIN_EMAIL", None)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

import pytest
from fastapi.testclient import TestClient

from app.core.permissions import full_access, view_only
from app.core.security import hash_password
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models.user import Role, User


@pytest.fixture(scope="module")
def client():
    Base.metadata.create_all(engine, tables=[Role.__table__, User.__table__])
    db = SessionLocal()
    admin = Role(code="admin", name_ar="مدير", permissions=full_access(), is_system=True)
    viewer = Role(code="viewer", name_ar="مطّلع", permissions=view_only())
    cashier = Role(code="cashier", name_ar="كاشير", permissions={"pos": ["view", "create"]})
    db.add_all([admin, viewer, cashier])
    db.flush()
    for email, role, active in [
        ("admin@x.com", admin, True), ("view@x.com", viewer, True),
        ("cash@x.com", cashier, True), ("off@x.com", viewer, False),
    ]:
        db.add(User(full_name=email, email=email, password_hash=hash_password("Passw0rd!"),
                    role=role.code, role_id=role.id, is_active=active))
    db.commit()
    db.close()
    return TestClient(app, raise_server_exceptions=False)


def login(client, email, pw="Passw0rd!"):
    return client.post("/api/auth/login", json={"email": email, "password": pw})


def hdr(client, email):
    return {"Authorization": "Bearer " + login(client, email).json()["access_token"]}


def test_login_ok_and_me(client):
    r = login(client, "ADMIN@x.com")  # حساسية الأحرف
    assert r.status_code == 200
    me = client.get("/api/auth/me", headers={"Authorization": "Bearer " + r.json()["access_token"]})
    assert me.status_code == 200 and me.json()["role"]["code"] == "admin"


def test_login_wrong_password_and_inactive(client):
    assert login(client, "view@x.com", "bad").status_code == 401
    assert login(client, "nobody@x.com").status_code == 401
    assert login(client, "off@x.com").status_code == 403


def test_no_token_or_bad_token_rejected(client):
    for path in ["/api/journal", "/api/purchase-orders", "/api/reports/trial-balance",
                 "/api/users", "/api/items", "/api/system/reset-transactions"]:
        m = client.post if "reset" in path else client.get
        kw = {"json": {"confirm": "x"}} if "reset" in path else {}
        assert m(path, **kw).status_code == 401, path
        assert m(path, headers={"Authorization": "Bearer garbage"}, **kw).status_code == 401, path


def test_old_x_user_id_header_no_longer_works(client):
    assert client.get("/api/journal", headers={"X-User-Id": "1"}).status_code == 401


def test_viewer_cannot_write(client):
    h = hdr(client, "view@x.com")
    assert client.post("/api/journal", json={}, headers=h).status_code == 403
    assert client.post("/api/purchase-orders", json={}, headers=h).status_code == 403
    assert client.post("/api/sales-invoices", json={}, headers=h).status_code == 403


def test_cashier_blocked_from_accounting_and_users(client):
    h = hdr(client, "cash@x.com")
    assert client.get("/api/journal", headers=h).status_code == 403
    assert client.get("/api/reports/trial-balance", headers=h).status_code == 403
    assert client.get("/api/users", headers=h).status_code == 403
    assert client.get("/api/purchase-orders", headers=h).status_code == 403


def test_lookup_reads_need_only_login_but_writes_need_permission(client):
    h = hdr(client, "cash@x.com")
    assert client.get("/api/items", headers=h).status_code not in (401, 403)
    assert client.post("/api/items", json={}, headers=h).status_code == 403


def test_admin_passes_guard(client):
    h = hdr(client, "admin@x.com")
    assert client.get("/api/journal", headers=h).status_code not in (401, 403)
    assert client.get("/api/users", headers=h).status_code not in (401, 403)


def test_reset_transactions_admin_only(client):
    h = hdr(client, "view@x.com")
    assert client.post("/api/system/reset-transactions", json={"confirm": "تصفير الحركات"},
                       headers=h).status_code == 403


def test_unclassified_path_denied_for_non_admin(client):
    from app.core.security import resolve_route_permission
    assert resolve_route_permission("GET", "/api/unknown") is None
    assert resolve_route_permission("POST", "/api/journal/5/approve") == ("accounts", "approve")


def test_change_password(client):
    h = hdr(client, "cash@x.com")
    assert client.post("/api/auth/change-password",
                       json={"current_password": "nope", "new_password": "NewPassw0rd!"},
                       headers=h).status_code == 400
    assert client.post("/api/auth/change-password",
                       json={"current_password": "Passw0rd!", "new_password": "short"},
                       headers=h).status_code == 422
    assert client.post("/api/auth/change-password",
                       json={"current_password": "Passw0rd!", "new_password": "NewPassw0rd!"},
                       headers=h).status_code == 200
    assert login(client, "cash@x.com", "NewPassw0rd!").status_code == 200


def test_lockout_after_repeated_failures(client):
    for _ in range(5):
        login(client, "lock@x.com", "bad")
    assert login(client, "lock@x.com", "bad").status_code == 429


def test_login_page_and_localization_public(client):
    assert client.get("/api").status_code == 200


def test_cors_preflight_for_local_dev_with_authorization_header(client):
    r = client.options("/api/journal", headers={
        "Origin": "http://localhost:8080", "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization,content-type"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:8080"
    assert "authorization" in r.headers["access-control-allow-headers"].lower()


def test_cors_blocks_foreign_origin(client):
    r = client.options("/api/journal", headers={
        "Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in r.headers
