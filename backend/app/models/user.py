from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class Role(Base):
    """
    الأدوار الوظيفية — الجدول موجود أصلاً بمهاجرة 002 (وحدة المستودعات)
    بحقول (code, name_ar, name_en). هنا نوسّعه بمهاجرة 016 بإضافة
    permissions/description/is_system/is_active حتى يخدم شاشة
    "الأدوار والصلاحيات" العامة، دون كسر أي استخدام سابق بوحدة المستودعات
    (user_warehouse_roles ما زال يشير لنفس الجدول roles.id).
    """

    __tablename__ = "roles"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(40), unique=True, nullable=False)
    name_ar = Column(String(120), nullable=False)
    name_en = Column(String(120))
    description = Column(String(255))

    # قاموس: {"purchasing": ["view","create",...], ...} — راجع app.core.permissions
    permissions = Column(JSON, nullable=False, default=dict)

    is_system = Column(Boolean, nullable=False, default=False)  # يمنع حذف الأدوار الأساسية
    is_active = Column(Boolean, nullable=False, default=True)

    created_at = Column(DateTime, server_default=func.now())

    users = relationship("User", back_populates="role_rel")


class User(Base):
    __tablename__ = "users"

    id = Column(
        Integer,
        primary_key=True,
        index=True
    )

    full_name = Column(
        String,
        nullable=False
    )

    email = Column(
        String,
        unique=True,
        index=True,
        nullable=False
    )

    password_hash = Column(
        String,
        nullable=False
    )

    # يبقى لأغراض التوافق الخلفي فقط (كان الحقل الوحيد سابقاً قبل ربط role_id).
    # لم يعد يُستخدم لاتخاذ قرارات الصلاحيات — المرجع الآن Role.permissions
    # عبر العلاقة role_rel / role_id.
    role = Column(
        String,
        default="user"
    )

    role_id = Column(Integer, ForeignKey("roles.id"), nullable=True)

    phone = Column(String(30), nullable=True)

    is_active = Column(
        Boolean,
        default=True
    )

    last_login_at = Column(DateTime, nullable=True)

    created_at = Column(
        DateTime,
        server_default=func.now()
    )

    updated_at = Column(
        DateTime,
        server_default=func.now(),
        onupdate=func.now()
    )

    role_rel = relationship("Role", back_populates="users")
