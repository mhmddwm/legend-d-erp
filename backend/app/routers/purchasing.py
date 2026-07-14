from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import (
    GoodsReceipt,
    GoodsReceiptLine,
    Item,
    PurchaseInvoice,
    PurchaseInvoiceLine,
    PurchaseOrder,
    PurchaseOrderLine,
    PurchaseReturn,
    PurchaseReturnLine,
    StockMove,
    Supplier,
)
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
    GoodsReceiptIn,
    GoodsReceiptOut,
    PurchaseInvoiceIn,
    PurchaseInvoiceOut,
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
    checks = (
        db.query(StockMove.id).filter(StockMove.item_code == item_code).first(),
        db.query(PurchaseOrderLine)
        .filter(PurchaseOrderLine.item_code == item_code)
        .first(),
        db.query(GoodsReceiptLine)
        .filter(GoodsReceiptLine.item_code == item_code)
        .first(),
        db.query(PurchaseInvoiceLine)
        .filter(PurchaseInvoiceLine.item_code == item_code)
        .first(),
        db.query(PurchaseReturnLine)
        .filter(PurchaseReturnLine.item_code == item_code)
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

        if opening_qty > 0:
            db.add(
                StockMove(
                    move_date=date.today(),
                    item_code=code,
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
        query = query.filter(StockMove.item_code == item_code)

    return query.all()


# =========================================================
# SUPPLIERS
# =========================================================
@supplier_router.get("", response_model=list[SupplierOut])
def list_suppliers(db: Session = Depends(get_db)):
    suppliers = (
        db.query(Supplier)
        .filter(Supplier.is_active.is_(True))
        .order_by(Supplier.code.asc())
        .all()
    )

    return [
        SupplierOut(
            code=supplier.code,
            name=supplier.name,
            phone=supplier.phone,
            email=supplier.email,
            notes=supplier.notes,
            payable_balance=calc_payable(db, supplier.code),
        )
        for supplier in suppliers
    ]


@supplier_router.post("", response_model=SupplierOut, status_code=201)
def create_supplier(
    payload: SupplierIn,
    db: Session = Depends(get_db),
):
    code = payload.code.strip()

    if not code:
        raise HTTPException(status_code=400, detail="كود المورد مطلوب")

    if db.query(Supplier).filter(Supplier.code == code).first():
        raise HTTPException(status_code=400, detail="كود المورد مستخدم من قبل")

    try:
        data = payload.model_dump()
        data["code"] = code

        supplier = Supplier(**data)
        db.add(supplier)
        db.commit()
        db.refresh(supplier)

        return SupplierOut(
            code=supplier.code,
            name=supplier.name,
            phone=supplier.phone,
            email=supplier.email,
            notes=supplier.notes,
            payable_balance=0,
        )

    except Exception:
        db.rollback()
        raise


@supplier_router.put("/{code}", response_model=SupplierOut)
def update_supplier(
    code: str,
    payload: SupplierUpdate,
    db: Session = Depends(get_db),
):
    supplier = db.query(Supplier).filter(Supplier.code == code).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="المورد غير موجود")

    data = payload.model_dump(exclude_unset=True)
    new_code = data.pop("code", None)

    if new_code:
        new_code = new_code.strip()
        if not new_code:
            raise HTTPException(status_code=400, detail="كود المورد مطلوب")

    if new_code and new_code != code:
        if db.query(Supplier).filter(Supplier.code == new_code).first():
            raise HTTPException(
                status_code=400,
                detail="الكود الجديد مستخدم من قبل",
            )

        if _supplier_has_transactions(db, code):
            raise HTTPException(
                status_code=400,
                detail="لا يمكن تغيير كود مورد مرتبط بمستندات شراء",
            )

    try:
        for key, value in data.items():
            setattr(supplier, key, value)

        if new_code and new_code != code:
            supplier.code = new_code

        db.commit()
        db.refresh(supplier)

        return SupplierOut(
            code=supplier.code,
            name=supplier.name,
            phone=supplier.phone,
            email=supplier.email,
            notes=supplier.notes,
            payable_balance=calc_payable(db, supplier.code),
        )

    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


@supplier_router.delete("/{code}", status_code=204)
def delete_supplier(code: str, db: Session = Depends(get_db)):
    supplier = db.query(Supplier).filter(Supplier.code == code).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="المورد غير موجود")

    if _supplier_has_transactions(db, code):
        raise HTTPException(
            status_code=400,
            detail="لا يمكن حذف مورد مرتبط بمستندات شراء",
        )

    try:
        db.delete(supplier)
        db.commit()
        return None
    except Exception:
        db.rollback()
        raise


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
        prepared_lines.append((item.code, qty, unit_price))

    try:
        purchase_order = PurchaseOrder(
            po_date=payload.po_date,
            supplier_code=payload.supplier_code,
            status="draft",
            total=0,
        )
        db.add(purchase_order)
        db.flush()

        total = 0.0
        for item_code, qty, unit_price in prepared_lines:
            db.add(
                PurchaseOrderLine(
                    po_number=purchase_order.po_number,
                    item_code=item_code,
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
                    PurchaseOrderLine.item_code == item.code,
                )
                .first()
            )
            if not po_line:
                raise HTTPException(
                    status_code=400,
                    detail=f"الصنف {item.code} غير موجود في طلب الشراء",
                )

        prepared_lines.append((item, qty, unit_cost))

    try:
        grn = GoodsReceipt(
            grn_date=payload.grn_date,
            supplier_code=payload.supplier_code,
            po_number=payload.po_number,
            reference=payload.reference,
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
                    item_code=item.code,
                    qty=qty,
                    unit_cost=unit_cost,
                )
            )

            item.qty = new_qty
            item.avg_cost = new_avg_cost

            db.add(
                StockMove(
                    move_date=payload.grn_date,
                    item_code=item.code,
                    move_type="استلام مشتريات",
                    reference=f"GRN-{grn.grn_number}",
                    qty=qty,
                    unit_cost=unit_cost,
                    balance_after=new_qty,
                )
            )

            total += qty * unit_cost

        grn.total = total

        if purchase_order:
            purchase_order.status = "received"

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

    try:
        invoice = PurchaseInvoice(
            inv_date=payload.inv_date,
            grn_number=grn.grn_number,
            supplier_code=grn.supplier_code,
            supplier_inv_number=payload.supplier_inv_number,
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
                    item_code=line.item_code,
                    qty=qty,
                    unit_cost=unit_cost,
                )
            )
            total += qty * unit_cost

        invoice.total = total
        grn.invoice_status = "invoiced"

        db.commit()
        db.refresh(invoice)
        return invoice

    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise


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

        invoice_line = (
            db.query(PurchaseInvoiceLine)
            .filter(
                PurchaseInvoiceLine.inv_number == invoice.inv_number,
                PurchaseInvoiceLine.item_code == line.item_code,
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
                PurchaseReturnLine.item_code == line.item_code,
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
            rt_date=payload.rt_date,
            inv_number=invoice.inv_number,
            supplier_code=invoice.supplier_code,
            total=0,
        )
        db.add(purchase_return)
        db.flush()

        total = 0.0
        for item, qty, unit_cost in prepared_lines:
            new_qty = _to_float(item.qty) - qty

            db.add(
                PurchaseReturnLine(
                    rt_number=purchase_return.rt_number,
                    item_code=item.code,
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
                    item_code=item.code,
                    move_type="مرتجع مشتريات",
                    reference=f"PRT-{purchase_return.rt_number}",
                    qty=-qty,
                    unit_cost=unit_cost,
                    balance_after=new_qty,
                )
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
