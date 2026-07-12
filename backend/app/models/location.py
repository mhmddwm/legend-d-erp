from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.sql import func

from app.database import Base


class WarehouseLocation(Base):

    __tablename__ = "warehouse_locations"


    id = Column(
        Integer,
        primary_key=True,
        index=True
    )


    warehouse_id = Column(
        Integer,
        ForeignKey("warehouses.id"),
        nullable=False
    )


    code = Column(
        String,
        nullable=False
    )


    name = Column(
        String,
        nullable=False
    )


    zone = Column(
        String
    )


    rack = Column(
        String
    )


    bin = Column(
        String
    )


    created_at = Column(
        DateTime,
        server_default=func.now()
    )