# -*- coding: utf-8 -*-
"""
راوتر المستخدمين — LEGEND D ERP
يعتمد على فكرة الأدوار والصلاحيات: كل مستخدم مرتبط بدور واحد (role_id)،
والدور يحمل مصفوفة الصلاحيات (وحدة × إجراء). راجع app/routers/roles.py
لإدارة الأدوار نفسها، و app/core/permissions.py لكتالوج الوحدات/الإجراءات.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.user import User, Role
from app.schemas.users import UserIn, UserOut, UserUpdate, UserPasswordReset
from app.core.security import hash_password

router = APIRouter(prefix="/api/users", tags=["Users"])


def to_user_out(user: User) -> dict:
    role = user.role_rel
    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "phone": user.phone,
        "is_active": user.is_active,
        "role": {
            "id": role.id,
            "code": role.code,
            "name_ar": role.name_ar,
            "name_en": role.name_en,
        } if role else None,
        "last_login_at": user.last_login_at,
        "created_at": user.created_at,
    }


def _active_admin_count(db: Session, exclude_user_id: Optional[int] = None) -> int:
    q = (
        db.query(User)
        .join(Role, User.role_id == Role.id)
        .filter(Role.code == "admin", User.is_active == True)  # noqa: E712
    )
    if exclude_user_id is not None:
        q = q.filter(User.id != exclude_user_id)
    return q.count()


# =========================
# GET ALL USERS (بحث/فلترة اختيارية)
# =========================
@router.get("", response_model=list[UserOut])
def get_users(
    search: Optional[str] = Query(default=None, description="بحث بالاسم أو البريد"),
    role_id: Optional[int] = Query(default=None),
    is_active: Optional[bool] = Query(default=None),
    db: Session = Depends(get_db),
):
    q = db.query(User).options(joinedload(User.role_rel))
    if search:
        like = f"%{search}%"
        q = q.filter((User.full_name.ilike(like)) | (User.email.ilike(like)))
    if role_id is not None:
        q = q.filter(User.role_id == role_id)
    if is_active is not None:
        q = q.filter(User.is_active == is_active)
    users = q.order_by(User.id.desc()).all()
    return [to_user_out(u) for u in users]


# =========================
# GET ONE USER
# =========================
@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: int, db: Session = Depends(get_db)):
    user = (
        db.query(User)
        .options(joinedload(User.role_rel))
        .filter(User.id == user_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    return to_user_out(user)


# =========================
# CREATE USER
# =========================
@router.post("", response_model=UserOut, status_code=201)
def create_user(payload: UserIn, db: Session = Depends(get_db)):
    existing_user = db.query(User).filter(User.email == payload.email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="البريد الإلكتروني مستخدم من قبل")

    role = db.query(Role).filter(Role.id == payload.role_id).first()
    if not role:
        raise HTTPException(status_code=400, detail="الدور المحدد غير موجود")
    if not role.is_active:
        raise HTTPException(status_code=400, detail="لا يمكن إسناد دور موقوف لمستخدم جديد")

    user = User(
        full_name=payload.full_name,
        email=payload.email,
        phone=payload.phone,
        password_hash=hash_password(payload.password),
        role_id=role.id,
        role="admin" if role.code == "admin" else "user",  # توافق خلفي فقط
        is_active=payload.is_active,
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return to_user_out(user)


# =========================
# UPDATE USER
# =========================
@router.put("/{user_id}", response_model=UserOut)
def update_user(user_id: int, payload: UserUpdate, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")

    data = payload.model_dump(exclude_unset=True)

    if "email" in data and data["email"] != user.email:
        dup = db.query(User).filter(User.email == data["email"], User.id != user_id).first()
        if dup:
            raise HTTPException(status_code=400, detail="البريد الإلكتروني مستخدم من قبل")

    if "role_id" in data:
        role = db.query(Role).filter(Role.id == data["role_id"]).first()
        if not role:
            raise HTTPException(status_code=400, detail="الدور المحدد غير موجود")
        user.role = "admin" if role.code == "admin" else "user"

    if "is_active" in data and data["is_active"] is False:
        if user.role_rel and user.role_rel.code == "admin" and _active_admin_count(db, exclude_user_id=user.id) == 0:
            raise HTTPException(status_code=400, detail="لا يمكن إيقاف آخر مدير نظام نشط بالنظام")

    for field, value in data.items():
        setattr(user, field, value)

    db.commit()
    db.refresh(user)
    return to_user_out(user)


# =========================
# RESET PASSWORD
# =========================
@router.post("/{user_id}/reset-password", response_model=UserOut)
def reset_password(user_id: int, payload: UserPasswordReset, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    db.refresh(user)
    return to_user_out(user)


# =========================
# TOGGLE ACTIVE (تفعيل/إيقاف سريع)
# =========================
@router.post("/{user_id}/toggle-active", response_model=UserOut)
def toggle_active(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")

    if user.is_active and user.role_rel and user.role_rel.code == "admin":
        if _active_admin_count(db, exclude_user_id=user.id) == 0:
            raise HTTPException(status_code=400, detail="لا يمكن إيقاف آخر مدير نظام نشط بالنظام")

    user.is_active = not user.is_active
    db.commit()
    db.refresh(user)
    return to_user_out(user)


# =========================
# DELETE USER
# =========================
@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="المستخدم غير موجود")

    if user.role_rel and user.role_rel.code == "admin" and _active_admin_count(db, exclude_user_id=user.id) == 0:
        raise HTTPException(status_code=400, detail="لا يمكن حذف آخر مدير نظام بالنظام")

    db.delete(user)
    db.commit()
    return None
