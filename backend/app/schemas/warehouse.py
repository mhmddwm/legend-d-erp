from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class WarehouseIn(BaseModel):
    code: str
    name: str
    location: Optional[str] = None
    manager: Optional[str] = None


class WarehouseUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    manager: Optional[str] = None
    is_active: Optional[bool] = None


class WarehouseOut(BaseModel):
    id: int
    code: str
    name: str
    location: Optional[str] = None
    manager: Optional[str] = None
    is_active: bool = True

    class Config:
        from_attributes = True


class WarehouseStockOut(BaseModel):
    item_id: int
    item_code: str
    item_name: str
    warehouse_id: int
    warehouse_code: str
    warehouse_name: str
    location_id: Optional[int] = None
    location_name: Optional[str] = None
    quantity: float
    avg_cost: float
