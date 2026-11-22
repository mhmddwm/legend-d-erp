# -*- coding: utf-8 -*-
from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------- الخدمات
class ServiceIn(BaseModel):
    code: Optional[str] = None            # يُولَّد تلقائياً (SRV-0001) إن تُرك فارغاً
    name: str
    name_en: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    service_type: str = "sales"           # sales | purchase | both
    unit: str = "خدمة"
    sales_price: float = 0
    purchase_cost: float = 0
    tax_type_code: Optional[str] = None
    revenue_account_code: Optional[str] = None
    expense_account_code: Optional[str] = None
    cost_center_code: Optional[str] = None
    is_active: bool = True


class ServiceUpdate(BaseModel):
    name: Optional[str] = None
    name_en: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    service_type: Optional[str] = None
    unit: Optional[str] = None
    sales_price: Optional[float] = None
    purchase_cost: Optional[float] = None
    tax_type_code: Optional[str] = None
    revenue_account_code: Optional[str] = None
    expense_account_code: Optional[str] = None
    cost_center_code: Optional[str] = None
    is_active: Optional[bool] = None


class ServiceOut(BaseModel):
    code: str
    name: str
    name_en: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    service_type: str
    unit: str
    sales_price: float = 0
    purchase_cost: float = 0
    tax_type_code: Optional[str] = None
    revenue_account_code: Optional[str] = None
    expense_account_code: Optional[str] = None
    cost_center_code: Optional[str] = None
    is_active: bool = True
    created_at: Optional[datetime] = None
    # مؤشرات الاستخدام (محسوبة)
    posted_invoices: int = 0      # عدد الأسطر في فواتير مرحّلة (غير ملغاة)
    total_lines: int = 0          # كل الأسطر (تمنع الحذف إن وُجدت)
    sales_total: float = 0        # صافي مبيعات الخدمة (قبل الضريبة)
    purchase_total: float = 0     # صافي مشتريات الخدمة (قبل الضريبة)

    class Config:
        from_attributes = True


class ServiceSummaryOut(BaseModel):
    total: int
    active: int
    sales_services: int
    purchase_services: int
    month_sales_net: float
    month_purchase_net: float
    month_label: str


# ---------------------------------------------------------------- فواتير الخدمات
class ServiceInvoiceLineIn(BaseModel):
    service_code: str
    qty: float = 1
    unit_price: Optional[float] = None     # إن تُرك فارغاً: سعر البيع/تكلفة الشراء من بطاقة الخدمة
    discount_percent: float = 0
    description: Optional[str] = None
    # إن أُرسل (حتى لو null) يحل محل ضريبة الخدمة الافتراضية؛ null = بلا ضريبة
    tax_type_code: Optional[str] = None


class ServiceInvoiceIn(BaseModel):
    inv_date: date
    party_code: str
    party_inv_number: Optional[str] = None
    payment_method: str = "credit"          # credit | cash | bank
    settlement_account_code: Optional[str] = None
    tax_calc_method: str = "exclusive"      # exclusive | inclusive
    cost_center_code: Optional[str] = None
    notes: Optional[str] = None
    lines: List[ServiceInvoiceLineIn] = Field(default_factory=list)


class ServiceInvoiceCancelIn(BaseModel):
    reason: Optional[str] = None


class ServiceInvoiceLineOut(BaseModel):
    line_no: int
    service_code: str
    service_name: Optional[str] = None
    description: Optional[str] = None
    qty: float
    unit_price: float
    discount_percent: float = 0
    discount_amount: float = 0
    net_amount: float
    tax_type_code: Optional[str] = None
    tax_rate: Optional[float] = None
    tax_amount: float = 0
    line_total: float
    account_code: str


class JournalLinePreview(BaseModel):
    line_no: int
    account_code: str
    account_name: Optional[str] = None
    debit: float = 0
    credit: float = 0
    description: Optional[str] = None


class ServiceInvoiceOut(BaseModel):
    inv_number: str
    direction: str
    inv_date: date
    party_code: str
    party_name: Optional[str] = None
    party_inv_number: Optional[str] = None
    payment_method: str
    settlement_account_code: Optional[str] = None
    tax_calc_method: str
    discount_total: float = 0
    subtotal: float
    tax_amount: float
    total: float
    status: str
    journal_entry_id: Optional[int] = None
    cost_center_code: Optional[str] = None
    notes: Optional[str] = None
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    cancel_reason: Optional[str] = None
    lines: List[ServiceInvoiceLineOut] = Field(default_factory=list)
    journal: Optional[List[JournalLinePreview]] = None


class ServiceInvoicePreviewOut(BaseModel):
    direction: str
    subtotal: float
    discount_total: float
    tax_amount: float
    total: float
    lines: List[ServiceInvoiceLineOut]
    journal: List[JournalLinePreview]
    total_debit: float
    total_credit: float
    balanced: bool
    warnings: List[str] = Field(default_factory=list)
