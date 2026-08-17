from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import (
    Account,
    CostCenter,
    GoodsReceipt,
    GoodsReceiptLine,
    Item,
    JournalEntry,
    JournalEntryLine,
    PurchaseInvoice,
    PurchaseInvoiceLine,
    PurchaseOrder,
    PurchaseOrderLine,
    PurchaseReturn,
    PurchaseReturnLine,
    StockMove,
    Supplier,
    TaxType,
)
from app.models.warehouse import Warehouse
from app.models.location import WarehouseLocation
from app.models.warehouse_stock import WarehouseStock
from app.schemas.inventory import (
    ItemIn,
    ItemOut,
    ItemUpdate,
    StockMoveOut,
    SupplierIn,
    SupplierOut,
    SupplierUpdate,
)
from app.schemas.purchasing import (
    DirectPurchaseInvoiceIn,
    GoodsReceiptIn,
    GoodsReceiptOut,
    PurchaseInvoiceIn,
    PurchaseInvoiceOut,
    PurchaseInvoiceUpdate,
    PurchaseOrderIn,
    PurchaseOrderOut,
    PurchaseReturnIn,
    PurchaseReturnOut,
)


router = APIRouter(prefix="/api/items", tags=["Items"])
stock_router = APIRouter(prefix="/api/stock-moves", tags=["StockMoves"])
supplier_router = APIRouter(prefix="/api/suppliers", tags=["Suppliers"])
po_router = APIRouter(prefix="/api/purchase-orders", tags=["PurchaseOrders"])
grn_router = APIRouter(prefix="/api/grn", tags=["GoodsReceipts"])
pinv_router = APIRouter(
    prefix="/api/purchase-invoices",
    tags=["PurchaseInvoices"],
)
prt_router = APIRouter(
    prefix="/api/purchase-returns",
    tags=["PurchaseReturns"],
)


# =========================================================
# HELPERS
# =========================================================
def _to_float(value) -> float:
    return float(value or 0)


def _validate_non_negative(value, field_name: str) -> float:
    number = _to_float(value)
    if number < 0:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} لا يمكن أن تكون قيمة سالبة",
        )
    return number


def _validate_positive(value, field_name: str) -> float:
    number = _to_float(value)
    if number <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} يجب أن تكون أكبر من صفر",
        )
    return number


def _next_document_number(db: Session, model, column_name: str, prefix: str, pad: int = 6) -> str:
    """توليد رقم مستند تسلسلي بالصيغة PREFIX-000001.

    أعمدة أرقام المستندات (po_number / grn_number / inv_number) هي
    مفاتيح أساسية نصية بلا قيمة افتراضية أو Sequence على مستوى قاعدة
    البيانات، لذا يجب توليدها هنا صراحة قبل الإدراج بالاعتماد على أعلى
    رقم موجود حالياً بنفس البادئة.
    """
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


def _validate_lines(lines, document_name: str) -> None:
    if not lines:
        raise HTTPException(
            status_code=400,
            detail=f"يجب إضافة بند واحد على الأقل إلى {document_name}",
        )

    item_codes = [line.item_code for line in lines]
    if len(item_codes) != len(set(item_codes)):
        raise HTTPException(
            status_code=400,
            detail=f"لا يمكن تكرار الصنف داخل {document_name}",
        )


def _item_has_transactions(db: Session, item_code: str) -> bool:
    item = db.query(Item).filter(Item.code == item_code).first()
    if not item:
        return False
    checks = (
        db.query(StockMove.id).filter(StockMove.item_id == item.id).first(),
        db.query(PurchaseOrderLine)
        .filter(PurchaseOrderLine.item_id == item.id)
        .first(),
        db.query(GoodsReceiptLine)
        .filter(GoodsReceiptLine.item_id == item.id)
        .first(),
        db.query(PurchaseInvoiceLine)
        .filter(PurchaseInvoiceLine.item_id == item.id)
        .first(),
        db.query(PurchaseReturnLine)
        .filter(PurchaseReturnLine.item_id == item.id)
        .first(),
    )
    return any(checks)


def _supplier_has_transactions(db: Session, supplier_code: str) -> bool:
    checks = (
        db.query(PurchaseOrder)
        .filter(PurchaseOrder.supplier_code == supplier_code)
        .first(),
        db.query(GoodsReceipt)
        .filter(GoodsReceipt.supplier_code == supplier_code)
        .first(),
        db.query(PurchaseInvoice)
        .filter(PurchaseInvoice.supplier_code == supplier_code)
        .first(),
        db.query(PurchaseReturn)
        .filter(PurchaseReturn.supplier_code == supplier_code)
        .first(),
    )
    return any(checks)


def calc_payable(db: Session, supplier_code: str) -> float:
    """
    الرصيد الحالي = فواتير الشراء المرحلة - مرتجعات الشراء.
    لا يشمل سندات السداد لعدم وجود نموذج مدفوعات في الكود الحالي.
    """
    invoiced = (
        db.query(func.coalesce(func.sum(PurchaseInvoice.total), 0))
        .filter(
            PurchaseInvoice.supplier_code == supplier_code,
            PurchaseInvoice.status == "posted",
        )
        .scalar()
    )

    returned = (
        db.query(func.coalesce(func.sum(PurchaseReturn.total), 0))
        .filter(PurchaseReturn.supplier_code == supplier_code)
        .scalar()
    )

    return _to_float(invoiced) - _to_float(returned)


# =========================================================
# ITEMS
# =========================================================
@router.get("", response_model=list[ItemOut])
def list_items(db: Session = Depends(get_db)):
    return (
        db.query(Item)
        .filter(Item.is_active.is_(True))
        .order_by(Item.code.asc())
        .all()
    )


@router.post("", response_model=ItemOut, status_code=201)
def create_item(payload: ItemIn, db: Session = Depends(get_db)):
    code = payload.code.strip()

    if not code:
        raise HTTPException(status_code=400, detail="كود الصنف مطلوب")

    if db.query(Item).filter(Item.code == code).first():
        raise HTTPException(status_code=400, detail="كود الصنف مستخدم من قبل")

    opening_qty = _validate_non_negative(payload.opening_qty, "الرصيد الافتتاحي")
    default_cost = _validate_non_negative(payload.default_cost, "التكلفة الافتراضية")
    price = _validate_non_negative(payload.price, "سعر البيع")
    reorder_level = _validate_non_negative(
        payload.reorder_level,
        "حد إعادة الطلب",
    )

    try:
        item = Item(
            code=code,
            name=payload.name,
            unit=payload.unit,
            default_cost=default_cost,
            price=price,
            qty=opening_qty,
            avg_cost=default_cost if opening_qty > 0 else 0,
            reorder_level=reorder_level,
        )
        db.add(item)
        db.flush()  # نحتاج item.id فوراً لإنشاء حركة المخزون الافتتاحية

        if opening_qty > 0:
            db.add(
                StockMove(
                    move_date=date.today(),
                    item_id=item.id,
                    move_type="افتتاحي",
                    reference="رصيد افتتاحي",
                    qty=opening_qty,
                    unit_cost=default_cost,
                    balance_after=opening_qty,
                )
            )

        db.commit()
        db.refresh(item)
        return item

    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@router.put("/{code}", response_model=ItemOut)
def update_item(
    code: str,
    payload: ItemUpdate,
    db: Session = Depends(get_db),
):
    item = db.query(Item).filter(Item.code == code).first()
    if not item:
        raise HTTPException(status_code=404, detail="الصنف غير موجود")

    data = payload.model_dump(exclude_unset=True)
    new_code = data.pop("code", None)

    if new_code:
        new_code = new_code.strip()
        if not new_code:
            raise HTTPException(status_code=400, detail="كود الصنف مطلوب")

    if new_code and new_code != code:
        if db.query(Item).filter(Item.code == new_code).first():
            raise HTTPException(
                status_code=400,
                detail="كود الصنف الجديد مستخدم من قبل",
            )

        if _item_has_transactions(db, code):
            raise HTTPException(
                status_code=400,
                detail="لا يمكن تغيير كود صنف مرتبط بحركات أو مستندات",
            )

    numeric_fields = {
        "default_cost": "التكلفة الافتراضية",
        "price": "سعر البيع",
        "qty": "الكمية",
        "avg_cost": "متوسط التكلفة",
        "reorder_level": "حد إعادة الطلب",
    }

    for field, label in numeric_fields.items():
        if field in data:
            data[field] = _validate_non_negative(data[field], label)

    try:
        for key, value in data.items():
            setattr(item, key, value)

        if new_code and new_code != code:
            item.code = new_code

        db.commit()
        db.refresh(item)
        return item

    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@router.delete("/{code}", status_code=204)
def delete_item(code: str, db: Session = Depends(get_db)):
    item = db.query(Item).filter(Item.code == code).first()
    if not item:
        raise HTTPException(status_code=404, detail="الصنف غير موجود")

    if _item_has_transactions(db, code):
        raise HTTPException(
            status_code=400,
            detail="لا يمكن حذف صنف مرتبط بحركات أو مستندات",
        )

    try:
        db.delete(item)
        db.commit()
        return None
    except Exception:
        db.rollback()
        raise


# =========================================================
# STOCK MOVES
# =========================================================
@stock_router.get("", response_model=list[StockMoveOut])
def list_stock_moves(
    item_code: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(StockMove).order_by(
        StockMove.move_date.desc(),
        StockMove.id.desc(),
    )

    if item_code:
        item = db.query(Item).filter(Item.code == item_code).first()
        query = query.filter(StockMove.item_id == item.id) if item else query.filter(False)

    return query.all()


# =========================================================
# ملاحظة: نقاط API الخاصة بالموردين (قائمة/إنشاء/تعديل/حذف/كشف حساب)
# منقولة بالكامل إلى inventory.py — الراوتر supplier_router المُسجَّل
# فعلياً بالتطبيق (main.py) هو inventory.supplier_router، وليس النسخة
# المعرَّفة بهذا الملف (لم تكن مُسجَّلة إطلاقاً بالتطبيق). أُبقيت
# الدوال المساعدة أعلاه لعدم وجود اعتمادية خارجية عليها حالياً.
# =========================================================


# =========================================================
# PURCHASE ORDERS
# =========================================================
@po_router.get("", response_model=list[PurchaseOrderOut])
def list_purchase_orders(db: Session = Depends(get_db)):
    return (
        db.query(PurchaseOrder)
        .order_by(
            PurchaseOrder.po_date.desc(),
            PurchaseOrder.po_number.desc(),
        )
        .all()
    )


@po_router.post("", response_model=PurchaseOrderOut, status_code=201)
def create_purchase_order(
    payload: PurchaseOrderIn,
    db: Session = Depends(get_db),
):
    _validate_lines(payload.lines, "طلب الشراء")

    supplier = (
        db.query(Supplier)
        .filter(
            Supplier.code == payload.supplier_code,
            Supplier.is_active.is_(True),
        )
        .first()
    )
    if not supplier:
        raise HTTPException(
            status_code=404,
            detail="المورد غير موجود أو غير نشط",
        )

    prepared_lines = []
    for line in payload.lines:
        item = (
            db.query(Item)
            .filter(
                Item.code == line.item_code,
                Item.is_active.is_(True),
            )
            .first()
        )
        if not item:
            raise HTTPException(
                status_code=404,
                detail=f"الصنف {line.item_code} غير موجود أو غير نشط",
            )

        qty = _validate_positive(line.qty, "الكمية")
        unit_price = _validate_non_negative(line.unit_price, "سعر الوحدة")
        prepared_lines.append((item.id, qty, unit_price))

    try:
        purchase_order = PurchaseOrder(
            po_number=_next_document_number(db, PurchaseOrder, "po_number", "PO"),
            po_date=payload.po_date,
            supplier_code=payload.supplier_code,
            status="draft",
            total=0,
        )
        db.add(purchase_order)
        db.flush()

        total = 0.0
        for item_id, qty, unit_price in prepared_lines:
            db.add(
                PurchaseOrderLine(
                    po_number=purchase_order.po_number,
                    item_id=item_id,
                    qty=qty,
                    unit_price=unit_price,
                )
            )
            total += qty * unit_price

        purchase_order.total = total
        db.commit()
        db.refresh(purchase_order)
        return purchase_order

    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


# =========================================================
# GOODS RECEIPT (GRN)
# =========================================================
@grn_router.get("", response_model=list[GoodsReceiptOut])
def list_grn(db: Session = Depends(get_db)):
    return (
        db.query(GoodsReceipt)
        .order_by(
            GoodsReceipt.grn_date.desc(),
            GoodsReceipt.grn_number.desc(),
        )
        .all()
    )


@grn_router.post("", response_model=GoodsReceiptOut, status_code=201)
def create_grn(
    payload: GoodsReceiptIn,
    db: Session = Depends(get_db),
):
    return _create_grn_core(payload, db, post_journal=True)


def _post_grn_journal(db: Session, grn: GoodsReceipt, total: float):
    """يرحّل قيد الاستلام: مدين المخزون (123) / دائن بضاعة مستلمة غير
    مفوترة (217) — يعكس دخول البضاعة فعلياً للمخزون فور استلامها، قبل
    وصول فاتورة المورد بفترة قد تمتد لأيام أو أسابيع."""
    if not total:
        return None

    inventory_account = db.query(Account).filter(Account.code == "123").first()
    if not inventory_account:
        raise HTTPException(
            status_code=400,
            detail="حساب المخزون (123) غير موجود بدليل الحسابات — لا يمكن ترحيل قيد الاستلام.",
        )
    grni_account = db.query(Account).filter(Account.code == "217").first()
    if not grni_account:
        raise HTTPException(
            status_code=400,
            detail="حساب (بضاعة مستلمة غير مفوترة - 217) غير موجود بدليل الحسابات — لا يمكن ترحيل قيد الاستلام. "
                   "يرجى تطبيق تحديث دليل الحسابات أولاً.",
        )

    entry = JournalEntry(
        entry_date=grn.grn_date,
        description=f"استلام بضاعة {grn.grn_number} — المورد {grn.supplier_code}",
        source_type="goods_receipt",
        source_ref=grn.grn_number,
        supplier_code=grn.supplier_code,
        status="posted",
        total_amount=total,
    )
    db.add(entry)
    db.flush()

    db.add(JournalEntryLine(
        entry_id=entry.id, line_no=1, account_code=inventory_account.code,
        debit=total, credit=0,
        line_description=f"مخزون — استلام {grn.grn_number}",
    ))
    db.add(JournalEntryLine(
        entry_id=entry.id, line_no=2, account_code=grni_account.code,
        debit=0, credit=total,
        line_description=f"بضاعة مستلمة غير مفوترة — استلام {grn.grn_number}",
    ))

    grn.journal_entry_id = entry.id
    return entry


def _resolve_warehouse_and_location(db: Session, warehouse_id, location_id):
    """يحدد المستودع والموقع الفعليين لعملية استلام: يتحقق من صحتهما
    إن أُرسلا، أو يستخدم المستودع الافتراضي (المُعلَّم is_default، أو
    كود MAIN كحل احتياطي) وأول موقع تابع له إن لم يُحدَّد شيء —
    للتوافق مع أي طلب لا يرسل مستودعاً صراحة."""
    warehouse = None
    if warehouse_id is not None:
        warehouse = db.query(Warehouse).filter(Warehouse.id == warehouse_id, Warehouse.is_active.is_(True)).first()
        if not warehouse:
            raise HTTPException(status_code=404, detail="المستودع غير موجود أو غير نشط")
    else:
        warehouse = db.query(Warehouse).filter(Warehouse.is_default.is_(True), Warehouse.is_active.is_(True)).first()
        if not warehouse:
            warehouse = db.query(Warehouse).filter(Warehouse.code == "MAIN").first()
        if not warehouse:
            raise HTTPException(
                status_code=400,
                detail="لا يوجد مستودع افتراضي بالنظام — يرجى إنشاء مستودع أولاً من شاشة المستودعات",
            )

    location = None
    if location_id is not None:
        location = (
            db.query(WarehouseLocation)
            .filter(WarehouseLocation.id == location_id, WarehouseLocation.warehouse_id == warehouse.id)
            .first()
        )
        if not location:
            raise HTTPException(status_code=404, detail="موقع التخزين غير موجود ضمن هذا المستودع")
    else:
        location = (
            db.query(WarehouseLocation)
            .filter(WarehouseLocation.warehouse_id == warehouse.id)
            .order_by(WarehouseLocation.id.asc())
            .first()
        )
        if not location:
            location = WarehouseLocation(warehouse_id=warehouse.id, code="GENERAL", name="موقع عام")
            db.add(location)
            db.flush()

    return warehouse, location


def _adjust_warehouse_stock(db: Session, item_id: int, warehouse_id: int, location_id, qty_delta: float, avg_cost: float):
    """يحدّث رصيد الصنف بمستودع/موقع معيّن (warehouse_stock) بفارق الكمية
    المُمرَّر (موجب = إضافة، سالب = خصم)، ثم يزامن avg_cost على كل صفوف
    هذا الصنف بكل المستودعات دفعة واحدة لتبقى معكوسة لآخر تكلفة متوسطة
    عامة صحيحة (Item.avg_cost) — تفادياً لبقاء قيمة قديمة (Stale) بمستودع
    لم تحدث فيه الحركة الحالية، رغم أن التكلفة العامة للصنف تغيّرت."""
    row = (
        db.query(WarehouseStock)
        .filter(
            WarehouseStock.item_id == item_id,
            WarehouseStock.warehouse_id == warehouse_id,
            WarehouseStock.location_id == location_id,
        )
        .first()
    )
    if not row:
        row = WarehouseStock(item_id=item_id, warehouse_id=warehouse_id, location_id=location_id, quantity=0, avg_cost=0)
        db.add(row)
        db.flush()

    new_qty = _to_float(row.quantity) + qty_delta
    row.quantity = max(new_qty, 0)
    row.avg_cost = avg_cost

    db.query(WarehouseStock).filter(WarehouseStock.item_id == item_id).update(
        {WarehouseStock.avg_cost: avg_cost}, synchronize_session=False
    )
    return row


def _create_grn_core(
    payload: GoodsReceiptIn,
    db: Session,
    post_journal: bool = True,
):
    """المنطق الفعلي لإنشاء إذن استلام. post_journal=True يرحّل قيد
    الاستلام التلقائي (مدين المخزون / دائن بضاعة مستلمة غير مفوترة).
    يُمرَّر post_journal=False فقط عند الإنشاء التلقائي خلف فاتورة
    مشتريات مباشرة، حيث لا توجد فجوة زمنية حقيقية بين الاستلام والفوترة
    (يحدثان بنفس اللحظة)، فيُكتفى بقيد الفاتورة المباشر بخطوة واحدة."""
    _validate_lines(payload.lines, "إذن الاستلام")

    supplier = (
        db.query(Supplier)
        .filter(
            Supplier.code == payload.supplier_code,
            Supplier.is_active.is_(True),
        )
        .first()
    )
    if not supplier:
        raise HTTPException(
            status_code=404,
            detail="المورد غير موجود أو غير نشط",
        )

    purchase_order = None
    if payload.po_number:
        purchase_order = (
            db.query(PurchaseOrder)
            .filter(PurchaseOrder.po_number == payload.po_number)
            .first()
        )
        if not purchase_order:
            raise HTTPException(
                status_code=404,
                detail=f"طلب الشراء {payload.po_number} غير موجود",
            )

        if purchase_order.supplier_code != payload.supplier_code:
            raise HTTPException(
                status_code=400,
                detail="المورد في إذن الاستلام لا يطابق مورد طلب الشراء",
            )

    prepared_lines = []
    for line in payload.lines:
        item = (
            db.query(Item)
            .filter(
                Item.code == line.item_code,
                Item.is_active.is_(True),
            )
            .first()
        )
        if not item:
            raise HTTPException(
                status_code=404,
                detail=f"الصنف {line.item_code} غير موجود أو غير نشط",
            )

        qty = _validate_positive(line.qty, "الكمية المستلمة")
        unit_cost = _validate_non_negative(line.unit_cost, "تكلفة الوحدة")

        if purchase_order:
            po_line = (
                db.query(PurchaseOrderLine)
                .filter(
                    PurchaseOrderLine.po_number == purchase_order.po_number,
                    PurchaseOrderLine.item_id == item.id,
                )
                .first()
            )
            if not po_line:
                raise HTTPException(
                    status_code=400,
                    detail=f"الصنف {item.code} غير موجود في طلب الشراء",
                )

        prepared_lines.append((item, qty, unit_cost))

    warehouse, location = _resolve_warehouse_and_location(db, payload.warehouse_id, payload.location_id)

    try:
        grn = GoodsReceipt(
            grn_number=_next_document_number(db, GoodsReceipt, "grn_number", "GRN"),
            grn_date=payload.grn_date,
            supplier_code=payload.supplier_code,
            po_number=payload.po_number,
            reference=payload.reference,
            warehouse_id=warehouse.id,
            location_id=location.id,
            total=0,
            invoice_status="not_invoiced",
        )
        db.add(grn)
        db.flush()

        total = 0.0
        for item, qty, unit_cost in prepared_lines:
            old_qty = _to_float(item.qty)
            old_avg_cost = _to_float(item.avg_cost)
            new_qty = old_qty + qty

            new_avg_cost = (
                ((old_avg_cost * old_qty) + (unit_cost * qty)) / new_qty
                if new_qty > 0
                else 0
            )

            db.add(
                GoodsReceiptLine(
                    grn_number=grn.grn_number,
                    item_id=item.id,
                    qty=qty,
                    unit_cost=unit_cost,
                )
            )

            item.qty = new_qty
            item.avg_cost = new_avg_cost

            db.add(
                StockMove(
                    move_date=payload.grn_date,
                    item_id=item.id,
                    move_type="استلام مشتريات",
                    reference=f"GRN-{grn.grn_number}",
                    warehouse_id=warehouse.id,
                    qty=qty,
                    unit_cost=unit_cost,
                    balance_after=new_qty,
                )
            )

            _adjust_warehouse_stock(db, item.id, warehouse.id, location.id, qty, new_avg_cost)

            total += qty * unit_cost

        grn.total = total

        if purchase_order:
            purchase_order.status = "received"

        if post_journal:
            _post_grn_journal(db, grn, total)

        db.commit()
        db.refresh(grn)
        return grn

    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


def _is_grn_edit_safe(db: Session, grn: GoodsReceipt):
    """يتحقق أن أصناف إذن الاستلام لم تتأثر بأي حركة مخزون لاحقة (بيع،
    مرتجع، استلام آخر...) قبل السماح بتعديل كامل يعكس أثر الكمية
    والتكلفة المتوسطة. إن وُجدت حركة لاحقة، فالتعديل الكامل غير آمن
    رياضياً (لا يمكن عكس متوسط مرجّح بدقة بعد أن تغيّر لاحقاً بحركات
    أخرى) — يُرجع سبب الرفض عوضاً عن ذلك لتوجيه المستخدم لاستخدام
    مرتجع مشتريات بدلاً من التعديل الكامل."""
    lines = (
        db.query(GoodsReceiptLine)
        .filter(GoodsReceiptLine.grn_number == grn.grn_number)
        .all()
    )
    for line in lines:
        move = (
            db.query(StockMove)
            .filter(
                StockMove.item_id == line.item_id,
                StockMove.reference == f"GRN-{grn.grn_number}",
            )
            .order_by(StockMove.id.desc())
            .first()
        )
        if not move:
            continue
        later_move = (
            db.query(StockMove)
            .filter(StockMove.item_id == line.item_id, StockMove.id > move.id)
            .first()
        )
        if later_move:
            item = db.query(Item).filter(Item.id == line.item_id).first()
            item_label = item.code if item else str(line.item_id)
            return False, (
                f"لا يمكن التعديل الكامل: حدثت حركة مخزون لاحقة على الصنف {item_label} "
                "(بيع أو مرتجع أو استلام آخر)، ما يجعل عكس التكلفة المتوسطة المرجّحة "
                "غير دقيق رياضياً. استخدم مرتجع مشتريات لتصحيح الكمية أو الأصناف بدلاً من ذلك."
            )
    return True, ""


@grn_router.put("/{grn_number}", response_model=GoodsReceiptOut)
def update_grn(
    grn_number: str,
    payload: GoodsReceiptIn,
    db: Session = Depends(get_db),
):
    """تعديل كامل لإذن استلام غير مفوتر: يعكس أثر الأصناف القديمة على
    الكمية والتكلفة المتوسطة للأصناف (بأمان فقط، عبر _is_grn_edit_safe)،
    ثم يطبّق الأصناف والمورد والتاريخ الجديد تماماً كإنشاء جديد. يُستخدم
    هذا المسار من مسار "تعديل الفاتورة كاملة" بالفرونت إند: إلغاء
    الفاتورة ← تعديل الاستلام ← إعادة ترحيل فاتورة جديدة على نفس الاستلام."""
    grn = db.query(GoodsReceipt).filter(GoodsReceipt.grn_number == grn_number).first()
    if not grn:
        raise HTTPException(status_code=404, detail="إذن الاستلام غير موجود")
    if grn.invoice_status == "invoiced":
        raise HTTPException(
            status_code=400,
            detail="لا يمكن تعديل إذن استلام مرتبط بفاتورة مرحّلة — يجب إلغاء الفاتورة أولاً",
        )
    if grn.po_number and payload.supplier_code != grn.supplier_code:
        raise HTTPException(
            status_code=400,
            detail="لا يمكن تغيير المورد لإذن استلام مرتبط بأمر شراء",
        )

    safe, reason = _is_grn_edit_safe(db, grn)
    if not safe:
        raise HTTPException(status_code=400, detail=reason)

    _validate_lines(payload.lines, "إذن الاستلام")

    supplier = (
        db.query(Supplier)
        .filter(Supplier.code == payload.supplier_code, Supplier.is_active.is_(True))
        .first()
    )
    if not supplier:
        raise HTTPException(status_code=404, detail="المورد غير موجود أو غير نشط")

    prepared_lines = []
    for line in payload.lines:
        item = (
            db.query(Item)
            .filter(Item.code == line.item_code, Item.is_active.is_(True))
            .first()
        )
        if not item:
            raise HTTPException(status_code=404, detail=f"الصنف {line.item_code} غير موجود أو غير نشط")
        qty = _validate_positive(line.qty, "الكمية المستلمة")
        unit_cost = _validate_non_negative(line.unit_cost, "تكلفة الوحدة")
        prepared_lines.append((item, qty, unit_cost))

    try:
        old_warehouse_id = grn.warehouse_id
        old_location_id = grn.location_id

        # 1) عكس أثر الأصناف القديمة على الكمية/التكلفة المتوسطة، وحذف حركاتها وسطورها القديمة
        old_lines = (
            db.query(GoodsReceiptLine)
            .filter(GoodsReceiptLine.grn_number == grn.grn_number)
            .all()
        )
        for old_line in old_lines:
            item = db.query(Item).filter(Item.id == old_line.item_id).first()
            new_avg_after_reversal = 0.0
            if item:
                old_qty = _to_float(item.qty)
                old_avg = _to_float(item.avg_cost)
                line_qty = _to_float(old_line.qty)
                line_cost = _to_float(old_line.unit_cost)
                new_qty = old_qty - line_qty
                if new_qty < -0.0001:
                    raise HTTPException(
                        status_code=400,
                        detail=f"لا يمكن عكس الكمية القديمة للصنف {item.code} — الرصيد الحالي أقل من الكمية المطلوب عكسها",
                    )
                new_qty = max(new_qty, 0)
                remaining_value = (old_qty * old_avg) - (line_qty * line_cost)
                new_avg_after_reversal = (remaining_value / new_qty) if new_qty > 0 else 0
                item.qty = new_qty
                item.avg_cost = new_avg_after_reversal
            db.query(StockMove).filter(
                StockMove.item_id == old_line.item_id,
                StockMove.reference == f"GRN-{grn.grn_number}",
            ).delete()
            if old_warehouse_id:
                _adjust_warehouse_stock(
                    db, old_line.item_id, old_warehouse_id, old_location_id,
                    -_to_float(old_line.qty), new_avg_after_reversal,
                )
            db.delete(old_line)

        # 2) إلغاء قيد الاستلام القديم (إن وُجد) قبل ترحيل قيد جديد
        had_journal = bool(grn.journal_entry_id)
        if grn.journal_entry_id:
            old_entry = db.query(JournalEntry).filter(JournalEntry.id == grn.journal_entry_id).first()
            if old_entry:
                old_entry.status = "cancelled"
            grn.journal_entry_id = None

        # 3) تطبيق بيانات ثم أصناف الاستلام الجديدة (نفس منطق الإنشاء)
        warehouse, location = _resolve_warehouse_and_location(db, payload.warehouse_id, payload.location_id)
        grn.supplier_code = payload.supplier_code
        grn.grn_date = payload.grn_date
        grn.reference = payload.reference
        grn.warehouse_id = warehouse.id
        grn.location_id = location.id

        total = 0.0
        for item, qty, unit_cost in prepared_lines:
            old_qty = _to_float(item.qty)
            old_avg_cost = _to_float(item.avg_cost)
            new_qty = old_qty + qty
            new_avg_cost = (
                ((old_avg_cost * old_qty) + (unit_cost * qty)) / new_qty
                if new_qty > 0 else 0
            )

            db.add(GoodsReceiptLine(
                grn_number=grn.grn_number, item_id=item.id, qty=qty, unit_cost=unit_cost,
            ))
            item.qty = new_qty
            item.avg_cost = new_avg_cost
            db.add(StockMove(
                move_date=payload.grn_date, item_id=item.id, move_type="استلام مشتريات (معدّل)",
                reference=f"GRN-{grn.grn_number}", warehouse_id=warehouse.id,
                qty=qty, unit_cost=unit_cost, balance_after=new_qty,
            ))
            _adjust_warehouse_stock(db, item.id, warehouse.id, location.id, qty, new_avg_cost)
            total += qty * unit_cost

        grn.total = total
        grn.invoice_status = "not_invoiced"

        if had_journal:
            _post_grn_journal(db, grn, total)

        db.commit()
        db.refresh(grn)
        return grn

    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


# =========================================================
# ضريبة فاتورة المشتريات + الترحيل المحاسبي التلقائي
# =========================================================

def _resolve_invoice_tax(db: Session, lines_total: float, tax_type_code, tax_calc_method):
    """يحدد صافي قيمة الأصناف ومبلغ الضريبة وإجمالي الفاتورة بناءً على
    نوع الضريبة المختار وطريقة الاحتساب (متضمنة/غير متضمنة). عند عدم
    اختيار ضريبة، الصافي = الإجمالي = مجموع الأصناف كما كان سابقاً."""
    if not tax_type_code:
        total = round(lines_total, 2)
        return total, 0.0, total, None

    tax_type = (
        db.query(TaxType)
        .filter(TaxType.code == tax_type_code, TaxType.is_active.is_(True))
        .first()
    )
    if not tax_type:
        raise HTTPException(
            status_code=404,
            detail=f"نوع الضريبة {tax_type_code} غير موجود أو غير مفعّل",
        )

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


def _post_purchase_invoice_journal(
    db: Session,
    invoice: PurchaseInvoice,
    grn,
    subtotal: float,
    tax_amount: float,
    total: float,
    tax_type,
):
    """يرحّل القيد المحاسبي التلقائي لفاتورة المشتريات.

    - إن كان إذن الاستلام المرتبط قد رُحّل له قيد استلام مستقل مسبقاً
      (مدين المخزون / دائن بضاعة مستلمة غير مفوترة — الحالة الطبيعية في
      دورة الشراء الكاملة)، فقيد الفاتورة هنا **يقفل** ذلك الحساب
      الوسيط: مدين بضاعة مستلمة غير مفوترة (بقيمة الصافي) [+ مدين حساب
      الضريبة، أو تسوية تكلفة إضافية على المخزون إن لم يوجد حساب ضريبة
      مرتبط] / دائن حساب المورد.
    - وإن لم يوجد قيد استلام مستقل (حالة الفاتورة المباشرة، حيث لا
      توجد فجوة زمنية حقيقية بين الاستلام والفوترة لأنهما يحدثان بنفس
      اللحظة)، يُرحَّل القيد بخطوة واحدة كما كان: مدين المخزون مباشرة
      / دائن حساب المورد."""
    inventory_account = db.query(Account).filter(Account.code == "123").first()
    if not inventory_account:
        raise HTTPException(
            status_code=400,
            detail="حساب المخزون (123) غير موجود بدليل الحسابات — لا يمكن ترحيل القيد المحاسبي للفاتورة. "
                   "يرجى إنشاء الحساب أولاً من شاشة دليل الحسابات.",
        )

    use_grni = bool(grn and grn.journal_entry_id)
    grni_account = None
    if use_grni:
        grni_account = db.query(Account).filter(Account.code == "217").first()
        if not grni_account:
            raise HTTPException(
                status_code=400,
                detail="حساب (بضاعة مستلمة غير مفوترة - 217) غير موجود بدليل الحسابات — "
                       "لا يمكن ترحيل القيد المحاسبي للفاتورة. يرجى تطبيق تحديث دليل الحسابات أولاً.",
            )

    supplier = db.query(Supplier).filter(Supplier.code == invoice.supplier_code).first()
    payable_account_code = (supplier.account_code if supplier and supplier.account_code else None) or "211"
    payable_account = db.query(Account).filter(Account.code == payable_account_code).first()
    if not payable_account:
        raise HTTPException(
            status_code=400,
            detail=f"الحساب المحاسبي المرتبط بالمورد ({payable_account_code}) غير موجود بدليل الحسابات.",
        )

    tax_account = None
    if tax_type and tax_type.account_code:
        tax_account = db.query(Account).filter(Account.code == tax_type.account_code).first()

    entry = JournalEntry(
        entry_date=invoice.inv_date,
        description=f"فاتورة مشتريات {invoice.inv_number} — المورد {invoice.supplier_code}",
        source_type="purchase_invoice",
        source_ref=invoice.inv_number,
        invoice_number=invoice.inv_number,
        supplier_code=invoice.supplier_code,
        status="posted",
        cost_center_code=invoice.cost_center_code,
        total_amount=total,
    )
    db.add(entry)
    db.flush()

    main_account_code = grni_account.code if use_grni else inventory_account.code
    main_desc = (
        f"تسوية بضاعة مستلمة غير مفوترة — فاتورة {invoice.inv_number} ({grn.grn_number})"
        if use_grni else
        f"مخزون — فاتورة مشتريات {invoice.inv_number}"
    )

    line_no = 1
    if tax_amount and tax_account:
        # حساب ضريبة مستقل ومربوط بدليل الحسابات: إقفال GRNI/تسجيل المخزون بالصافي + مدين حساب الضريبة
        db.add(JournalEntryLine(
            entry_id=entry.id, line_no=line_no, account_code=main_account_code,
            debit=subtotal, credit=0,
            line_description=main_desc,
        ))
        line_no += 1
        db.add(JournalEntryLine(
            entry_id=entry.id, line_no=line_no, account_code=tax_account.code,
            debit=tax_amount, credit=0,
            line_description=f"ضريبة مشتريات (مدخلات) — فاتورة {invoice.inv_number}",
            tax_type_code=tax_type.code, tax_rate=tax_type.rate, tax_amount=tax_amount,
        ))
        line_no += 1
    elif tax_amount and use_grni:
        # ضريبة بدون حساب مرتبط + قيد استلام سابق: تُقفل GRNI بالصافي فقط
        # (لأن هذا هو المبلغ المُرحَّل أصلاً عند الاستلام)، وتُضاف الضريبة
        # كتسوية تكلفة إضافية منفصلة على المخزون بدل خلطها بسطر الإقفال
        db.add(JournalEntryLine(
            entry_id=entry.id, line_no=line_no, account_code=main_account_code,
            debit=subtotal, credit=0,
            line_description=main_desc,
        ))
        line_no += 1
        db.add(JournalEntryLine(
            entry_id=entry.id, line_no=line_no, account_code=inventory_account.code,
            debit=tax_amount, credit=0,
            line_description=f"تسوية تكلفة (ضريبة غير مربوطة بحساب) — فاتورة {invoice.inv_number}",
            tax_type_code=tax_type.code, tax_rate=tax_type.rate, tax_amount=tax_amount,
        ))
        line_no += 1
    else:
        # لا يوجد نوع ضريبة، أو (حالة الفاتورة المباشرة بدون GRNI) ضريبة
        # بدون حساب مرتبط: تُطوى ضمن نفس سطر المخزون الرئيسي
        line_kwargs = dict(
            entry_id=entry.id, line_no=line_no, account_code=main_account_code,
            debit=round(subtotal + (tax_amount or 0), 2), credit=0,
            line_description=main_desc,
        )
        if tax_type and tax_amount:
            line_kwargs.update(
                tax_type_code=tax_type.code, tax_rate=tax_type.rate, tax_amount=tax_amount,
            )
        db.add(JournalEntryLine(**line_kwargs))
        line_no += 1

    db.add(JournalEntryLine(
        entry_id=entry.id, line_no=line_no, account_code=payable_account.code,
        debit=0, credit=total,
        line_description=f"مستحق للمورد {invoice.supplier_code} — فاتورة {invoice.inv_number}",
    ))

    invoice.journal_entry_id = entry.id
    return entry


# =========================================================
# PURCHASE INVOICE
# =========================================================
@pinv_router.get("", response_model=list[PurchaseInvoiceOut])
def list_purchase_invoices(db: Session = Depends(get_db)):
    return (
        db.query(PurchaseInvoice)
        .order_by(
            PurchaseInvoice.inv_date.desc(),
            PurchaseInvoice.inv_number.desc(),
        )
        .all()
    )


@pinv_router.post("", response_model=PurchaseInvoiceOut, status_code=201)
def create_purchase_invoice(
    payload: PurchaseInvoiceIn,
    db: Session = Depends(get_db),
):
    grn = (
        db.query(GoodsReceipt)
        .filter(GoodsReceipt.grn_number == payload.grn_number)
        .first()
    )
    if not grn:
        raise HTTPException(
            status_code=404,
            detail=f"إذن الاستلام {payload.grn_number} غير موجود",
        )

    if grn.invoice_status == "invoiced":
        raise HTTPException(
            status_code=400,
            detail="تم إنشاء فاتورة لهذا إذن الاستلام من قبل",
        )

    grn_lines = (
        db.query(GoodsReceiptLine)
        .filter(GoodsReceiptLine.grn_number == grn.grn_number)
        .all()
    )
    if not grn_lines:
        raise HTTPException(
            status_code=400,
            detail="إذن الاستلام لا يحتوي على أصناف",
        )

    if payload.cost_center_code:
        cost_center = (
            db.query(CostCenter)
            .filter(CostCenter.code == payload.cost_center_code)
            .first()
        )
        if not cost_center:
            raise HTTPException(
                status_code=404,
                detail=f"مركز التكلفة {payload.cost_center_code} غير موجود",
            )

    payment_terms_days = payload.payment_terms_days
    if payment_terms_days is None:
        supplier = (
            db.query(Supplier)
            .filter(Supplier.code == grn.supplier_code)
            .first()
        )
        payment_terms_days = (supplier.payment_terms_days or 0) if supplier else 0

    try:
        invoice = PurchaseInvoice(
            inv_number=_next_document_number(db, PurchaseInvoice, "inv_number", "INV"),
            inv_date=payload.inv_date,
            grn_number=grn.grn_number,
            supplier_code=grn.supplier_code,
            supplier_inv_number=payload.supplier_inv_number,
            payment_terms_days=payment_terms_days,
            cost_center_code=payload.cost_center_code,
            total=0,
            status="posted",
        )
        db.add(invoice)
        db.flush()

        total = 0.0
        for line in grn_lines:
            qty = _to_float(line.qty)
            unit_cost = _to_float(line.unit_cost)

            db.add(
                PurchaseInvoiceLine(
                    inv_number=invoice.inv_number,
                    item_id=line.item_id,
                    qty=qty,
                    unit_cost=unit_cost,
                )
            )
            total += qty * unit_cost

        subtotal, tax_amount, total, tax_type = _resolve_invoice_tax(
            db, total, payload.tax_type_code, payload.tax_calc_method
        )
        invoice.subtotal = subtotal
        invoice.tax_amount = tax_amount
        invoice.tax_type_code = tax_type.code if tax_type else None
        invoice.total = total
        grn.invoice_status = "invoiced"

        _post_purchase_invoice_journal(db, invoice, grn, subtotal, tax_amount, total, tax_type)

        db.commit()
        db.refresh(invoice)
        return invoice

    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@pinv_router.post(
    "/direct",
    response_model=PurchaseInvoiceOut,
    status_code=201,
)
def create_direct_purchase_invoice(
    payload: DirectPurchaseInvoiceIn,
    db: Session = Depends(get_db),
):
    """
    إنشاء فاتورة مشتريات مباشرة دون المرور يدوياً بدورة الشراء الكاملة
    (طلب شراء ← عرض سعر ← أمر شراء ← استلام). يُنشئ الخادم إذن استلام
    مرتبط تلقائياً في الخلفية بنفس بيانات الفاتورة، حتى يبقى المخزون
    والتكلفة المتوسطة للأصناف والقيود المحاسبية اللاحقة صحيحة ومتتبَّعة
    تماماً كما لو تم إدخالها يدوياً، ثم يُرحّل الفاتورة على هذا الإذن
    فوراً في نفس العملية.
    """
    grn_payload = GoodsReceiptIn(
        grn_date=payload.inv_date,
        supplier_code=payload.supplier_code,
        po_number=None,
        reference=payload.reference or "فاتورة مباشرة (بدون دورة شراء)",
        warehouse_id=payload.warehouse_id,
        location_id=payload.location_id,
        lines=payload.lines,
    )
    # لا يُرحَّل قيد استلام مستقل هنا: الاستلام والفاتورة يحدثان بنفس
    # اللحظة (بدون فجوة زمنية حقيقية)، فيُكتفى بقيد الفاتورة المباشر
    # بخطوة واحدة (مدين المخزون مباشرة / دائن المورد) بدل المرور بحساب
    # "بضاعة مستلمة غير مفوترة" الذي يُفتح ويُقفل بلا فائدة في نفس اللحظة.
    grn = _create_grn_core(grn_payload, db, post_journal=False)

    inv_payload = PurchaseInvoiceIn(
        inv_date=payload.inv_date,
        grn_number=grn.grn_number,
        supplier_inv_number=payload.supplier_inv_number,
        payment_terms_days=payload.payment_terms_days,
        cost_center_code=payload.cost_center_code,
        tax_type_code=payload.tax_type_code,
        tax_calc_method=payload.tax_calc_method,
    )
    return create_purchase_invoice(payload=inv_payload, db=db)


@pinv_router.patch("/{inv_number}", response_model=PurchaseInvoiceOut)
def update_purchase_invoice(
    inv_number: str,
    payload: PurchaseInvoiceUpdate,
    db: Session = Depends(get_db),
):
    """تعديل الحقول غير المالية لفاتورة مشتريات موجودة (تاريخ الفاتورة،
    رقم فاتورة المورد، فترة السماح، مركز التكلفة). لا يسمح هذا المسار
    بتعديل الأصناف أو الكميات أو التكلفة حفاظاً على سلامة القيود
    المحاسبية والتكلفة المتوسطة المرحّلة أصلاً على إذن الاستلام."""
    invoice = (
        db.query(PurchaseInvoice)
        .filter(PurchaseInvoice.inv_number == inv_number)
        .first()
    )
    if not invoice:
        raise HTTPException(
            status_code=404,
            detail=f"فاتورة المشتريات {inv_number} غير موجودة",
        )
    if invoice.status == "cancelled":
        raise HTTPException(status_code=400, detail="لا يمكن تعديل فاتورة ملغاة")

    if payload.cost_center_code is not None:
        if payload.cost_center_code:
            cost_center = (
                db.query(CostCenter)
                .filter(CostCenter.code == payload.cost_center_code)
                .first()
            )
            if not cost_center:
                raise HTTPException(
                    status_code=404,
                    detail=f"مركز التكلفة {payload.cost_center_code} غير موجود",
                )
        invoice.cost_center_code = payload.cost_center_code or None

    if payload.inv_date is not None:
        invoice.inv_date = payload.inv_date
        # مزامنة تاريخ القيد المحاسبي المرتبط حتى يبقى متسقاً مع تاريخ الفاتورة
        if invoice.journal_entry_id:
            entry = db.query(JournalEntry).filter(JournalEntry.id == invoice.journal_entry_id).first()
            if entry:
                entry.entry_date = payload.inv_date
    if payload.supplier_inv_number is not None:
        invoice.supplier_inv_number = payload.supplier_inv_number or None
    if payload.payment_terms_days is not None:
        invoice.payment_terms_days = payload.payment_terms_days

    db.commit()
    db.refresh(invoice)
    return invoice


@pinv_router.post("/{inv_number}/cancel", response_model=PurchaseInvoiceOut)
def cancel_purchase_invoice(
    inv_number: str,
    db: Session = Depends(get_db),
):
    """إلغاء فاتورة مشتريات (وليس حذفها نهائياً) حفاظاً على سلامة السجل
    المحاسبي والترقيم المتسلسل. تُعلَّم الفاتورة كملغاة ويعود إذن
    الاستلام المرتبط بها قابلاً للفوترة من جديد، ويُلغى القيد المحاسبي
    المرتبط بها (بدلاً من حذفه) حتى لا يبقى مؤثراً على أي رصيد."""
    invoice = (
        db.query(PurchaseInvoice)
        .filter(PurchaseInvoice.inv_number == inv_number)
        .first()
    )
    if not invoice:
        raise HTTPException(
            status_code=404,
            detail=f"فاتورة المشتريات {inv_number} غير موجودة",
        )
    if invoice.status == "cancelled":
        raise HTTPException(status_code=400, detail="الفاتورة ملغاة بالفعل")

    invoice.status = "cancelled"

    grn = (
        db.query(GoodsReceipt)
        .filter(GoodsReceipt.grn_number == invoice.grn_number)
        .first()
    )
    if grn:
        grn.invoice_status = "not_invoiced"

    if invoice.journal_entry_id:
        entry = db.query(JournalEntry).filter(JournalEntry.id == invoice.journal_entry_id).first()
        if entry and entry.status == "posted":
            entry.status = "cancelled"

    db.commit()
    db.refresh(invoice)
    return invoice


# =========================================================
# PURCHASE RETURN
# =========================================================
@prt_router.get("", response_model=list[PurchaseReturnOut])
def list_purchase_returns(db: Session = Depends(get_db)):
    return (
        db.query(PurchaseReturn)
        .order_by(
            PurchaseReturn.rt_date.desc(),
            PurchaseReturn.rt_number.desc(),
        )
        .all()
    )


@prt_router.post("", response_model=PurchaseReturnOut, status_code=201)
def create_purchase_return(
    payload: PurchaseReturnIn,
    db: Session = Depends(get_db),
):
    _validate_lines(payload.lines, "مرتجع الشراء")

    invoice = (
        db.query(PurchaseInvoice)
        .filter(PurchaseInvoice.inv_number == payload.inv_number)
        .first()
    )
    if not invoice:
        raise HTTPException(
            status_code=404,
            detail=f"فاتورة الشراء {payload.inv_number} غير موجودة",
        )

    prepared_lines = []

    for line in payload.lines:
        qty = _validate_positive(line.qty, "كمية المرتجع")

        item = (
            db.query(Item)
            .filter(
                Item.code == line.item_code,
                Item.is_active.is_(True),
            )
            .first()
        )
        if not item:
            raise HTTPException(
                status_code=404,
                detail=f"الصنف {line.item_code} غير موجود أو غير نشط",
            )

        invoice_line = (
            db.query(PurchaseInvoiceLine)
            .filter(
                PurchaseInvoiceLine.inv_number == invoice.inv_number,
                PurchaseInvoiceLine.item_id == item.id,
            )
            .first()
        )
        if not invoice_line:
            raise HTTPException(
                status_code=400,
                detail=f"الصنف {line.item_code} غير موجود في فاتورة الشراء",
            )

        previously_returned = (
            db.query(func.coalesce(func.sum(PurchaseReturnLine.qty), 0))
            .join(
                PurchaseReturn,
                PurchaseReturn.rt_number == PurchaseReturnLine.rt_number,
            )
            .filter(
                PurchaseReturn.inv_number == invoice.inv_number,
                PurchaseReturnLine.item_id == item.id,
            )
            .scalar()
        )

        invoice_qty = _to_float(invoice_line.qty)
        remaining_returnable = invoice_qty - _to_float(previously_returned)

        if qty > remaining_returnable:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"كمية مرتجع الصنف {line.item_code} أكبر من الكمية "
                    f"المتبقية القابلة للإرجاع ({remaining_returnable})"
                ),
            )

        current_qty = _to_float(item.qty)
        if qty > current_qty:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"الرصيد المتاح للصنف {line.item_code} هو "
                    f"{current_qty} فقط"
                ),
            )

        unit_cost = _to_float(invoice_line.unit_cost)
        prepared_lines.append((item, qty, unit_cost))

    try:
        purchase_return = PurchaseReturn(
            rt_number=_next_document_number(db, PurchaseReturn, "rt_number", "PRT"),
            rt_date=payload.rt_date,
            inv_number=invoice.inv_number,
            supplier_code=invoice.supplier_code,
            total=0,
        )
        db.add(purchase_return)
        db.flush()

        source_grn = db.query(GoodsReceipt).filter(GoodsReceipt.grn_number == invoice.grn_number).first()

        total = 0.0
        for item, qty, unit_cost in prepared_lines:
            new_qty = _to_float(item.qty) - qty

            db.add(
                PurchaseReturnLine(
                    rt_number=purchase_return.rt_number,
                    item_id=item.id,
                    qty=qty,
                    unit_cost=unit_cost,
                )
            )

            item.qty = new_qty
            if new_qty == 0:
                item.avg_cost = 0

            db.add(
                StockMove(
                    move_date=payload.rt_date,
                    item_id=item.id,
                    move_type="مرتجع مشتريات",
                    reference=f"PRT-{purchase_return.rt_number}",
                    warehouse_id=source_grn.warehouse_id if source_grn else None,
                    qty=-qty,
                    unit_cost=unit_cost,
                    balance_after=new_qty,
                )
            )

            if source_grn and source_grn.warehouse_id:
                _adjust_warehouse_stock(
                    db, item.id, source_grn.warehouse_id, source_grn.location_id,
                    -qty, _to_float(item.avg_cost),
                )

            total += qty * unit_cost

        purchase_return.total = total

        db.commit()
        db.refresh(purchase_return)
        return purchase_return

    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
