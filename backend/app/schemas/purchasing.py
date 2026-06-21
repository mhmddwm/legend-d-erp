from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import date


class POLineIn(BaseModel):
    item_code: str
    qty: float = Field(gt=0)
    unit_price: float = Field(ge=0)


class PurchaseOrderIn(BaseModel):
    po_date: date
    supplier_code: str
    lines: List[POLineIn]


class POLineOut(BaseModel):
    item_code: str
    qty: float
    unit_price: float

    class Config:
        from_attributes = True


class PurchaseOrderOut(BaseModel):
    po_number: str
    po_date: date
    supplier_code: str
    status: str
    total: float
    lines: List[POLineOut] = []

    class Config:
        from_attributes = True


class GRNLineIn(BaseModel):
    item_code: str
    qty: float = Field(gt=0)
    unit_cost: float = Field(ge=0)


class GoodsReceiptIn(BaseModel):
    grn_date: date
    supplier_code: str
    po_number: Optional[str] = None
    reference: Optional[str] = None
    lines: List[GRNLineIn]


class GRNLineOut(BaseModel):
    item_code: str
    qty: float
    unit_cost: float

    class Config:
        from_attributes = True


class GoodsReceiptOut(BaseModel):
    grn_number: str
    grn_date: date
    supplier_code: str
    po_number: Optional[str]
    reference: Optional[str]
    total: float
    invoice_status: str
    lines: List[GRNLineOut] = []

    class Config:
        from_attributes = True


class PurchaseInvoiceIn(BaseModel):
    inv_date: date
    grn_number: str
    supplier_inv_number: Optional[str] = None


class PInvLineOut(BaseModel):
    item_code: str
    qty: float
    unit_cost: float

    class Config:
        from_attributes = True


class PurchaseInvoiceOut(BaseModel):
    inv_number: str
    inv_date: date
    supplier_code: str
    grn_number: str
    supplier_inv_number: Optional[str]
    total: float
    status: str
    lines: List[PInvLineOut] = []

    class Config:
        from_attributes = True


class ReturnLineIn(BaseModel):
    item_code: str
    qty: float = Field(gt=0)


class PurchaseReturnIn(BaseModel):
    rt_date: date
    inv_number: str
    lines: List[ReturnLineIn]


class PRTLineOut(BaseModel):
    item_code: str
    qty: float
    unit_cost: float

    class Config:
        from_attributes = True


class PurchaseReturnOut(BaseModel):
    rt_number: str
    rt_date: date
    supplier_code: str
    inv_number: str
    total: float
    lines: List[PRTLineOut] = []

    class Config:
        from_attributes = True
