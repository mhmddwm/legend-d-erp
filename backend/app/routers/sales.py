from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import (
    Account,
    Customer,
    DeliveryNote,
    DeliveryNoteLine,
    Item,
    JournalEntry,
    JournalEntryLine,
    SalesInvoice,
    SalesInvoiceLine,
    SalesOrder,
    SalesOrderLine,
    SalesQuote,
    SalesQuoteLine,
    SalesReturn,
    SalesReturnLine,
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
    SalesOrderIn,
    SalesOrderOut,
    DeliveryNoteIn,
    DeliveryNoteOut,
    SalesQuoteIn,
    SalesQuoteOut,
    SalesQuoteStatusUpdate,
    SalesReturnIn,
    SalesReturnOut,
)

customer_router = APIRouter(prefix="/api/customers", tags=["Customers"])
si_router = APIRouter(prefix="/api/sales-invoices", tags=["SalesInvoices"])
so_router = APIRouter(prefix="/api/sales-orders", tags=["SalesOrders"])
dn_router = APIRouter(prefix="/api/delivery-notes", tags=["DeliveryNotes"])
sq_router = APIRouter(prefix="/api/sales-quotes", tags=["SalesQuotes"])
sr_router = APIRouter(prefix="/api/sales-returns", tags=["SalesReturns"])


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
    """الرصيد المستحق على العميل = فواتير مبيعات مرحّلة ناقص مرتجعات
    (لاحقاً: ناقص مدفوعات عملاء عند بنائها في مرحلة تالية)."""
    invoiced = (
        db.query(func.coalesce(func.sum(SalesInvoice.total), 0))
        .filter(SalesInvoice.customer_code == customer_code, SalesInvoice.status != "cancelled")
        .scalar()
    )
    returned = (
        db.query(func.coalesce(func.sum(SalesReturn.total), 0))
        .filter(SalesReturn.customer_code == customer_code, SalesReturn.status != "cancelled")
        .scalar()
    )
    return float(invoiced or 0) - float(returned or 0)


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


def _post_sales_invoice_journal(db: Session, invoice: SalesInvoice, subtotal, tax_amount, total, tax_type, cogs_total, include_cogs_journal: bool = True):
    """يرحّل قيد فاتورة المبيعات:
    1) مدين حساب العميل (إجمالي شامل الضريبة) / دائن إيرادات المبيعات
       (41) [+ دائن ضريبة المبيعات المستحقة إن كان نوع الضريبة مرتبطاً بحساب]
       — يُرحَّل دائماً.
    2) مدين تكلفة البضاعة المباعة (51) / دائن المخزون (123) — يُرحَّل
       فقط عند include_cogs_journal=True (الفاتورة المباشرة بلا إذن
       تسليم سابق). عند وجود إذن تسليم مرتبط، هذا القيد يكون قد رُحِّل
       بالفعل وقت التسليم، فلا يُكرَّر هنا."""
    revenue_account = db.query(Account).filter(Account.code == "41").first()
    if not revenue_account:
        raise HTTPException(400, "حساب إيرادات المبيعات (41) غير موجود بدليل الحسابات.")
    inventory_account = cogs_account = None
    if include_cogs_journal:
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

    if include_cogs_journal and cogs_total:
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
# SALES QUOTE (عرض سعر بيع) — بلا أثر محاسبي أو مخزني، قابل للتحويل لأمر بيع
# =========================================================
_SQ_VALID_STATUSES = {"draft", "sent", "accepted", "rejected", "expired"}


@sq_router.get("", response_model=list[SalesQuoteOut])
def list_sales_quotes(db: Session = Depends(get_db)):
    return db.query(SalesQuote).order_by(SalesQuote.quote_date.desc(), SalesQuote.quote_number.desc()).all()


@sq_router.post("", response_model=SalesQuoteOut, status_code=201)
def create_sales_quote(payload: SalesQuoteIn, db: Session = Depends(get_db)):
    if not payload.lines:
        raise HTTPException(400, "يجب إضافة صنف واحد على الأقل لعرض السعر")
    customer = db.query(Customer).filter(Customer.code == payload.customer_code, Customer.is_active.is_(True)).first()
    if not customer:
        raise HTTPException(404, "العميل غير موجود أو غير نشط")

    prepared = []
    for line in payload.lines:
        item = db.query(Item).filter(Item.code == line.item_code, Item.is_active.is_(True)).first()
        if not item:
            raise HTTPException(404, f"الصنف {line.item_code} غير موجود أو غير نشط")
        prepared.append((item, line.qty, line.unit_price))

    quote = SalesQuote(
        quote_number=_next_document_number(db, SalesQuote, "quote_number", "SQ"),
        quote_date=payload.quote_date, customer_code=customer.code,
        valid_until=payload.valid_until, notes=payload.notes, status="draft", total=0,
    )
    db.add(quote)
    db.flush()

    total = 0.0
    for item, qty, unit_price in prepared:
        db.add(SalesQuoteLine(quote_number=quote.quote_number, item_id=item.id, qty=qty, unit_price=unit_price))
        total += qty * unit_price
    quote.total = round(total, 2)

    db.commit()
    db.refresh(quote)
    return quote


@sq_router.put("/{quote_number}/status", response_model=SalesQuoteOut)
def update_sales_quote_status(quote_number: str, payload: SalesQuoteStatusUpdate, db: Session = Depends(get_db)):
    quote = db.query(SalesQuote).filter(SalesQuote.quote_number == quote_number).first()
    if not quote:
        raise HTTPException(404, "عرض السعر غير موجود")
    if quote.status == "converted":
        raise HTTPException(400, "لا يمكن تعديل حالة عرض سعر تم تحويله بالفعل لأمر بيع")
    if payload.status not in _SQ_VALID_STATUSES:
        raise HTTPException(400, f"حالة غير صحيحة — القيم المسموحة: {', '.join(sorted(_SQ_VALID_STATUSES))}")
    quote.status = payload.status
    db.commit()
    db.refresh(quote)
    return quote


@sq_router.post("/{quote_number}/convert", response_model=SalesOrderOut)
def convert_sales_quote_to_order(quote_number: str, db: Session = Depends(get_db)):
    """يحوّل عرض سعر مقبول إلى أمر بيع حقيقي بضغطة واحدة، بنفس العميل
    والأصناف والكميات والأسعار — دون إعادة إدخالها يدوياً."""
    quote = db.query(SalesQuote).filter(SalesQuote.quote_number == quote_number).first()
    if not quote:
        raise HTTPException(404, "عرض السعر غير موجود")
    if quote.status == "converted":
        raise HTTPException(400, "تم تحويل عرض السعر هذا لأمر بيع بالفعل")
    if quote.status == "rejected":
        raise HTTPException(400, "لا يمكن تحويل عرض سعر مرفوض — يجب تحديث حالته أولاً إن كان القرار قد تغيّر")
    if not quote.lines:
        raise HTTPException(400, "عرض السعر لا يحتوي على أصناف")

    order = SalesOrder(
        so_number=_next_document_number(db, SalesOrder, "so_number", "SO"),
        so_date=date.today(), customer_code=quote.customer_code, status="open", total=quote.total,
    )
    db.add(order)
    db.flush()

    for line in quote.lines:
        db.add(SalesOrderLine(so_number=order.so_number, item_id=line.item_id, qty=line.qty, unit_price=line.unit_price))

    quote.status = "converted"
    quote.so_number = order.so_number

    db.commit()
    db.refresh(order)
    return order


# =========================================================
# SALES ORDER (أمر بيع — بلا أثر محاسبي أو مخزني، مجرد التزام)
# =========================================================
@so_router.get("", response_model=list[SalesOrderOut])
def list_sales_orders(db: Session = Depends(get_db)):
    return db.query(SalesOrder).order_by(SalesOrder.so_date.desc(), SalesOrder.so_number.desc()).all()


@so_router.post("", response_model=SalesOrderOut, status_code=201)
def create_sales_order(payload: SalesOrderIn, db: Session = Depends(get_db)):
    if not payload.lines:
        raise HTTPException(400, "يجب إضافة صنف واحد على الأقل لأمر البيع")
    customer = db.query(Customer).filter(Customer.code == payload.customer_code, Customer.is_active.is_(True)).first()
    if not customer:
        raise HTTPException(404, "العميل غير موجود أو غير نشط")

    prepared = []
    for line in payload.lines:
        item = db.query(Item).filter(Item.code == line.item_code, Item.is_active.is_(True)).first()
        if not item:
            raise HTTPException(404, f"الصنف {line.item_code} غير موجود أو غير نشط")
        prepared.append((item, line.qty, line.unit_price))

    order = SalesOrder(
        so_number=_next_document_number(db, SalesOrder, "so_number", "SO"),
        so_date=payload.so_date, customer_code=customer.code, status="open", total=0,
    )
    db.add(order)
    db.flush()

    total = 0.0
    for item, qty, unit_price in prepared:
        db.add(SalesOrderLine(so_number=order.so_number, item_id=item.id, qty=qty, unit_price=unit_price))
        total += qty * unit_price
    order.total = round(total, 2)

    db.commit()
    db.refresh(order)
    return order


# =========================================================
# DELIVERY NOTE (إذن تسليم/صرف بضاعة) — يُخفِّض المخزون ويُرحِّل قيد
# تكلفة البضاعة المباعة فوراً وقت خروج البضاعة الفعلي
# =========================================================
def _post_delivery_note_journal(db: Session, delivery: DeliveryNote, cogs_total: float):
    cogs_account = db.query(Account).filter(Account.code == "51").first()
    if not cogs_account:
        raise HTTPException(400, "حساب تكلفة البضاعة المباعة (51) غير موجود بدليل الحسابات.")
    inventory_account = db.query(Account).filter(Account.code == "123").first()
    if not inventory_account:
        raise HTTPException(400, "حساب المخزون (123) غير موجود بدليل الحسابات.")
    if not cogs_total:
        return None

    entry = JournalEntry(
        entry_date=delivery.dn_date,
        description=f"تسليم بضاعة {delivery.dn_number} — العميل {delivery.customer_code}",
        source_type="delivery_note",
        source_ref=delivery.dn_number,
        status="posted",
        total_amount=cogs_total,
    )
    db.add(entry)
    db.flush()

    db.add(JournalEntryLine(
        entry_id=entry.id, line_no=1, account_code=cogs_account.code,
        debit=cogs_total, credit=0,
        line_description=f"تكلفة بضاعة مباعة — تسليم {delivery.dn_number}",
    ))
    db.add(JournalEntryLine(
        entry_id=entry.id, line_no=2, account_code=inventory_account.code,
        debit=0, credit=cogs_total,
        line_description=f"مخزون (خروج بضاعة) — تسليم {delivery.dn_number}",
    ))
    delivery.journal_entry_id = entry.id
    return entry


@dn_router.get("", response_model=list[DeliveryNoteOut])
def list_delivery_notes(db: Session = Depends(get_db)):
    return db.query(DeliveryNote).order_by(DeliveryNote.dn_date.desc(), DeliveryNote.dn_number.desc()).all()


@dn_router.post("", response_model=DeliveryNoteOut, status_code=201)
def create_delivery_note(payload: DeliveryNoteIn, db: Session = Depends(get_db)):
    if not payload.lines:
        raise HTTPException(400, "يجب إضافة صنف واحد على الأقل لإذن التسليم")
    customer = db.query(Customer).filter(Customer.code == payload.customer_code, Customer.is_active.is_(True)).first()
    if not customer:
        raise HTTPException(404, "العميل غير موجود أو غير نشط")
    if payload.so_number and not db.query(SalesOrder).filter(SalesOrder.so_number == payload.so_number).first():
        raise HTTPException(404, "أمر البيع غير موجود")

    prepared = []
    for line in payload.lines:
        item = db.query(Item).filter(Item.code == line.item_code, Item.is_active.is_(True)).first()
        if not item:
            raise HTTPException(404, f"الصنف {line.item_code} غير موجود أو غير نشط")
        if _to_float(item.qty) < line.qty:
            raise HTTPException(400, f"الكمية المتاحة من الصنف {item.code} ({item.qty}) أقل من الكمية المطلوبة ({line.qty})")
        prepared.append((item, line.qty, line.unit_price))

    try:
        delivery = DeliveryNote(
            dn_number=_next_document_number(db, DeliveryNote, "dn_number", "DN"),
            dn_date=payload.dn_date, customer_code=customer.code, so_number=payload.so_number,
            warehouse_id=payload.warehouse_id, location_id=payload.location_id,
            invoice_status="not_invoiced", cogs_total=0,
        )
        db.add(delivery)
        db.flush()

        cogs_total = 0.0
        for item, qty, unit_price in prepared:
            unit_cost = _to_float(item.avg_cost)
            db.add(DeliveryNoteLine(
                dn_number=delivery.dn_number, item_id=item.id, qty=qty,
                unit_cost=unit_cost, unit_price=unit_price,
            ))
            cogs_total += qty * unit_cost

            new_qty = _to_float(item.qty) - qty
            item.qty = new_qty
            db.add(StockMove(
                move_date=payload.dn_date, item_id=item.id, move_type="تسليم بضاعة",
                reference=f"DN-{delivery.dn_number}", warehouse_id=payload.warehouse_id,
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

        delivery.cogs_total = round(cogs_total, 2)
        _post_delivery_note_journal(db, delivery, delivery.cogs_total)

        db.commit()
        db.refresh(delivery)
        return delivery

    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


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
    customer = db.query(Customer).filter(Customer.code == payload.customer_code, Customer.is_active.is_(True)).first()
    if not customer:
        raise HTTPException(404, "العميل غير موجود أو غير نشط")

    payment_terms_days = payload.payment_terms_days if payload.payment_terms_days is not None else (customer.payment_terms_days or 0)

    # ===== الحالة 1: فاتورة مرتبطة بإذن تسليم سابق (الدورة الكاملة) =====
    if payload.delivery_number:
        delivery = db.query(DeliveryNote).filter(DeliveryNote.dn_number == payload.delivery_number).first()
        if not delivery:
            raise HTTPException(404, "إذن التسليم غير موجود")
        if delivery.customer_code != customer.code:
            raise HTTPException(400, "إذن التسليم لا يخص هذا العميل")
        if delivery.invoice_status == "invoiced":
            raise HTTPException(400, "تم ترحيل فاتورة على إذن التسليم هذا بالفعل")
        if not delivery.lines:
            raise HTTPException(400, "إذن التسليم لا يحتوي على أصناف")

        try:
            invoice = SalesInvoice(
                inv_number=_next_document_number(db, SalesInvoice, "inv_number", "SINV"),
                inv_date=payload.inv_date, customer_code=customer.code,
                customer_ref_number=payload.customer_ref_number,
                delivery_number=delivery.dn_number, so_number=delivery.so_number,
                warehouse_id=delivery.warehouse_id, location_id=delivery.location_id,
                payment_terms_days=payment_terms_days, cost_center_code=payload.cost_center_code,
                notes=payload.notes, status="posted",
                subtotal=0, tax_amount=0, total=0, cogs_total=delivery.cogs_total,
            )
            db.add(invoice)
            db.flush()

            lines_total = 0.0
            for dline in delivery.lines:
                db.add(SalesInvoiceLine(
                    inv_number=invoice.inv_number, item_id=dline.item_id,
                    qty=dline.qty, unit_price=dline.unit_price, unit_cost=dline.unit_cost,
                ))
                lines_total += _to_float(dline.qty) * _to_float(dline.unit_price)

            subtotal, tax_amount, total, tax_type = _resolve_invoice_tax(
                db, lines_total, payload.tax_type_code, payload.tax_calc_method
            )
            invoice.subtotal = subtotal
            invoice.tax_amount = tax_amount
            invoice.tax_type_code = tax_type.code if tax_type else None
            invoice.total = total

            _post_sales_invoice_journal(db, invoice, subtotal, tax_amount, total, tax_type, 0, include_cogs_journal=False)
            delivery.invoice_status = "invoiced"

            db.commit()
            db.refresh(invoice)
            return invoice

        except HTTPException:
            db.rollback()
            raise
        except Exception:
            db.rollback()
            raise

    # ===== الحالة 2: فاتورة مباشرة بلا إذن تسليم (تخصم المخزون فوراً) =====
    if not payload.lines:
        raise HTTPException(400, "يجب إضافة صنف واحد على الأقل للفاتورة")

    prepared_lines = []
    for line in payload.lines:
        item = db.query(Item).filter(Item.code == line.item_code, Item.is_active.is_(True)).first()
        if not item:
            raise HTTPException(404, f"الصنف {line.item_code} غير موجود أو غير نشط")
        if _to_float(item.qty) < line.qty:
            raise HTTPException(400, f"الكمية المتاحة من الصنف {item.code} ({item.qty}) أقل من الكمية المطلوبة ({line.qty})")
        prepared_lines.append((item, line.qty, line.unit_price))

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

        _post_sales_invoice_journal(db, invoice, subtotal, tax_amount, total, tax_type, invoice.cogs_total, include_cogs_journal=True)

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
    """إلغاء فاتورة مبيعات:
    - فاتورة مباشرة (بلا إذن تسليم): تعيد الكمية المباعة للمخزون
      وتُلغي قيدها المزدوج (إيراد + تكلفة بضاعة معاً).
    - فاتورة مرتبطة بإذن تسليم: لا تُعيد أي كمية للمخزون (لم تخصمه
      أصلاً — إذن التسليم هو من فعل ذلك)، فقط تُلغي قيد الإيراد
      الخاص بها وتعيد فتح إذن التسليم ليصبح قابلاً للفوترة من جديد."""
    invoice = db.query(SalesInvoice).filter(SalesInvoice.inv_number == inv_number).first()
    if not invoice:
        raise HTTPException(404, "فاتورة المبيعات غير موجودة")
    if invoice.status == "cancelled":
        raise HTTPException(400, "الفاتورة ملغاة بالفعل")

    if invoice.delivery_number:
        delivery = db.query(DeliveryNote).filter(DeliveryNote.dn_number == invoice.delivery_number).first()
        if delivery:
            delivery.invoice_status = "not_invoiced"
    else:
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


# =========================================================
# SALES RETURN (مرتجع مبيعات) — عكس تناسبي مزدوج (إيراد+ضريبة، وتكلفة بضاعة+مخزون)
# =========================================================
def _post_sales_return_journal(db: Session, sales_return: SalesReturn, subtotal, tax_amount, total, tax_type, cogs_total):
    """يرحّل قيدين لمرتجع المبيعات:
    1) مدين إيرادات المبيعات [+ مدين ضريبة المبيعات المستحقة إن كان
       نوع الضريبة مرتبطاً بحساب] / دائن حساب العميل — تخفيض تناسبي
       لما استحق عليه.
    2) مدين المخزون / دائن تكلفة البضاعة المباعة — إرجاع البضاعة
       للمخزون بنفس تكلفتها وقت البيع الأصلي."""
    revenue_account = db.query(Account).filter(Account.code == "41").first()
    if not revenue_account:
        raise HTTPException(400, "حساب إيرادات المبيعات (41) غير موجود بدليل الحسابات.")
    cogs_account = db.query(Account).filter(Account.code == "51").first()
    if not cogs_account:
        raise HTTPException(400, "حساب تكلفة البضاعة المباعة (51) غير موجود بدليل الحسابات.")
    inventory_account = db.query(Account).filter(Account.code == "123").first()
    if not inventory_account:
        raise HTTPException(400, "حساب المخزون (123) غير موجود بدليل الحسابات.")

    customer = db.query(Customer).filter(Customer.code == sales_return.customer_code).first()
    receivable_account_code = (customer.account_code if customer and customer.account_code else None) or "1121"
    receivable_account = db.query(Account).filter(Account.code == receivable_account_code).first()
    if not receivable_account:
        raise HTTPException(400, f"الحساب المحاسبي المرتبط بالعميل ({receivable_account_code}) غير موجود بدليل الحسابات.")

    tax_account = None
    if tax_type and tax_type.account_code:
        tax_account = db.query(Account).filter(Account.code == tax_type.account_code).first()

    entry = JournalEntry(
        entry_date=sales_return.rt_date,
        description=f"مرتجع مبيعات {sales_return.rt_number} — العميل {sales_return.customer_code}",
        source_type="sales_return",
        source_ref=sales_return.rt_number,
        status="posted",
        total_amount=total,
    )
    db.add(entry)
    db.flush()

    line_no = 1
    if tax_amount and tax_account:
        db.add(JournalEntryLine(
            entry_id=entry.id, line_no=line_no, account_code=revenue_account.code,
            debit=subtotal, credit=0,
            line_description=f"تخفيض إيرادات — مرتجع {sales_return.rt_number}",
        ))
        line_no += 1
        db.add(JournalEntryLine(
            entry_id=entry.id, line_no=line_no, account_code=tax_account.code,
            debit=tax_amount, credit=0,
            line_description=f"عكس ضريبة مبيعات — مرتجع {sales_return.rt_number}",
            tax_type_code=tax_type.code, tax_rate=tax_type.rate, tax_amount=tax_amount,
        ))
        line_no += 1
    else:
        line_kwargs = dict(
            entry_id=entry.id, line_no=line_no, account_code=revenue_account.code,
            debit=round(subtotal + (tax_amount or 0), 2), credit=0,
            line_description=f"تخفيض إيرادات — مرتجع {sales_return.rt_number}",
        )
        if tax_type and tax_amount:
            line_kwargs.update(tax_type_code=tax_type.code, tax_rate=tax_type.rate, tax_amount=tax_amount)
        db.add(JournalEntryLine(**line_kwargs))
        line_no += 1

    db.add(JournalEntryLine(
        entry_id=entry.id, line_no=line_no, account_code=receivable_account.code,
        debit=0, credit=total,
        line_description=f"تخفيض مستحق على العميل {sales_return.customer_code} — مرتجع {sales_return.rt_number}",
    ))
    line_no += 1

    if cogs_total:
        db.add(JournalEntryLine(
            entry_id=entry.id, line_no=line_no, account_code=inventory_account.code,
            debit=cogs_total, credit=0,
            line_description=f"إرجاع بضاعة للمخزون — مرتجع {sales_return.rt_number}",
        ))
        line_no += 1
        db.add(JournalEntryLine(
            entry_id=entry.id, line_no=line_no, account_code=cogs_account.code,
            debit=0, credit=cogs_total,
            line_description=f"عكس تكلفة بضاعة مباعة — مرتجع {sales_return.rt_number}",
        ))
        line_no += 1

    sales_return.journal_entry_id = entry.id
    return entry


@sr_router.get("", response_model=list[SalesReturnOut])
def list_sales_returns(db: Session = Depends(get_db)):
    return db.query(SalesReturn).order_by(SalesReturn.rt_date.desc(), SalesReturn.rt_number.desc()).all()


@sr_router.post("", response_model=SalesReturnOut, status_code=201)
def create_sales_return(
    payload: SalesReturnIn,
    db: Session = Depends(get_db),
    actor: Optional[str] = Query(None),
):
    if not payload.lines:
        raise HTTPException(400, "يجب إضافة صنف واحد على الأقل للمرتجع")

    invoice = db.query(SalesInvoice).filter(SalesInvoice.inv_number == payload.inv_number).first()
    if not invoice:
        raise HTTPException(404, f"فاتورة المبيعات {payload.inv_number} غير موجودة")
    if invoice.status == "cancelled":
        raise HTTPException(400, "لا يمكن إنشاء مرتجع على فاتورة ملغاة")

    prepared_lines = []
    for line in payload.lines:
        if line.qty <= 0:
            raise HTTPException(400, "كمية المرتجع يجب أن تكون أكبر من صفر")
        item = db.query(Item).filter(Item.code == line.item_code, Item.is_active.is_(True)).first()
        if not item:
            raise HTTPException(404, f"الصنف {line.item_code} غير موجود أو غير نشط")

        invoice_line = (
            db.query(SalesInvoiceLine)
            .filter(SalesInvoiceLine.inv_number == invoice.inv_number, SalesInvoiceLine.item_id == item.id)
            .first()
        )
        if not invoice_line:
            raise HTTPException(400, f"الصنف {line.item_code} غير موجود في فاتورة المبيعات")

        previously_returned = (
            db.query(func.coalesce(func.sum(SalesReturnLine.qty), 0))
            .join(SalesReturn, SalesReturn.rt_number == SalesReturnLine.rt_number)
            .filter(
                SalesReturn.inv_number == invoice.inv_number,
                SalesReturnLine.item_id == item.id,
                SalesReturn.status != "cancelled",
            )
            .scalar()
        )
        invoiced_qty = _to_float(invoice_line.qty)
        remaining_returnable = invoiced_qty - _to_float(previously_returned)
        if line.qty > remaining_returnable:
            raise HTTPException(
                400,
                f"كمية مرتجع الصنف {line.item_code} أكبر من الكمية المتبقية القابلة للإرجاع ({remaining_returnable})",
            )

        prepared_lines.append((item, line.qty, _to_float(invoice_line.unit_price), _to_float(invoice_line.unit_cost)))

    try:
        sales_return = SalesReturn(
            rt_number=_next_document_number(db, SalesReturn, "rt_number", "SRT"),
            rt_date=payload.rt_date, customer_code=invoice.customer_code, inv_number=invoice.inv_number,
            status="posted", subtotal=0, tax_amount=0, total=0, cogs_total=0,
        )
        db.add(sales_return)
        db.flush()

        subtotal = 0.0
        cogs_total = 0.0
        wh_id = invoice.warehouse_id
        for item, qty, unit_price, unit_cost in prepared_lines:
            db.add(SalesReturnLine(
                rt_number=sales_return.rt_number, item_id=item.id,
                qty=qty, unit_price=unit_price, unit_cost=unit_cost,
            ))
            subtotal += qty * unit_price
            cogs_total += qty * unit_cost

            new_qty = _to_float(item.qty) + qty
            item.qty = new_qty
            db.add(StockMove(
                move_date=payload.rt_date, item_id=item.id, move_type="مرتجع مبيعات",
                reference=f"SRT-{sales_return.rt_number}", warehouse_id=wh_id,
                qty=qty, unit_cost=unit_cost, balance_after=new_qty,
            ))
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
                    row.quantity = _to_float(row.quantity) + qty

        # نصيب المرتجع التناسبي من ضريبة الفاتورة الأصلية (إن وُجدت)
        tax_type = None
        tax_amount = 0.0
        if invoice.tax_type_code and _to_float(invoice.subtotal) > 0:
            tax_type = db.query(TaxType).filter(TaxType.code == invoice.tax_type_code).first()
            effective_rate = _to_float(invoice.tax_amount) / _to_float(invoice.subtotal)
            tax_amount = round(subtotal * effective_rate, 2)

        total = round(subtotal + tax_amount, 2)
        sales_return.subtotal = round(subtotal, 2)
        sales_return.tax_type_code = tax_type.code if tax_type else None
        sales_return.tax_amount = tax_amount
        sales_return.total = total
        sales_return.cogs_total = round(cogs_total, 2)

        _post_sales_return_journal(db, sales_return, sales_return.subtotal, tax_amount, total, tax_type, sales_return.cogs_total)

        db.commit()
        db.refresh(sales_return)
        return sales_return

    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@sr_router.post("/{rt_number}/cancel", response_model=SalesReturnOut)
def cancel_sales_return(rt_number: str, db: Session = Depends(get_db)):
    """إلغاء مرتجع مبيعات: يخصم الكمية المرتجعة من المخزون مرة أخرى
    (بأمان — تماماً كبيع جديد، لا يخاطر برصيد سالب طالما البضاعة لم
    تُستهلك أو تُبَع بعد)، ويُلغي قيده المزدوج."""
    sales_return = db.query(SalesReturn).filter(SalesReturn.rt_number == rt_number).first()
    if not sales_return:
        raise HTTPException(404, "مرتجع المبيعات غير موجود")
    if sales_return.status == "cancelled":
        raise HTTPException(400, "المرتجع ملغى بالفعل")

    invoice = db.query(SalesInvoice).filter(SalesInvoice.inv_number == sales_return.inv_number).first()
    wh_id = invoice.warehouse_id if invoice else None

    for line in sales_return.lines:
        item = db.query(Item).filter(Item.id == line.item_id).first()
        if item:
            if _to_float(item.qty) < _to_float(line.qty):
                raise HTTPException(
                    400,
                    f"لا يمكن إلغاء المرتجع — الرصيد الحالي للصنف {item.code} أقل من الكمية المطلوب سحبها",
                )
            item.qty = _to_float(item.qty) - _to_float(line.qty)
            if wh_id:
                row = (
                    db.query(WarehouseStock)
                    .filter(
                        WarehouseStock.item_id == item.id, WarehouseStock.warehouse_id == wh_id,
                        WarehouseStock.location_id == (invoice.location_id if invoice else None) or item.default_location_id,
                    )
                    .first()
                )
                if row:
                    row.quantity = max(_to_float(row.quantity) - _to_float(line.qty), 0)

    if sales_return.journal_entry_id:
        entry = db.query(JournalEntry).filter(JournalEntry.id == sales_return.journal_entry_id).first()
        if entry and entry.status == "posted":
            entry.status = "cancelled"

    sales_return.status = "cancelled"
    db.commit()
    db.refresh(sales_return)
    return sales_return
