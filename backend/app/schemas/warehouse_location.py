from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class WarehouseLocationBase(BaseModel):
    warehouse_id: int
    name: str
    rack: Optional[str] = None
    bin: Optional[str] = None


class WarehouseLocationCreate(WarehouseLocationBase):
    pass


class WarehouseLocationUpdate(BaseModel):
    name: Optional[str] = None
    rack: Optional[str] = None
    bin: Optional[str] = None


class WarehouseLocationOut(WarehouseLocationBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True