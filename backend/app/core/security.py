# -*- coding: utf-8 -*-
"""
أدوات الأمان — LEGEND D ERP (PF-01.3)
======================================
1) تجزئة كلمات المرور (bcrypt عبر passlib).
2) مصادقة JWT حقيقية: تسجيل دخول ← رمز وصول (Bearer) ← التحقق في كل طلب.
3) فرض الصلاحيات مركزياً: `enforce_route_permission` يُربط عند تضمين كل راوتر
   في main.py، فيحوّل (مسار الطلب + نوع الطلب) إلى (وحدة + إجراء) ويتحقق من
   صلاحية دور المستخدم — دون الحاجة لتعديل مئات المسارات واحداً واحداً.
4) `require_permission(module, action)` و`require_admin` لحماية مسار بعينه.

متغيرات البيئة:
  JWT_SECRET                  سر توقيع الرموز (إلزامي بالإنتاج، 32 حرفاً فأكثر)
  ACCESS_TOKEN_EXPIRE_MINUTES مدة صلاحية الرمز بالدقائق (الافتراضي 480 = 8 ساعات)
"""

import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from sqlalchemy.orm import Session, joinedload

from app.core.permissions import has_permission
from app.database import get_db

logger = logging.getLogger("uvicorn.error")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))

_secret = os.getenv("JWT_SECRET", "").strip()
if not _secret:
    # بدون سر ثابت تُفقد الجلسات عند كل إعادة تشغيل — مقبول للتجربة فقط.
    _secret = secrets.token_urlsafe(48)
    logger.warning(
        "JWT_SECRET غير مضبوط في .env — تم توليد سر مؤقت. "
        "ستنتهي كل الجلسات عند إعادة تشغيل الخادم. اضبطه قبل النشر."
    )
elif len(_secret) < 32:
    logger.warning("JWT_SECRET قصير (أقل من 32 حرفاً) — استخدم سراً أقوى.")
JWT_SECRET = _secret

_bearer = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------- كلمات المرور
def hash_password(plain_password: str) -> str:
    return pwd_context.hash(plain_password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    try:
        return pwd_context.verify(plain_password, password_hash)
    except Exception:
        return False


# ---------------------------------------------------------------------- الرموز
def create_access_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[int]:
    try:
        data = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return int(data["sub"])
    except Exception:
        return None


# ------------------------------------------------------------ المستخدم الحالي
def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
    db: Session = Depends(get_db),
):
    """يتطلب رمز Bearer صالحاً ومستخدماً فعّالاً، وإلا 401."""
    unauthorized = HTTPException(
        status_code=401,
        detail="الجلسة منتهية أو غير صالحة — سجّل الدخول من جديد",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if creds is None or creds.scheme.lower() != "bearer":
        raise unauthorized
    user_id = decode_access_token(creds.credentials)
    if user_id is None:
        raise unauthorized

    from app.models.user import User  # تفادي الاستيراد الدائري

    user = (
        db.query(User)
        .options(joinedload(User.role_rel))
        .filter(User.id == user_id)
        .first()
    )
    if user is None:
        raise unauthorized
    if not user.is_active:
        raise HTTPException(status_code=403, detail="الحساب موقوف")
    return user


def user_permissions(user) -> dict:
    role = user.role_rel
    if role is None or not role.is_active:
        return {}
    return role.permissions or {}


def require_permission(module: str, action: str):
    """حماية مسار بعينه: `user=Depends(require_permission("purchasing","view"))`."""

    def _check(current_user=Depends(get_current_user)):
        if not has_permission(user_permissions(current_user), module, action):
            raise HTTPException(status_code=403, detail="لا تملك صلاحية كافية لهذا الإجراء")
        return current_user

    return _check


def require_admin(current_user=Depends(get_current_user)):
    role = current_user.role_rel
    if role is None or role.code != "admin" or not role.is_active:
        raise HTTPException(status_code=403, detail="هذا الإجراء لمدير النظام فقط")
    return current_user


# ------------------------------------------------- الفرض المركزي على كل الراوترات
# بادئة المسار ← مفتاح الوحدة في كتالوج الصلاحيات (app/core/permissions.py)
ROUTE_MODULES = [
    ("/api/accounts", "accounts"),
    ("/api/journal", "accounts"),
    ("/api/cost-centers", "accounts"),
    ("/api/tax-types", "accounts"),
    ("/api/purchase-orders", "purchasing"),
    ("/api/grn", "purchasing"),
    ("/api/purchase-invoices", "purchasing"),
    ("/api/purchase-returns", "purchasing"),
    ("/api/supplier-payments", "purchasing"),
    ("/api/suppliers", "purchasing"),
    ("/api/sales-invoices", "sales"),
    ("/api/sales-orders", "sales"),
    ("/api/delivery-notes", "sales"),
    ("/api/sales-quotes", "sales"),
    ("/api/sales-returns", "sales"),
    ("/api/customers", "customers"),
    ("/api/items", "inventory"),
    ("/api/stock-moves", "inventory"),
    ("/api/categories", "inventory"),
    ("/api/brands", "inventory"),
    ("/api/unit-templates", "inventory"),
    ("/api/price-lists", "inventory"),
    ("/api/warehouses", "inventory"),
    ("/api/warehouse-stock", "inventory"),
    ("/api/warehouse-locations", "inventory"),
    ("/api/reports", "reports"),
    ("/api/branches", "general_settings"),
    ("/api/system", "general_settings"),
    ("/api/users", "users_permissions"),
    ("/api/roles", "users_permissions"),
    ("/api/permissions", "users_permissions"),
]

# بيانات مرجعية (قراءة فقط): تكفي المصادقة لقراءتها، لأن شاشات كثيرة تحتاجها
# كقوائم اختيار (صنف، عميل، حساب...). الكتابة عليها تتطلب صلاحية الوحدة.
LOOKUP_READ_PREFIXES = (
    "/api/accounts", "/api/cost-centers", "/api/tax-types", "/api/branches",
    "/api/items", "/api/categories", "/api/brands", "/api/unit-templates",
    "/api/price-lists", "/api/suppliers", "/api/customers",
    "/api/warehouses", "/api/warehouse-locations",
)

_METHOD_ACTIONS = {
    "GET": "view", "HEAD": "view", "OPTIONS": "view",
    "POST": "create", "PUT": "edit", "PATCH": "edit", "DELETE": "delete",
}


def _under(path: str, prefix: str) -> bool:
    return path == prefix or path.startswith(prefix + "/")


def resolve_route_permission(method: str, path: str):
    """يرجع (module, action) للطلب، أو None إن كان المسار غير مسجَّل."""
    module = next((m for p, m in ROUTE_MODULES if _under(path, p)), None)
    if module is None:
        return None
    action = _METHOD_ACTIONS.get(method.upper(), "edit")
    if "approve" in path.lower():
        action = "approve"
    return module, action


def enforce_route_permission(
    request: Request,
    current_user=Depends(get_current_user),
):
    """Dependency عام تُربط به كل الراوترات المحمية في main.py."""
    if request.method == "OPTIONS":
        return current_user
    path = request.url.path.rstrip("/") or "/"
    resolved = resolve_route_permission(request.method, path)
    if resolved is None:
        # مسار غير مصنَّف: نرفضه بدل أن نتركه مفتوحاً (إغلاق افتراضي آمن)
        if getattr(current_user.role_rel, "code", None) == "admin":
            return current_user
        raise HTTPException(status_code=403, detail="مسار غير مصنَّف أمنياً")
    module, action = resolved
    if (
        action == "view"
        and any(_under(path, p) for p in LOOKUP_READ_PREFIXES)
    ):
        return current_user
    if not has_permission(user_permissions(current_user), module, action):
        raise HTTPException(status_code=403, detail="لا تملك صلاحية كافية لهذا الإجراء")
    return current_user
