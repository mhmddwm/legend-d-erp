from pydantic import BaseModel, Field
from typing import Optional
from datetime import date


class ItemIn(BaseModel):
    code: str
    name: str
    unit: str = "حبة"
    default_cost: float = 0
    price: float = 0
    opening_qty: float = 0
    reorder_level: float = 0


class ItemUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    unit: Optional[str] = None
    default_cost: Optional[float] = None
    price: Optional[float] = None
    reorder_level: Optional[float] = None


class ItemOut(BaseModel):
    code: str
    name: str
    unit: str
    default_cost: float
    price: float
    qty: float
    avg_cost: float
    reorder_level: float

    class Config:
        from_attributes = True


class StockMoveOut(BaseModel):
    id: int
    move_date: date
    item_code: str
    move_type: str
    reference: Optional[str]
    qty: float
    unit_cost: float
    balance_after: float

    class Config:
        from_attributes = True


class SupplierIn(BaseModel):
    code: str
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None


class SupplierUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None


class SupplierOut(BaseModel):
    code: str
    name: str
    phone: Optional[str]
    email: Optional[str]
    notes: Optional[str]
    payable_balance: float = 0

    class Config:
        from_attributes = True
