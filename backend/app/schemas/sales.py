from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import date


class CustomerIn(BaseModel):
    code: str
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    account_code: Optional[str] = None
    payment_terms_days: int = 0


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    account_code: Optional[str] = None
    payment_terms_days: Optional[int] = None
    is_active: Optional[bool] = None


class CustomerOut(BaseModel):
    code: str
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    account_code: Optional[str] = None
    payment_terms_days: int = 0
    is_active: bool = True
    receivable_balance: float = 0

    class Config:
        from_attributes = True


class SalesInvoiceLineIn(BaseModel):
    item_code: str
    qty: float = Field(gt=0)
    unit_price: float = Field(ge=0)


class SalesInvoiceIn(BaseModel):
    inv_date: date
    customer_code: str
    customer_ref_number: Optional[str] = None
    warehouse_id: Optional[int] = None
    location_id: Optional[int] = None
    payment_terms_days: Optional[int] = None
    cost_center_code: Optional[str] = None
    tax_type_code: Optional[str] = None
    tax_calc_method: Optional[str] = "exclusive"
    notes: Optional[str] = None
    lines: List[SalesInvoiceLineIn]


class SalesInvoiceUpdate(BaseModel):
    inv_date: Optional[date] = None
    customer_ref_number: Optional[str] = None
    payment_terms_days: Optional[int] = None
    cost_center_code: Optional[str] = None
    notes: Optional[str] = None


class SILineOut(BaseModel):
    item_id: int
    qty: float
    unit_price: float
    unit_cost: float

    class Config:
        from_attributes = True


class SalesInvoiceOut(BaseModel):
    inv_number: str
    inv_date: date
    customer_code: str
    customer_ref_number: Optional[str] = None
    warehouse_id: Optional[int] = None
    location_id: Optional[int] = None
    subtotal: float = 0
    tax_type_code: Optional[str] = None
    tax_amount: float = 0
    total: float
    cogs_total: float = 0
    status: str
    payment_terms_days: int = 0
    cost_center_code: Optional[str] = None
    due_date: Optional[date] = None
    journal_entry_id: Optional[int] = None
    notes: Optional[str] = None
    lines: List[SILineOut] = []

    class Config:
        from_attributes = True
