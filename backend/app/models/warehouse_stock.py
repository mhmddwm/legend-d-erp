from sqlalchemy import Column, Integer, Float, DateTime, ForeignKey
from sqlalchemy.sql import func

from app.database import Base


class WarehouseStock(Base):

    __tablename__ = "warehouse_stock"


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


    location_id = Column(
        Integer,
        ForeignKey("warehouse_locations.id"),
        nullable=False
    )


    item_id = Column(
        Integer,
        ForeignKey("items.id"),
        nullable=False
    )


    quantity = Column(
        Float,
        default=0
    )


    avg_cost = Column(
        Float,
        default=0
    )


    created_at = Column(
        DateTime,
        server_default=func.now()
    )