# -*- coding: utf-8 -*-
"""
راوتر الأدوار والصلاحيات — LEGEND D ERP
كل دور يحمل مصفوفة صلاحيات (وحدة × إجراء) يتم تحريرها من شاشة
"الأدوار والصلاحيات" بالواجهة. راجع app/core/permissions.py للكتالوج.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.models.user import Role, User
from app.schemas.users import RoleIn, RoleOut, RoleUpdate
from app.core.permissions import normalize_permissions

router = APIRouter(prefix="/api/roles", tags=["Roles & Permissions"])


def to_role_out(role: Role, users_count: int = 0) -> dict:
    return {
        "id": role.id,
        "code": role.code,
        "name_ar": role.name_ar,
        "name_en": role.name_en,
        "description": role.description,
        "permissions": role.permissions or {},
        "is_system": role.is_system,
        "is_active": role.is_active,
        "users_count": users_count,
    }


@router.get("", response_model=list[RoleOut])
def list_roles(db: Session = Depends(get_db)):
    counts = dict(
        db.query(User.role_id, func.count(User.id))
        .group_by(User.role_id)
        .all()
    )
    roles = db.query(Role).order_by(Role.id.asc()).all()
    return [to_role_out(r, counts.get(r.id, 0)) for r in roles]


@router.get("/{role_id}", response_model=RoleOut)
def get_role(role_id: int, db: Session = Depends(get_db)):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="الدور غير موجود")
    users_count = db.query(User).filter(User.role_id == role_id).count()
    return to_role_out(role, users_count)


@router.post("", response_model=RoleOut, status_code=201)
def create_role(payload: RoleIn, db: Session = Depends(get_db)):
    if db.query(Role).filter(Role.code == payload.code).first():
        raise HTTPException(status_code=400, detail="رمز الدور مستخدم من قبل")

    role = Role(
        code=payload.code,
        name_ar=payload.name_ar,
        name_en=payload.name_en,
        description=payload.description,
        permissions=normalize_permissions(payload.permissions),
        is_active=payload.is_active,
        is_system=False,
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    return to_role_out(role, 0)


@router.put("/{role_id}", response_model=RoleOut)
def update_role(role_id: int, payload: RoleUpdate, db: Session = Depends(get_db)):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="الدور غير موجود")

    data = payload.model_dump(exclude_unset=True)

    if "permissions" in data:
        data["permissions"] = normalize_permissions(data["permissions"])

    if "is_active" in data and data["is_active"] is False and role.is_system:
        raise HTTPException(status_code=400, detail="لا يمكن إيقاف دور أساسي بالنظام")

    for field, value in data.items():
        setattr(role, field, value)

    db.commit()
    db.refresh(role)
    users_count = db.query(User).filter(User.role_id == role_id).count()
    return to_role_out(role, users_count)


@router.delete("/{role_id}", status_code=204)
def delete_role(role_id: int, db: Session = Depends(get_db)):
    role = db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="الدور غير موجود")

    if role.is_system:
        raise HTTPException(status_code=400, detail="لا يمكن حذف دور أساسي بالنظام")

    users_count = db.query(User).filter(User.role_id == role_id).count()
    if users_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"لا يمكن حذف الدور — مرتبط بـ {users_count} مستخدم. أعد إسنادهم لدور آخر أولاً",
        )

    db.delete(role)
    db.commit()
    return None
