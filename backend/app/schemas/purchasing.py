from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import date, datetime


class POLineIn(BaseModel):
    item_code: str
    qty: float = Field(gt=0)
    unit_price: float = Field(ge=0)


class PurchaseOrderIn(BaseModel):
    po_date: date
    supplier_code: str
    lines: List[POLineIn]


class POLineOut(BaseModel):
    item_id: int
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
    warehouse_id: Optional[int] = None
    location_id: Optional[int] = None
    lines: List[GRNLineIn]



class GRNLineOut(BaseModel):
    item_id: int
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
    warehouse_id: Optional[int] = None
    location_id: Optional[int] = None
    total: float
    invoice_status: str
    journal_entry_id: Optional[int] = None
    lines: List[GRNLineOut] = []

    class Config:
        from_attributes = True



class PurchaseInvoiceIn(BaseModel):
    inv_date: date
    grn_number: str
    supplier_inv_number: Optional[str] = None
    payment_terms_days: Optional[int] = None
    cost_center_code: Optional[str] = None
    tax_type_code: Optional[str] = None
    # طريقة احتساب الضريبة: "exclusive" (تُضاف على القيمة) أو
    # "inclusive" (القيمة المُدخلة شاملة الضريبة أصلاً)
    tax_calc_method: Optional[str] = "exclusive"


class DirectPurchaseInvoiceIn(BaseModel):
    """فاتورة مشتريات مباشرة تُنشأ دون المرور يدوياً بدورة الشراء الكاملة
    (طلب شراء ← عرض سعر ← أمر شراء ← استلام). يقوم الخادم بإنشاء إذن
    استلام مرتبط تلقائياً في الخلفية للحفاظ على تتبع المستندات وتحديث
    المخزون والتكلفة المتوسطة بشكل صحيح، ثم يرحّل الفاتورة عليه مباشرة."""
    inv_date: date
    supplier_code: str
    supplier_inv_number: Optional[str] = None
    reference: Optional[str] = None
    payment_terms_days: Optional[int] = None
    cost_center_code: Optional[str] = None
    tax_type_code: Optional[str] = None
    tax_calc_method: Optional[str] = "exclusive"
    warehouse_id: Optional[int] = None
    location_id: Optional[int] = None
    lines: List[GRNLineIn]



class PurchaseInvoiceUpdate(BaseModel):
    """تعديل فاتورة مشتريات مرحّلة — يقتصر على الحقول غير المالية حفاظاً
    على سلامة القيود المحاسبية والتكلفة المتوسطة المرتبطة بالفاتورة."""
    inv_date: Optional[date] = None
    supplier_inv_number: Optional[str] = None
    payment_terms_days: Optional[int] = None
    cost_center_code: Optional[str] = None
    notes: Optional[str] = None


class PInvLineOut(BaseModel):
    item_id: int
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
    subtotal: float = 0
    tax_type_code: Optional[str] = None
    tax_amount: float = 0
    total: float
    status: str
    payment_terms_days: int = 0
    cost_center_code: Optional[str] = None
    due_date: Optional[date] = None
    journal_entry_id: Optional[int] = None
    notes: Optional[str] = None
    lines: List[PInvLineOut] = []

    class Config:
        from_attributes = True


class AuditLogOut(BaseModel):
    id: int
    entity_type: str
    entity_id: str
    action: str
    actor: Optional[str] = None
    details: Optional[str] = None
    created_at: datetime

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
    item_id: int
    qty: float
    unit_cost: float

    class Config:
        from_attributes = True



class PurchaseReturnOut(BaseModel):
    rt_number: str
    rt_date: date
    supplier_code: str
    inv_number: str
    subtotal: float = 0
    tax_type_code: Optional[str] = None
    tax_amount: float = 0
    total: float
    status: str = "posted"
    journal_entry_id: Optional[int] = None
    lines: List[PRTLineOut] = []

    class Config:
        from_attributes = True


class SupplierPaymentAllocationIn(BaseModel):
    inv_number: str
    amount: float = Field(gt=0)


class SupplierPaymentIn(BaseModel):
    payment_date: date
    supplier_code: str
    payment_method: str = "bank_transfer"  # cash / bank_transfer / check
    account_code: str
    reference: Optional[str] = None
    notes: Optional[str] = None
    allocations: List[SupplierPaymentAllocationIn]


class SupplierPaymentAllocationOut(BaseModel):
    inv_number: str
    amount: float

    class Config:
        from_attributes = True


class SupplierPaymentOut(BaseModel):
    payment_number: str
    payment_date: date
    supplier_code: str
    payment_method: str
    account_code: str
    reference: Optional[str] = None
    notes: Optional[str] = None
    amount: float
    status: str = "posted"
    journal_entry_id: Optional[int] = None
    allocations: List[SupplierPaymentAllocationOut] = []

    class Config:
        from_attributes = True


class SupplierOpenInvoiceOut(BaseModel):
    inv_number: str
    inv_date: date
    due_date: Optional[date] = None
    total: float
    returned: float
    paid: float
    outstanding: float
