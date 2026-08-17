from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func

from app.database import Base


class AuditLog(Base):
    """سجل نشاط حقيقي (بديل AuditService الهيكلي غير المتصل بتخزين).
    كل صف يمثل حركة واحدة على مستند معيّن (مثال: فاتورة مشتريات):
    من أنشأها ومتى بالضبط، وما الذي تغيّر إن كان تعديلاً."""
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True)
    entity_type = Column(String(40), nullable=False)
    entity_id = Column(String(40), nullable=False)
    action = Column(String(40), nullable=False)
    actor = Column(String(120), nullable=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
