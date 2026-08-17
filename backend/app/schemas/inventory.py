from pydantic import BaseModel, Field
from typing import Optional
from datetime import date


class ItemIn(BaseModel):
    code: str
    name: str
    name_en: Optional[str] = None
    description: Optional[str] = None
    barcode: Optional[str] = None
    category_code: Optional[str] = None
    brand_code: Optional[str] = None
    supplier_code: Optional[str] = None
    supplier_item_code: Optional[str] = None
    status: str = "active"
    default_warehouse_id: Optional[int] = None
    default_location_id: Optional[int] = None
    unit: str = "حبة"
    default_cost: float = 0
    price: float = 0
    opening_qty: float = 0
    reorder_level: float = 0


class ItemUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    name_en: Optional[str] = None
    description: Optional[str] = None
    barcode: Optional[str] = None
    category_code: Optional[str] = None
    brand_code: Optional[str] = None
    supplier_code: Optional[str] = None
    supplier_item_code: Optional[str] = None
    status: Optional[str] = None
    default_warehouse_id: Optional[int] = None
    default_location_id: Optional[int] = None
    unit: Optional[str] = None
    default_cost: Optional[float] = None
    price: Optional[float] = None
    reorder_level: Optional[float] = None


class ItemOut(BaseModel):
    id: int
    code: str
    name: str
    name_en: Optional[str] = None
    description: Optional[str] = None
    barcode: Optional[str] = None
    category_code: Optional[str] = None
    brand_code: Optional[str] = None
    supplier_code: Optional[str] = None
    supplier_item_code: Optional[str] = None
    status: str = "active"
    default_warehouse_id: Optional[int] = None
    default_location_id: Optional[int] = None
    unit: str
    default_cost: float
    price: float
    qty: float
    avg_cost: float
    reorder_level: float
    is_active: bool = True

    class Config:
        from_attributes = True


class CategoryIn(BaseModel):
    code: str
    name_ar: str
    name_en: Optional[str] = None
    parent_code: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None


class CategoryUpdate(BaseModel):
    name_ar: Optional[str] = None
    name_en: Optional[str] = None
    parent_code: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    is_active: Optional[bool] = None


class CategoryOut(BaseModel):
    code: str
    name_ar: str
    name_en: Optional[str] = None
    parent_code: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    is_active: bool = True

    class Config:
        from_attributes = True


class BrandIn(BaseModel):
    code: str
    name_ar: str
    name_en: Optional[str] = None


class BrandUpdate(BaseModel):
    name_ar: Optional[str] = None
    name_en: Optional[str] = None
    is_active: Optional[bool] = None


class BrandOut(BaseModel):
    code: str
    name_ar: str
    name_en: Optional[str] = None
    is_active: bool = True

    class Config:
        from_attributes = True


class StockMoveOut(BaseModel):
    id: int
    move_date: date

    item_id: int

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
    account_code: Optional[str] = None
    payment_terms_days: int = 0


class SupplierUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    account_code: Optional[str] = None
    payment_terms_days: Optional[int] = None


class SupplierOut(BaseModel):
    code: str
    name: str
    phone: Optional[str]
    email: Optional[str]
    notes: Optional[str]
    account_code: Optional[str] = None
    payment_terms_days: int = 0
    payable_balance: float = 0

    class Config:
        from_attributes = True

class UnitTemplateIn(BaseModel):
    code: str
    name: str
    base_unit: str
    higher_unit: Optional[str] = None
    factor: float = 1
    min_price: Optional[float] = None
    max_price: Optional[float] = None


class UnitTemplateUpdate(BaseModel):
    name: Optional[str] = None
    base_unit: Optional[str] = None
    higher_unit: Optional[str] = None
    factor: Optional[float] = None
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    is_active: Optional[bool] = None


class UnitTemplateOut(BaseModel):
    code: str
    name: str
    base_unit: str
    higher_unit: Optional[str] = None
    factor: float = 1
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    is_active: bool = True

    class Config:
        from_attributes = True
