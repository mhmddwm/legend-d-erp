# -*- coding: utf-8 -*-
"""راوتر صغير يرجع كتالوج الوحدات/الإجراءات لبناء مصفوفة الصلاحيات بالواجهة."""
from fastapi import APIRouter

from app.core.permissions import MODULES, ACTIONS
from app.schemas.users import PermissionsCatalogOut

router = APIRouter(prefix="/api/permissions", tags=["Roles & Permissions"])


@router.get("/catalog", response_model=PermissionsCatalogOut)
def get_permissions_catalog():
    return {"modules": MODULES, "actions": ACTIONS}
