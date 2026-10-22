# -*- coding: utf-8 -*-
"""
راوتر المصادقة — LEGEND D ERP (PF-01.3)
  POST /api/auth/login            تسجيل الدخول ← رمز JWT
  GET  /api/auth/me               بيانات المستخدم الحالي وصلاحياته
  POST /api/auth/change-password  تغيير كلمة مرور المستخدم الحالي
"""
import time
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.core.security import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    create_access_token,
    get_current_user,
    hash_password,
    user_permissions,
    verify_password,
)
from app.database import get_db
from app.models.user import User

router = APIRouter(prefix="/api/auth", tags=["Auth"])

# ---- حد محاولات الدخول الفاشلة (في الذاكرة — يكفي لخادم واحد) ----
MAX_FAILED_ATTEMPTS = 5
LOCK_SECONDS = 300
_failed: dict = defaultdict(list)  # key -> [timestamps]

# تجزئة وهمية لتساوي زمن الرد سواء وُجد البريد أم لا
_DUMMY_HASH = hash_password("not-a-real-password")


def _key(email: str, request: Request) -> str:
    ip = request.client.host if request.client else "?"
    return f"{email}|{ip}"


def _recent_failures(key: str) -> list:
    now = time.time()
    _failed[key] = [t for t in _failed[key] if now - t < LOCK_SECONDS]
    return _failed[key]


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=1, max_length=200)


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=200)


def _user_payload(user: User) -> dict:
    role = user.role_rel
    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "role": {"id": role.id, "code": role.code, "name_ar": role.name_ar} if role else None,
        "permissions": user_permissions(user),
    }


@router.post("/login")
def login(payload: LoginIn, request: Request, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    key = _key(email, request)
    if len(_recent_failures(key)) >= MAX_FAILED_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail="محاولات دخول فاشلة كثيرة — انتظر بضع دقائق ثم أعد المحاولة",
        )

    user = (
        db.query(User)
        .options(joinedload(User.role_rel))
        .filter(func.lower(User.email) == email)
        .first()
    )
    ok = verify_password(payload.password, user.password_hash if user else _DUMMY_HASH)
    if not user or not ok:
        _failed[key].append(time.time())
        raise HTTPException(status_code=401, detail="البريد الإلكتروني أو كلمة المرور غير صحيحة")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="الحساب موقوف — تواصل مع مدير النظام")

    _failed.pop(key, None)
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "access_token": create_access_token(user.id),
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "user": _user_payload(user),
    }


@router.get("/me")
def me(current_user: User = Depends(get_current_user)):
    return _user_payload(current_user)


@router.post("/change-password")
def change_password(
    payload: ChangePasswordIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="كلمة المرور الحالية غير صحيحة")
    current_user.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"status": "ok", "message": "تم تغيير كلمة المرور"}
