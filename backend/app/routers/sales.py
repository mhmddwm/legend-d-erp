from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import (
    Account,
    Customer,
    Item,
    JournalEntry,
    JournalEntryLine,
    SalesInvoice,
    SalesInvoiceLine,
    StockMove,
    TaxType,
)
from app.models.warehouse_stock import WarehouseStock
from app.schemas.sales import (
    CustomerIn,
    CustomerUpdate,
    CustomerOut,
    SalesInvoiceIn,
    SalesInvoiceOut,
    SalesInvoiceUpdate,
)

customer_router = APIRouter(prefix="/api/customers", tags=["Customers"])
si_router = APIRouter(prefix="/api/sales-invoices", tags=["SalesInvoices"])


# =========================================================
# HELPERS
# =========================================================
def _to_float(value) -> float:
    return float(value or 0)


def _next_document_number(db: Session, model, column_name: str, prefix: str, pad: int = 6) -> str:
    column = getattr(model, column_name)
    last_row = (
        db.query(column)
        .filter(column.like(f"{prefix}-%"))
        .order_by(column.desc())
        .first()
    )
    next_seq = 1
    if last_row and last_row[0]:
        tail = last_row[0].split("-")[-1]
        if tail.isdigit():
            next_seq = int(tail) + 1
    return f"{prefix}-{str(next_seq).zfill(pad)}"


def calc_receivable(db: Session, customer_code: str) -> float:
    """الرصيد المستحق على العميل = فواتير مبيعات مرحّلة (لاحقاً: ناقص
    مرتجعات ومدفوعات عملاء عند بنائها في مرحلة تالية)."""
    invoiced = (
        db.query(func.coalesce(func.sum(SalesInvoice.total), 0))
        .filter(SalesInvoice.customer_code == customer_code, SalesInvoice.status != "cancelled")
        .scalar()
    )
    return float(invoiced or 0)


# =========================================================
# CUSTOMERS
# =========================================================
@customer_router.get("", response_model=list[CustomerOut])
def list_customers(db: Session = Depends(get_db)):
    customers = db.query(Customer).order_by(Customer.code.asc()).all()
    return [
        CustomerOut(
            code=c.code, name=c.name, phone=c.phone, email=c.email, notes=c.notes,
            account_code=c.account_code, payment_terms_days=c.payment_terms_days,
            is_active=c.is_active, receivable_balance=calc_receivable(db, c.code),
        )
        for c in customers
    ]


@customer_router.post("", response_model=CustomerOut, status_code=201)
def create_customer(payload: CustomerIn, db: Session = Depends(get_db)):
    if db.query(Customer).filter(Customer.code == payload.code).first():
        raise HTTPException(400, "كود العميل مستخدم من قبل")
    customer = Customer(**payload.model_dump())
    if not customer.account_code:
        customer.account_code = "1121"
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return CustomerOut(
        code=customer.code, name=customer.name, phone=customer.phone, email=customer.email,
        notes=customer.notes, account_code=customer.account_code,
        payment_terms_days=customer.payment_terms_days, is_active=customer.is_active,
        receivable_balance=0,
    )


@customer_router.put("/{code}", response_model=CustomerOut)
def update_customer(code: str, payload: CustomerUpdate, db: Session = Depends(get_db)):
    customer = db.query(Customer).filter(Customer.code == code).first()
    if not customer:
        raise HTTPException(404, "العميل غير موجود")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(customer, k, v)
    db.commit()
    db.refresh(customer)
    return CustomerOut(
        code=customer.code, name=customer.name, phone=customer.phone, email=customer.email,
        notes=customer.notes, account_code=customer.account_code,
        payment_terms_days=customer.payment_terms_days, is_active=customer.is_active,
        receivable_balance=calc_receivable(db, customer.code),
    )


@customer_router.delete("/{code}", status_code=204)
def delete_customer(code: str, db: Session = Depends(get_db)):
    customer = db.query(Customer).filter(Customer.code == code).first()
    if not customer:
        raise HTTPException(404, "العميل غير موجود")
    if db.query(SalesInvoice).filter(SalesInvoice.customer_code == code).first():
        raise HTTPException(400, "لا يمكن حذف عميل عليه فواتير — يمكن إلغاء تنشيطه بدلاً من ذلك")
    db.delete(customer)
    db.commit()
    return None


# =========================================================
# ضريبة فاتورة المبيعات + الترحيل المحاسبي المزدوج (إيراد + تكلفة بضاعة مباعة)
# =========================================================
def _resolve_invoice_tax(db: Session, lines_total: float, tax_type_code, tax_calc_method):
    if not tax_type_code:
        total = round(lines_total, 2)
        return total, 0.0, total, None

    tax_type = (
        db.query(TaxType)
        .filter(TaxType.code == tax_type_code, TaxType.is_active.is_(True))
        .first()
    )
    if not tax_type:
        raise HTTPException(404, f"نوع الضريبة {tax_type_code} غير موجود أو غير مفعّل")

    rate = _to_float(tax_type.rate)
    if tax_calc_method == "inclusive":
        subtotal = (lines_total / (1 + rate / 100)) if rate else lines_total
        tax_amount = lines_total - subtotal
    else:
        subtotal = lines_total
        tax_amount = lines_total * rate / 100

    subtotal = round(subtotal, 2)
    tax_amount = round(tax_amount, 2)
    total = round(subtotal + tax_amount, 2)
    return subtotal, tax_amount, total, tax_type


def _post_sales_invoice_journal(db: Session, invoice: SalesInvoice, subtotal, tax_amount, total, tax_type, cogs_total):
    """يرحّل قيدين مزدوجين لفاتورة المبيعات:
    1) مدين حساب العميل (إجمالي شامل الضريبة) / دائن إيرادات المبيعات
       (41) [+ دائن ضريبة المبيعات المستحقة إن كان نوع الضريبة مرتبطاً بحساب]
    2) مدين تكلفة البضاعة المباعة (51) / دائن المخزون (123) — بالتكلفة
       المتوسطة الحالية للأصناف المباعة، دون تعديل التكلفة المتوسطة نفسها."""
    revenue_account = db.query(Account).filter(Account.code == "41").first()
    if not revenue_account:
        raise HTTPException(400, "حساب إيرادات المبيعات (41) غير موجود بدليل الحسابات.")
    cogs_account = db.query(Account).filter(Account.code == "51").first()
    if not cogs_account:
        raise HTTPException(400, "حساب تكلفة البضاعة المباعة (51) غير موجود بدليل الحسابات.")
    inventory_account = db.query(Account).filter(Account.code == "123").first()
    if not inventory_account:
        raise HTTPException(400, "حساب المخزون (123) غير موجود بدليل الحسابات.")

    customer = db.query(Customer).filter(Customer.code == invoice.customer_code).first()
    receivable_account_code = (customer.account_code if customer and customer.account_code else None) or "1121"
    receivable_account = db.query(Account).filter(Account.code == receivable_account_code).first()
    if not receivable_account:
        raise HTTPException(400, f"الحساب المحاسبي المرتبط بالعميل ({receivable_account_code}) غير موجود بدليل الحسابات.")

    tax_account = None
    if tax_type and tax_type.account_code:
        tax_account = db.query(Account).filter(Account.code == tax_type.account_code).first()

    entry = JournalEntry(
        entry_date=invoice.inv_date,
        description=f"فاتورة مبيعات {invoice.inv_number} — العميل {invoice.customer_code}",
        source_type="sales_invoice",
        source_ref=invoice.inv_number,
        status="posted",
        cost_center_code=invoice.cost_center_code,
        total_amount=total,
    )
    db.add(entry)
    db.flush()

    line_no = 1
    db.add(JournalEntryLine(
        entry_id=entry.id, line_no=line_no, account_code=receivable_account.code,
        debit=total, credit=0,
        line_description=f"مستحق على العميل {invoice.customer_code} — فاتورة {invoice.inv_number}",
    ))
    line_no += 1

    if tax_amount and tax_account:
        db.add(JournalEntryLine(
            entry_id=entry.id, line_no=line_no, account_code=revenue_account.code,
            debit=0, credit=subtotal,
            line_description=f"إيرادات مبيعات — فاتورة {invoice.inv_number}",
        ))
        line_no += 1
        db.add(JournalEntryLine(
            entry_id=entry.id, line_no=line_no, account_code=tax_account.code,
            debit=0, credit=tax_amount,
            line_description=f"ضريبة مبيعات مستحقة — فاتورة {invoice.inv_number}",
            tax_type_code=tax_type.code, tax_rate=tax_type.rate, tax_amount=tax_amount,
        ))
        line_no += 1
    else:
        line_kwargs = dict(
            entry_id=entry.id, line_no=line_no, account_code=revenue_account.code,
            debit=0, credit=round(subtotal + (tax_amount or 0), 2),
            line_description=f"إيرادات مبيعات — فاتورة {invoice.inv_number}",
        )
        if tax_type and tax_amount:
            line_kwargs.update(tax_type_code=tax_type.code, tax_rate=tax_type.rate, tax_amount=tax_amount)
        db.add(JournalEntryLine(**line_kwargs))
        line_no += 1

    if cogs_total:
        db.add(JournalEntryLine(
            entry_id=entry.id, line_no=line_no, account_code=cogs_account.code,
            debit=cogs_total, credit=0,
            line_description=f"تكلفة بضاعة مباعة — فاتورة {invoice.inv_number}",
        ))
        line_no += 1
        db.add(JournalEntryLine(
            entry_id=entry.id, line_no=line_no, account_code=inventory_account.code,
            debit=0, credit=cogs_total,
            line_description=f"مخزون (خروج بضاعة مباعة) — فاتورة {invoice.inv_number}",
        ))
        line_no += 1

    invoice.journal_entry_id = entry.id
    return entry


# =========================================================
# SALES INVOICE
# =========================================================
@si_router.get("", response_model=list[SalesInvoiceOut])
def list_sales_invoices(db: Session = Depends(get_db)):
    return (
        db.query(SalesInvoice)
        .order_by(SalesInvoice.inv_date.desc(), SalesInvoice.inv_number.desc())
        .all()
    )


@si_router.post("", response_model=SalesInvoiceOut, status_code=201)
def create_sales_invoice(
    payload: SalesInvoiceIn,
    db: Session = Depends(get_db),
    actor: Optional[str] = Query(None),
):
    if not payload.lines:
        raise HTTPException(400, "يجب إضافة صنف واحد على الأقل للفاتورة")

    customer = db.query(Customer).filter(Customer.code == payload.customer_code, Customer.is_active.is_(True)).first()
    if not customer:
        raise HTTPException(404, "العميل غير موجود أو غير نشط")

    prepared_lines = []
    for line in payload.lines:
        item = db.query(Item).filter(Item.code == line.item_code, Item.is_active.is_(True)).first()
        if not item:
            raise HTTPException(404, f"الصنف {line.item_code} غير موجود أو غير نشط")
        if _to_float(item.qty) < line.qty:
            raise HTTPException(400, f"الكمية المتاحة من الصنف {item.code} ({item.qty}) أقل من الكمية المطلوبة ({line.qty})")
        prepared_lines.append((item, line.qty, line.unit_price))

    payment_terms_days = payload.payment_terms_days if payload.payment_terms_days is not None else (customer.payment_terms_days or 0)

    try:
        invoice = SalesInvoice(
            inv_number=_next_document_number(db, SalesInvoice, "inv_number", "SINV"),
            inv_date=payload.inv_date,
            customer_code=customer.code,
            customer_ref_number=payload.customer_ref_number,
            warehouse_id=payload.warehouse_id,
            location_id=payload.location_id,
            payment_terms_days=payment_terms_days,
            cost_center_code=payload.cost_center_code,
            notes=payload.notes,
            status="posted",
            subtotal=0, tax_amount=0, total=0, cogs_total=0,
        )
        db.add(invoice)
        db.flush()

        lines_total = 0.0
        cogs_total = 0.0
        for item, qty, unit_price in prepared_lines:
            unit_cost = _to_float(item.avg_cost)
            db.add(SalesInvoiceLine(
                inv_number=invoice.inv_number, item_id=item.id,
                qty=qty, unit_price=unit_price, unit_cost=unit_cost,
            ))
            lines_total += qty * unit_price
            cogs_total += qty * unit_cost

            new_qty = _to_float(item.qty) - qty
            item.qty = new_qty

            db.add(StockMove(
                move_date=payload.inv_date, item_id=item.id, move_type="بيع",
                reference=f"SINV-{invoice.inv_number}", warehouse_id=payload.warehouse_id,
                qty=-qty, unit_cost=unit_cost, balance_after=new_qty,
            ))

            wh_id = payload.warehouse_id or item.default_warehouse_id
            if wh_id:
                row = (
                    db.query(WarehouseStock)
                    .filter(
                        WarehouseStock.item_id == item.id, WarehouseStock.warehouse_id == wh_id,
                        WarehouseStock.location_id == (payload.location_id or item.default_location_id),
                    )
                    .first()
                )
                if row:
                    row.quantity = max(_to_float(row.quantity) - qty, 0)

        subtotal, tax_amount, total, tax_type = _resolve_invoice_tax(
            db, lines_total, payload.tax_type_code, payload.tax_calc_method
        )
        invoice.subtotal = subtotal
        invoice.tax_amount = tax_amount
        invoice.tax_type_code = tax_type.code if tax_type else None
        invoice.total = total
        invoice.cogs_total = round(cogs_total, 2)

        _post_sales_invoice_journal(db, invoice, subtotal, tax_amount, total, tax_type, invoice.cogs_total)

        db.commit()
        db.refresh(invoice)
        return invoice

    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@si_router.post("/{inv_number}/cancel", response_model=SalesInvoiceOut)
def cancel_sales_invoice(inv_number: str, db: Session = Depends(get_db)):
    """إلغاء فاتورة مبيعات: يعيد الكمية المباعة للمخزون (إضافة آمنة
    لا تخاطر برصيد سالب أبداً)، ويُلغي قيدها المزدوج."""
    invoice = db.query(SalesInvoice).filter(SalesInvoice.inv_number == inv_number).first()
    if not invoice:
        raise HTTPException(404, "فاتورة المبيعات غير موجودة")
    if invoice.status == "cancelled":
        raise HTTPException(400, "الفاتورة ملغاة بالفعل")

    for line in invoice.lines:
        item = db.query(Item).filter(Item.id == line.item_id).first()
        if item:
            item.qty = _to_float(item.qty) + _to_float(line.qty)
            wh_id = invoice.warehouse_id or item.default_warehouse_id
            if wh_id:
                row = (
                    db.query(WarehouseStock)
                    .filter(
                        WarehouseStock.item_id == item.id, WarehouseStock.warehouse_id == wh_id,
                        WarehouseStock.location_id == (invoice.location_id or item.default_location_id),
                    )
                    .first()
                )
                if row:
                    row.quantity = _to_float(row.quantity) + _to_float(line.qty)

    if invoice.journal_entry_id:
        entry = db.query(JournalEntry).filter(JournalEntry.id == invoice.journal_entry_id).first()
        if entry and entry.status == "posted":
            entry.status = "cancelled"

    invoice.status = "cancelled"
    db.commit()
    db.refresh(invoice)
    return invoice
