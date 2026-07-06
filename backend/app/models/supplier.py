from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func

from app.database import Base


class Supplier(Base):
    __tablename__ = "suppliers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    code = Column(String)
    phone = Column(String)
    email = Column(String)
    status = Column(String, default="active")
    created_at = Column(DateTime, server_default=func.now())