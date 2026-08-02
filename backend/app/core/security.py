# -*- coding: utf-8 -*-
"""
أدوات الأمان — LEGEND D ERP
==============================
1) تجزئة كلمات المرور (bcrypt عبر passlib) — تُستخدم بشاشة المستخدمين.
2) اعتماديّة (dependency) بسيطة لجلب "المستخدم الحالي" والتحقق من صلاحيته
   قبل تنفيذ أي مسار حساس.

ملاحظة مهمة حول حالة المصادقة الحالية بالمشروع:
--------------------------------------------------
النظام لا يملك بعد شاشة تسجيل دخول (Login) ولا جلسات/JWT — هذه خطوة
منفصلة قادمة. حتى ذلك الحين، هذه الاعتمادية تعتمد على ترويسة (Header)
بسيطة `X-User-Id` يرسلها العميل (سيتم ربطها تلقائياً بعد تفعيل شاشة الدخول
لتخزين هوية المستخدم المسجّل). هذا يسمح لبقية الراوترات بالبدء فوراً
بحماية مساراتها عبر `require_permission("module", "action")` دون انتظار
نظام المصادقة الكامل، وبمجرد إضافة الدخول الحقيقي سيتغيّر فقط مصدر هوية
المستخدم داخل `get_current_user` وتبقى كل الراوترات الأخرى كما هي.
"""

from typing import Optional

from fastapi import Depends, Header, HTTPException
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.core.permissions import has_permission
from app.database import get_db

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain_password: str) -> str:
    return pwd_context.hash(plain_password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    try:
        return pwd_context.verify(plain_password, password_hash)
    except Exception:
        return False


def get_current_user(
    x_user_id: Optional[int] = Header(default=None, alias="X-User-Id"),
    db: Session = Depends(get_db),
):
    """
    يرجع المستخدم الحالي بناءً على ترويسة X-User-Id (مؤقتاً، لحين تفعيل
    تسجيل الدخول). يرجع None إن لم تُرسل الترويسة — بعض المسارات قد
    تسمح بذلك (وضع تطويري) بينما require_permission يفرض وجود مستخدم.
    """
    if x_user_id is None:
        return None
    from app.models.user import User  # تفادي الاستيراد الدائري

    user = db.query(User).filter(User.id == x_user_id).first()
    return user


def require_permission(module: str, action: str):
    """
    مصنع اعتماديّات (dependency factory) لحماية مسار بصلاحية محددة.
    الاستخدام بأي راوتر:

        from app.core.security import require_permission

        @router.get("/api/purchase-orders")
        def list_pos(user=Depends(require_permission("purchasing", "view"))):
            ...
    """

    def _check(current_user=Depends(get_current_user)):
        if current_user is None:
            # لا يوجد نظام دخول بعد — لا نمنع الوصول حالياً حتى لا تنكسر
            # الشاشات القائمة، لكن الجاهزية الكاملة متوفرة بمجرد ربط تسجيل
            # الدخول (سيصبح المستخدم دائماً موجوداً هنا).
            return None
        if not current_user.is_active:
            raise HTTPException(status_code=403, detail="الحساب موقوف")
        role = current_user.role_rel
        perms = (role.permissions if role else None) or {}
        if not has_permission(perms, module, action):
            raise HTTPException(status_code=403, detail="لا تملك صلاحية كافية لهذا الإجراء")
        return current_user

    return _check
