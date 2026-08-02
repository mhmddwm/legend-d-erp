# -*- coding: utf-8 -*-
from typing import Dict, List, Optional
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


# ============================================================
# الصلاحيات (كتالوج)
# ============================================================
class CatalogItem(BaseModel):
    key: str
    name_ar: str
    name_en: Optional[str] = None


class PermissionsCatalogOut(BaseModel):
    modules: List[CatalogItem]
    actions: List[CatalogItem]


# ============================================================
# الأدوار
# ============================================================
class RoleIn(BaseModel):
    code: str = Field(min_length=2, max_length=40)
    name_ar: str = Field(min_length=2, max_length=120)
    name_en: Optional[str] = None
    description: Optional[str] = None
    permissions: Dict[str, List[str]] = Field(default_factory=dict)
    is_active: bool = True


class RoleUpdate(BaseModel):
    name_ar: Optional[str] = None
    name_en: Optional[str] = None
    description: Optional[str] = None
    permissions: Optional[Dict[str, List[str]]] = None
    is_active: Optional[bool] = None


class RoleOut(BaseModel):
    id: int
    code: str
    name_ar: str
    name_en: Optional[str] = None
    description: Optional[str] = None
    permissions: Dict[str, List[str]] = Field(default_factory=dict)
    is_system: bool
    is_active: bool
    users_count: int = 0

    class Config:
        from_attributes = True


class RoleSummaryOut(BaseModel):
    """نسخة مختصرة تُستخدم داخل UserOut لتفادي تضخيم الاستجابة."""
    id: int
    code: str
    name_ar: str
    name_en: Optional[str] = None

    class Config:
        from_attributes = True


# ============================================================
# المستخدمون
# ============================================================
class UserIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=150)
    email: EmailStr
    phone: Optional[str] = None
    password: str = Field(min_length=6, max_length=128)
    role_id: int
    is_active: bool = True


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    role_id: Optional[int] = None
    is_active: Optional[bool] = None


class UserPasswordReset(BaseModel):
    new_password: str = Field(min_length=6, max_length=128)


class UserOut(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    phone: Optional[str] = None
    is_active: bool
    role: Optional[RoleSummaryOut] = None
    last_login_at: Optional[datetime] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
