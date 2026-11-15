# -*- coding: utf-8 -*-
"""إنشاء مدير النظام الأول عند الإقلاع إن كان جدول المستخدمين فارغاً.

يعتمد على ADMIN_EMAIL و ADMIN_PASSWORD من .env. إن لم يُضبطا ولا يوجد أي
مستخدم، يُكتب تحذير ويمكن استخدام: python scripts/create_admin.py
"""
import logging
import os

from app.core.permissions import full_access
from app.core.security import hash_password
from app.database import SessionLocal
from app.models.user import Role, User

logger = logging.getLogger("uvicorn.error")


def get_or_create_admin_role(db) -> Role:
    role = db.query(Role).filter(Role.code == "admin").first()
    if role is None:
        role = Role(
            code="admin", name_ar="مدير النظام", name_en="Administrator",
            description="وصول كامل لكل وحدات النظام", permissions=full_access(),
            is_system=True, is_active=True,
        )
        db.add(role)
        db.flush()
    return role


def upsert_admin(db, email: str, password: str, full_name: str = "مدير النظام") -> User:
    """ينشئ المدير أو يعيد ضبط كلمة مروره ويفعّله ويربطه بدور admin."""
    role = get_or_create_admin_role(db)
    email = email.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        user = User(full_name=full_name, email=email, password_hash=hash_password(password),
                    role="admin", role_id=role.id, is_active=True)
        db.add(user)
    else:
        user.password_hash = hash_password(password)
        user.role_id = role.id
        user.is_active = True
    db.commit()
    return user


def ensure_initial_admin() -> None:
    db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            return
        email = os.getenv("ADMIN_EMAIL", "").strip()
        password = os.getenv("ADMIN_PASSWORD", "")
        if not email or len(password) < 8:
            logger.warning(
                "لا يوجد أي مستخدم ولم تُضبط ADMIN_EMAIL/ADMIN_PASSWORD (8 أحرف فأكثر). "
                "أنشئ المدير بالأمر: python scripts/create_admin.py"
            )
            return
        upsert_admin(db, email, password)
        logger.warning("تم إنشاء مدير النظام الأول: %s — غيّر كلمة المرور بعد أول دخول.", email)
    except Exception as exc:  # لا نمنع إقلاع الخادم
        db.rollback()
        logger.error("تعذر إنشاء المدير الأول: %s", exc)
    finally:
        db.close()
