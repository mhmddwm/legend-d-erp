# -*- coding: utf-8 -*-
"""وحدة الخدمات: بطاقة الخدمة + فواتير الخدمات (مبيعات/مشتريات) وأسطرها."""
from sqlalchemy import (
    Boolean, CheckConstraint, Column, Date, DateTime, ForeignKey, Integer, Numeric, String, Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class Service(Base):
    __tablename__ = "services"

    code = Column(String(30), primary_key=True)
    name = Column(String(200), nullable=False)
    name_en = Column(String(200))
    description = Column(Text)
    category = Column(String(100))
    service_type = Column(String(10), nullable=False, default="sales")   # sales | purchase | both
    unit = Column(String(30), nullable=False, default="خدمة")
    sales_price = Column(Numeric(18, 4), nullable=False, default=0)
    purchase_cost = Column(Numeric(18, 4), nullable=False, default=0)
    tax_type_code = Column(String(20), ForeignKey("tax_types.code"), nullable=True)
    revenue_account_code = Column(String(20), ForeignKey("accounts.code"), nullable=True)
    expense_account_code = Column(String(20), ForeignKey("accounts.code"), nullable=True)
    cost_center_code = Column(String(20), ForeignKey("cost_centers.code"), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("service_type IN ('sales','purchase','both')", name="ck_service_type"),
        CheckConstraint("sales_price >= 0 AND purchase_cost >= 0", name="ck_service_amounts"),
    )


class ServiceInvoice(Base):
    __tablename__ = "service_invoices"

    inv_number = Column(String(30), primary_key=True)
    direction = Column(String(10), nullable=False)                 # sales | purchase
    inv_date = Column(Date, nullable=False)
    party_code = Column(String(30), nullable=False)                # عميل (بيع) أو مورد (شراء)
    party_inv_number = Column(String(60))
    payment_method = Column(String(10), nullable=False, default="credit")   # credit | cash | bank
    settlement_account_code = Column(String(20), ForeignKey("accounts.code"), nullable=True)
    tax_calc_method = Column(String(10), nullable=False, default="exclusive")
    discount_total = Column(Numeric(18, 2), nullable=False, default=0)
    subtotal = Column(Numeric(18, 2), nullable=False, default=0)
    tax_amount = Column(Numeric(18, 2), nullable=False, default=0)
    total = Column(Numeric(18, 2), nullable=False, default=0)
    status = Column(String(10), nullable=False, default="posted")  # posted | cancelled
    journal_entry_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    cost_center_code = Column(String(20), ForeignKey("cost_centers.code"), nullable=True)
    notes = Column(Text)
    created_by = Column(String(100))
    cancelled_at = Column(DateTime(timezone=True))
    cancel_reason = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    lines = relationship(
        "ServiceInvoiceLine", backref="invoice", cascade="all, delete-orphan",
        order_by="ServiceInvoiceLine.line_no",
    )

    __table_args__ = (
        CheckConstraint("direction IN ('sales','purchase')", name="ck_svc_inv_direction"),
        CheckConstraint("status IN ('posted','cancelled')", name="ck_svc_inv_status"),
        CheckConstraint("payment_method IN ('credit','cash','bank')", name="ck_svc_inv_payment"),
        CheckConstraint("tax_calc_method IN ('exclusive','inclusive')", name="ck_svc_inv_taxcalc"),
        CheckConstraint("total >= 0 AND subtotal >= 0 AND tax_amount >= 0", name="ck_svc_inv_total"),
    )


class ServiceInvoiceLine(Base):
    __tablename__ = "service_invoice_lines"

    id = Column(Integer, primary_key=True)
    inv_number = Column(String(30), ForeignKey("service_invoices.inv_number", ondelete="CASCADE"), nullable=False)
    line_no = Column(Integer, nullable=False)
    service_code = Column(String(30), ForeignKey("services.code"), nullable=False)
    description = Column(String(300))
    qty = Column(Numeric(18, 4), nullable=False)
    unit_price = Column(Numeric(18, 4), nullable=False)
    discount_percent = Column(Numeric(5, 2), nullable=False, default=0)
    discount_amount = Column(Numeric(18, 2), nullable=False, default=0)
    net_amount = Column(Numeric(18, 2), nullable=False)
    tax_type_code = Column(String(20), ForeignKey("tax_types.code"), nullable=True)
    tax_rate = Column(Numeric(5, 2), nullable=True)
    tax_amount = Column(Numeric(18, 2), nullable=False, default=0)
    line_total = Column(Numeric(18, 2), nullable=False)
    account_code = Column(String(20), ForeignKey("accounts.code"), nullable=False)   # حساب الإيراد/المصروف المجمَّد

    __table_args__ = (
        CheckConstraint(
            "qty > 0 AND unit_price >= 0 AND discount_percent >= 0 AND discount_percent <= 100",
            name="ck_svc_line_qty",
        ),
    )
