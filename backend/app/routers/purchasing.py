from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.models import (
    Item, StockMove, Supplier, PurchaseOrder, PurchaseOrderLine,
    GoodsReceipt, GoodsReceiptLine, PurchaseInvoice, PurchaseInvoiceLine,
    PurchaseReturn, PurchaseReturnLine, JournalEntry, Account
)
from app.schemas.purchasing import (
    PurchaseOrderIn, PurchaseOrderOut,
    GoodsReceiptIn, GoodsReceiptOut,
    PurchaseInvoiceIn, PurchaseInvoiceOut,
    PurchaseReturnIn, PurchaseReturnOut,
)
from app.services import next_sequence

ACC_INVENTORY = "123"
ACC_PAYABLE = "211"

po_router = APIRouter(prefix="/api/purchase-orders", tags=["PurchaseOrders"])
grn_router = APIRouter(prefix="/api/goods-receipts", tags=["GoodsReceipts"])
pinv_router = APIRouter(prefix="/api/purchase-invoices", tags=["PurchaseInvoices"])
prt_router = APIRouter(prefix="/api/purchase-returns", tags=["PurchaseReturns"])


# ============================================================
# HELPERS
# ============================================================

def _post_auto_entry(db: Session, entry_date, debit: str, credit: str,
                     amount: float, description: str, source_type: str, source_ref: str):
    for code in (debit, credit):
        if not db.query(Account).filter(Account.code == code).first():
            raise HTTPException(500, f"حساب مفقود في دليل الحسابات: {code}. تأكد من وجود حساب {code}")
    entry = JournalEntry(
        entry_date=entry_date,
        debit_account=debit,
        credit_account=credit,
        amount=amount,
        description=description,
        source_type=source_type,
        source_ref=source_ref,
    )
    db.add(entry)


def _update_item_wac(item: Item, incoming_qty: float, incoming_cost: float):
    """تحديث متوسط التكلفة المرجّح (Weighted Average Cost) للصنف."""
    old_qty = float(item.qty)
    old_cost = float(item.avg_cost)
    new_qty = old_qty + incoming_qty
    if new_qty > 0:
        item.avg_cost = ((old_qty * old_cost) + (incoming_qty * incoming_cost)) / new_qty
    item.qty = new_qty


def _update_po_status(db: Session, po_number: str):
    po = db.query(PurchaseOrder).filter(PurchaseOrder.po_number == po_number).first()
    if not po:
        return
    po_lines = db.query(PurchaseOrderLine).filter(PurchaseOrderLine.po_number == po_number).all()
    grns = db.query(GoodsReceipt).filter(GoodsReceipt.po_number == po_number).all()

    received_map = {}
    for g in grns:
        for l in g.lines:
            received_map[l.item_code] = received_map.get(l.item_code, 0) + float(l.qty)

    fully = all(received_map.get(l.item_code, 0) >= float(l.qty) for l in po_lines)
    any_rcv = any(received_map.get(l.item_code, 0) > 0 for l in po_lines)
    po.status = "received" if fully else ("partial" if any_rcv else "draft")


# ============================================================
# PURCHASE ORDERS
# ============================================================

@po_router.get("", response_model=list[PurchaseOrderOut])
def list_pos(db: Session = Depends(get_db)):
    pos = db.query(PurchaseOrder).order_by(PurchaseOrder.po_date.desc()).all()
    result = []
    for po in pos:
        lines = db.query(PurchaseOrderLine).filter(PurchaseOrderLine.po_number == po.po_number).all()
        result.append(PurchaseOrderOut(
            po_number=po.po_number, po_date=po.po_date,
            supplier_code=po.supplier_code, status=po.status,
            total=float(po.total), lines=lines
        ))
    return result


@po_router.post("", response_model=PurchaseOrderOut, status_code=201)
def create_po(payload: PurchaseOrderIn, db: Session = Depends(get_db)):
    if not db.query(Supplier).filter(Supplier.code == payload.supplier_code).first():
        raise HTTPException(400, "المورد غير موجود")
    if not payload.lines:
        raise HTTPException(400, "يجب إضافة صنف واحد على الأقل")

    po_number = next_sequence(db, PurchaseOrder, "po_number", "PO")
    total = sum(float(l.qty) * float(l.unit_price) for l in payload.lines)

    po = PurchaseOrder(
        po_number=po_number, po_date=payload.po_date,
        supplier_code=payload.supplier_code, total=total
    )
    db.add(po)

    for l in payload.lines:
        if not db.query(Item).filter(Item.code == l.item_code).first():
            raise HTTPException(400, f"الصنف {l.item_code} غير موجود")
        db.add(PurchaseOrderLine(
            po_number=po_number, item_code=l.item_code,
            qty=l.qty, unit_price=l.unit_price
        ))

    db.commit()
    lines = db.query(PurchaseOrderLine).filter(PurchaseOrderLine.po_number == po_number).all()
    return PurchaseOrderOut(
        po_number=po.po_number, po_date=po.po_date,
        supplier_code=po.supplier_code, status=po.status,
        total=float(po.total), lines=lines
    )


# ============================================================
# GOODS RECEIPTS
# ============================================================

@grn_router.get("", response_model=list[GoodsReceiptOut])
def list_grns(db: Session = Depends(get_db)):
    grns = db.query(GoodsReceipt).order_by(GoodsReceipt.grn_date.desc()).all()
    result = []
    for g in grns:
        lines = db.query(GoodsReceiptLine).filter(GoodsReceiptLine.grn_number == g.grn_number).all()
        result.append(GoodsReceiptOut(
            grn_number=g.grn_number, grn_date=g.grn_date,
            supplier_code=g.supplier_code, po_number=g.po_number,
            reference=g.reference, total=float(g.total),
            invoice_status=g.invoice_status, lines=lines
        ))
    return result


@grn_router.post("", response_model=GoodsReceiptOut, status_code=201)
def create_grn(payload: GoodsReceiptIn, db: Session = Depends(get_db)):
    if not db.query(Supplier).filter(Supplier.code == payload.supplier_code).first():
        raise HTTPException(400, "المورد غير موجود")
    if not payload.lines:
        raise HTTPException(400, "يجب إضافة صنف واحد على الأقل")

    grn_number = next_sequence(db, GoodsReceipt, "grn_number", "GRN")
    total = sum(float(l.qty) * float(l.unit_cost) for l in payload.lines)

    grn = GoodsReceipt(
        grn_number=grn_number, grn_date=payload.grn_date,
        supplier_code=payload.supplier_code, po_number=payload.po_number,
        reference=payload.reference, total=total
    )
    db.add(grn)

    for l in payload.lines:
        item = db.query(Item).filter(Item.code == l.item_code).first()
        if not item:
            raise HTTPException(400, f"الصنف {l.item_code} غير موجود")

        # تحديث المخزون ومتوسط التكلفة
        _update_item_wac(item, float(l.qty), float(l.unit_cost))

        db.add(StockMove(
            move_date=payload.grn_date,
            item_code=l.item_code,
            move_type="استلام",
            reference=f"استلام بضاعة {grn_number}" + (f" — {payload.po_number}" if payload.po_number else ""),
            qty=float(l.qty),
            unit_cost=float(l.unit_cost),
            balance_after=float(item.qty),
        ))

        db.add(GoodsReceiptLine(
            grn_number=grn_number, item_code=l.item_code,
            qty=l.qty, unit_cost=l.unit_cost
        ))

    # تحديث حالة طلب الشراء إن وُجد
    db.flush()  # نحتاج flush لتسجيل grn قبل حساب الحالة
    if payload.po_number:
        _update_po_status(db, payload.po_number)

    db.commit()
    lines = db.query(GoodsReceiptLine).filter(GoodsReceiptLine.grn_number == grn_number).all()
    return GoodsReceiptOut(
        grn_number=grn.grn_number, grn_date=grn.grn_date,
        supplier_code=grn.supplier_code, po_number=grn.po_number,
        reference=grn.reference, total=float(grn.total),
        invoice_status=grn.invoice_status, lines=lines
    )


# ============================================================
# PURCHASE INVOICES
# ============================================================

@pinv_router.get("", response_model=list[PurchaseInvoiceOut])
def list_invoices(db: Session = Depends(get_db)):
    invs = db.query(PurchaseInvoice).order_by(PurchaseInvoice.inv_date.desc()).all()
    result = []
    for inv in invs:
        lines = db.query(PurchaseInvoiceLine).filter(PurchaseInvoiceLine.inv_number == inv.inv_number).all()
        result.append(PurchaseInvoiceOut(
            inv_number=inv.inv_number, inv_date=inv.inv_date,
            supplier_code=inv.supplier_code, grn_number=inv.grn_number,
            supplier_inv_number=inv.supplier_inv_number,
            total=float(inv.total), status=inv.status, lines=lines
        ))
    return result


@pinv_router.post("", response_model=PurchaseInvoiceOut, status_code=201)
def create_invoice(payload: PurchaseInvoiceIn, db: Session = Depends(get_db)):
    grn = db.query(GoodsReceipt).filter(GoodsReceipt.grn_number == payload.grn_number).first()
    if not grn:
        raise HTTPException(400, "عملية الاستلام غير موجودة")
    if grn.invoice_status == "invoiced":
        raise HTTPException(400, "تم فوترة هذا الاستلام مسبقًا")

    grn_lines = db.query(GoodsReceiptLine).filter(GoodsReceiptLine.grn_number == payload.grn_number).all()
    total = sum(float(l.qty) * float(l.unit_cost) for l in grn_lines)

    inv_number = next_sequence(db, PurchaseInvoice, "inv_number", "PINV")
    inv = PurchaseInvoice(
        inv_number=inv_number, inv_date=payload.inv_date,
        supplier_code=grn.supplier_code, grn_number=payload.grn_number,
        supplier_inv_number=payload.supplier_inv_number, total=total
    )
    db.add(inv)

    for l in grn_lines:
        db.add(PurchaseInvoiceLine(
            inv_number=inv_number, item_code=l.item_code,
            qty=l.qty, unit_cost=l.unit_cost
        ))

    # تحديث حالة الاستلام
    grn.invoice_status = "invoiced"

    # قيد محاسبي تلقائي: مدين المخزون / دائن الموردون
    supplier = db.query(Supplier).filter(Supplier.code == grn.supplier_code).first()
    sup_name = supplier.name if supplier else ""
    _post_auto_entry(
        db, payload.inv_date,
        ACC_INVENTORY, ACC_PAYABLE, total,
        f"فاتورة مشتريات {inv_number} — {sup_name}" +
        (f" (فاتورة المورد: {payload.supplier_inv_number})" if payload.supplier_inv_number else ""),
        "purchase_invoice", inv_number
    )

    db.commit()
    lines = db.query(PurchaseInvoiceLine).filter(PurchaseInvoiceLine.inv_number == inv_number).all()
    return PurchaseInvoiceOut(
        inv_number=inv.inv_number, inv_date=inv.inv_date,
        supplier_code=inv.supplier_code, grn_number=inv.grn_number,
        supplier_inv_number=inv.supplier_inv_number,
        total=float(inv.total), status=inv.status, lines=lines
    )


# ============================================================
# PURCHASE RETURNS
# ============================================================

@prt_router.get("", response_model=list[PurchaseReturnOut])
def list_returns(db: Session = Depends(get_db)):
    returns = db.query(PurchaseReturn).order_by(PurchaseReturn.rt_date.desc()).all()
    result = []
    for rt in returns:
        lines = db.query(PurchaseReturnLine).filter(PurchaseReturnLine.rt_number == rt.rt_number).all()
        result.append(PurchaseReturnOut(
            rt_number=rt.rt_number, rt_date=rt.rt_date,
            supplier_code=rt.supplier_code, inv_number=rt.inv_number,
            total=float(rt.total), lines=lines
        ))
    return result


@prt_router.post("", response_model=PurchaseReturnOut, status_code=201)
def create_return(payload: PurchaseReturnIn, db: Session = Depends(get_db)):
    inv = db.query(PurchaseInvoice).filter(PurchaseInvoice.inv_number == payload.inv_number).first()
    if not inv:
        raise HTTPException(400, "فاتورة المشتريات غير موجودة")

    # بناء خريطة تكلفة الوحدة من سطور الفاتورة
    inv_lines = db.query(PurchaseInvoiceLine).filter(
        PurchaseInvoiceLine.inv_number == payload.inv_number
    ).all()
    cost_map = {l.item_code: float(l.unit_cost) for l in inv_lines}

    # التحقق من عدم تجاوز الكميات المُرجَعة سابقاً
    prev_returns = db.query(PurchaseReturn).filter(PurchaseReturn.inv_number == payload.inv_number).all()
    prev_qty_map = {}
    for pr in prev_returns:
        for l in db.query(PurchaseReturnLine).filter(PurchaseReturnLine.rt_number == pr.rt_number).all():
            prev_qty_map[l.item_code] = prev_qty_map.get(l.item_code, 0) + float(l.qty)

    orig_qty_map = {l.item_code: float(l.qty) for l in inv_lines}

    valid_lines = []
    for l in payload.lines:
        if l.item_code not in cost_map:
            raise HTTPException(400, f"الصنف {l.item_code} ليس في الفاتورة الأصلية")
        available = orig_qty_map.get(l.item_code, 0) - prev_qty_map.get(l.item_code, 0)
        if float(l.qty) > available:
            raise HTTPException(400, f"كمية المرتجع ({l.qty}) تتجاوز الكمية المتاحة ({available}) للصنف {l.item_code}")
        valid_lines.append(l)

    if not valid_lines:
        raise HTTPException(400, "لا توجد كميات صالحة للإرجاع")

    rt_number = next_sequence(db, PurchaseReturn, "rt_number", "PRT")
    total = sum(float(l.qty) * cost_map[l.item_code] for l in valid_lines)

    rt = PurchaseReturn(
        rt_number=rt_number, rt_date=payload.rt_date,
        supplier_code=inv.supplier_code, inv_number=payload.inv_number, total=total
    )
    db.add(rt)

    for l in valid_lines:
        unit_cost = cost_map[l.item_code]
        item = db.query(Item).filter(Item.code == l.item_code).first()
        if not item:
            raise HTTPException(400, f"الصنف {l.item_code} غير موجود")

        item.qty = float(item.qty) - float(l.qty)

        db.add(StockMove(
            move_date=payload.rt_date,
            item_code=l.item_code,
            move_type="مرتجع مشتريات",
            reference=f"مرتجع على فاتورة {payload.inv_number}",
            qty=-float(l.qty),
            unit_cost=unit_cost,
            balance_after=float(item.qty),
        ))

        db.add(PurchaseReturnLine(
            rt_number=rt_number, item_code=l.item_code,
            qty=l.qty, unit_cost=unit_cost
        ))

    # قيد عكسي: مدين الموردون / دائن المخزون
    supplier = db.query(Supplier).filter(Supplier.code == inv.supplier_code).first()
    sup_name = supplier.name if supplier else ""
    _post_auto_entry(
        db, payload.rt_date,
        ACC_PAYABLE, ACC_INVENTORY, total,
        f"مرتجع مشتريات {rt_number} على فاتورة {payload.inv_number} — {sup_name}",
        "purchase_return", rt_number
    )

    db.commit()
    lines = db.query(PurchaseReturnLine).filter(PurchaseReturnLine.rt_number == rt_number).all()
    return PurchaseReturnOut(
        rt_number=rt.rt_number, rt_date=rt.rt_date,
        supplier_code=rt.supplier_code, inv_number=rt.inv_number,
        total=float(rt.total), lines=lines
    )
