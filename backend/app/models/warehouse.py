from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func

from app.database import Base


class Warehouse(Base):
    __tablename__ = "warehouses"

    id = Column(Integer, primary_key=True)

    code = Column(
        String(30),
        unique=True,
        nullable=False
    )

    name = Column(
        String(200),
        nullable=False
    )

    location = Column(String(200))

    manager = Column(String(100))

    is_active = Column(
        Boolean,
        default=True
    )

    # يُستخدم كمستودع افتراضي عند عدم تحديد مستودع صراحةً بعملية شراء
    # (العمود مُضاف بقاعدة البيانات عبر Migration 002/023؛ مُعرَّف هنا
    # بالنموذج حتى يعمل ORM بشكل صحيح)
    is_default = Column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
    )

    created_at = Column(
        DateTime,
        server_default=func.now()
    )