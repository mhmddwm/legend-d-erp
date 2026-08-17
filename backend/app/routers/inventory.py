from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date as date_type
from app.database import get_db
from app.models.models import Item, StockMove, Supplier, PurchaseInvoice, PurchaseReturn, Account, SupplierPayment, SupplierPaymentAllocation
from app.schemas.inventory import ItemIn, ItemUpdate, ItemOut, StockMoveOut, SupplierIn, SupplierUpdate, SupplierOut
from app.schemas.purchasing import SupplierOpenInvoiceOut

router = APIRouter(prefix="/api/items", tags=["Items"])
stock_router = APIRouter(prefix="/api/stock-moves", tags=["StockMoves"])
supplier_router = APIRouter(prefix="/api/suppliers", tags=["Suppliers"])


# ============================================================
# ITEMS
# ============================================================

@router.get("", response_model=list[ItemOut])
def list_items(db: Session = Depends(get_db)):
    return db.query(Item).filter(Item.is_active == True).all()  # noqa: E712


@router.post("", response_model=ItemOut, status_code=201)
def create_item(payload: ItemIn, db: Session = Depends(get_db)):
    if db.query(Item).filter(Item.code == payload.code).first():
        raise HTTPException(400, "كود الصنف مستخدم من قبل")

    opening_qty = float(payload.opening_qty or 0)
    default_cost = float(payload.default_cost or 0)

    item = Item(
        code=payload.code,
        name=payload.name,
        unit=payload.unit,
        default_cost=default_cost,
        price=float(payload.price or 0),
        qty=opening_qty,
        avg_cost=default_cost,
        reorder_level=float(payload.reorder_level or 0),
    )
    db.add(item)
    db.flush()  # نحتاج item.id فوراً لإنشاء حركة المخزون الافتتاحية قبل الـ commit النهائي

    if opening_qty > 0:
        move = StockMove(
            move_date=date_type.today(),
            item_id=item.id,
            move_type="افتتاحي",
            reference="رصيد افتتاحي",
            qty=opening_qty,
            unit_cost=default_cost,
            balance_after=opening_qty,
        )
        db.add(move)

    db.commit()
    db.refresh(item)
    return item


@router.put("/{code}", response_model=ItemOut)
def update_item(code: str, payload: ItemUpdate, db: Session = Depends(get_db)):
    item = db.query(Item).filter(Item.code == code).first()
    if not item:
        raise HTTPException(404, "الصنف غير موجود")

    data = payload.model_dump(exclude_unset=True)
    new_code = data.pop("code", None)

    for k, v in data.items():
        setattr(item, k, v)

    if new_code and new_code != code:
        if db.query(Item).filter(Item.code == new_code).first():
            raise HTTPException(400, "كود الصنف الجديد مستخدم من قبل")
        # حركات المخزون (StockMove) مرتبطة بالصنف عبر item_id الثابت وليس
        # بالكود، فتغيير الكود هنا يكفي ولا حاجة لتحديث أي حركات مخزون
        item.code = new_code

    db.commit()
    db.refresh(item)
    return item


@router.delete("/{code}", status_code=204)
def delete_item(code: str, db: Session = Depends(get_db)):
    item = db.query(Item).filter(Item.code == code).first()
    if not item:
        raise HTTPException(404, "الصنف غير موجود")
    if db.query(StockMove).filter(StockMove.item_id == item.id).first():
        raise HTTPException(400, "لا يمكن حذف صنف له حركات مخزون")
    db.delete(item)
    db.commit()
    return None


# ============================================================
# STOCK MOVES
# ============================================================

@stock_router.get("", response_model=list[StockMoveOut])
def list_stock_moves(item_code: str = None, db: Session = Depends(get_db)):
    q = db.query(StockMove).order_by(StockMove.move_date.desc(), StockMove.id.desc())
    if item_code:
        item = db.query(Item).filter(Item.code == item_code).first()
        if not item:
            return []
        q = q.filter(StockMove.item_id == item.id)
    return q.all()


# ============================================================
# SUPPLIERS
# ============================================================

DEFAULT_SUPPLIER_ACCOUNT = "2111"  # موردون - نشاط الشركة الأساسي


def _validate_supplier_account(db: Session, account_code: str) -> str:
    """يتأكد أن الحساب المحاسبي المختار للمورد فرع فعلي من حساب الموردين
    الرئيسي (211) — أسوة بمنطق Default Payable Account بأودو/ساب،
    ويمنع ربط المورد بأي حساب آخر بالخطأ (نقدية، مصروفات...)."""
    acc = db.query(Account).filter(Account.code == account_code).first()
    if not acc:
        raise HTTPException(400, "الحساب المحاسبي المحدد للمورد غير موجود")
    cursor, seen = acc, set()
    while cursor:
        if cursor.code == "211":
            return account_code
        if cursor.code in seen:
            break
        seen.add(cursor.code)
        cursor = db.query(Account).filter(Account.code == cursor.parent_code).first() if cursor.parent_code else None
    raise HTTPException(400, "يجب أن يكون حساب المورد فرعاً من حساب الموردين (211) بدليل الحسابات")


def calc_payable(db: Session, supplier_code: str) -> float:
    invoiced = db.query(func.coalesce(func.sum(PurchaseInvoice.total), 0)).filter(
        PurchaseInvoice.supplier_code == supplier_code,
        PurchaseInvoice.status != "cancelled",
    ).scalar()
    returned = db.query(func.coalesce(func.sum(PurchaseReturn.total), 0)).filter(
        PurchaseReturn.supplier_code == supplier_code,
        PurchaseReturn.status != "cancelled",
    ).scalar()
    paid = db.query(func.coalesce(func.sum(SupplierPayment.amount), 0)).filter(
        SupplierPayment.supplier_code == supplier_code,
        SupplierPayment.status != "cancelled",
    ).scalar()
    return float(invoiced or 0) - float(returned or 0) - float(paid or 0)


@supplier_router.get("", response_model=list[SupplierOut])
def list_suppliers(db: Session = Depends(get_db)):
    suppliers = db.query(Supplier).filter(Supplier.is_active == True).all()  # noqa: E712
    result = []
    for s in suppliers:
        out = SupplierOut(
            code=s.code, name=s.name, phone=s.phone,
            email=s.email, notes=s.notes, account_code=s.account_code,
            payable_balance=calc_payable(db, s.code)
        )
        result.append(out)
    return result


@supplier_router.post("", response_model=SupplierOut, status_code=201)
def create_supplier(payload: SupplierIn, db: Session = Depends(get_db)):
    if db.query(Supplier).filter(Supplier.code == payload.code).first():
        raise HTTPException(400, "كود المورد مستخدم من قبل")
    data = payload.model_dump()
    data["account_code"] = _validate_supplier_account(db, data.get("account_code") or DEFAULT_SUPPLIER_ACCOUNT)
    s = Supplier(**data)
    db.add(s)
    db.commit()
    db.refresh(s)
    return SupplierOut(code=s.code, name=s.name, phone=s.phone,
                       email=s.email, notes=s.notes, account_code=s.account_code, payable_balance=0)


@supplier_router.put("/{code}", response_model=SupplierOut)
def update_supplier(code: str, payload: SupplierUpdate, db: Session = Depends(get_db)):
    s = db.query(Supplier).filter(Supplier.code == code).first()
    if not s:
        raise HTTPException(404, "المورد غير موجود")

    data = payload.model_dump(exclude_unset=True)
    new_code = data.pop("code", None)
    if "account_code" in data:
        data["account_code"] = _validate_supplier_account(db, data.get("account_code") or DEFAULT_SUPPLIER_ACCOUNT)

    for k, v in data.items():
        setattr(s, k, v)

    if new_code and new_code != code:
        if db.query(Supplier).filter(Supplier.code == new_code).first():
            raise HTTPException(400, "الكود الجديد مستخدم من قبل")
        s.code = new_code

    db.commit()
    db.refresh(s)
    return SupplierOut(code=s.code, name=s.name, phone=s.phone,
                       email=s.email, notes=s.notes, account_code=s.account_code,
                       payable_balance=calc_payable(db, s.code))


@supplier_router.get("/{code}/statement")
def get_supplier_statement(code: str, db: Session = Depends(get_db)):
    """كشف حساب المورد — دفتر أستاذ مساعد (Subsidiary Ledger) مبني على
    فلترة المستندات المرتبطة بكود المورد (فواتير مشتريات مرحّلة +
    مرتجعات)، بدل إنشاء حساب مستقل بدليل الحسابات لكل مورد."""
    supplier = db.query(Supplier).filter(Supplier.code == code).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="المورد غير موجود")

    movements = []

    invoices = (
        db.query(PurchaseInvoice)
        .filter(PurchaseInvoice.supplier_code == code, PurchaseInvoice.status == "posted")
        .all()
    )
    for inv in invoices:
        desc = f"فاتورة مشتريات {inv.inv_number}"
        if inv.supplier_inv_number:
            desc += f" (فاتورة المورد: {inv.supplier_inv_number})"
        movements.append({
            "date": inv.inv_date, "doc_type": "purchase_invoice", "doc_number": inv.inv_number,
            "description": desc, "debit": 0.0, "credit": float(inv.total or 0),
            "journal_entry_id": inv.journal_entry_id,
        })

    returns = db.query(PurchaseReturn).filter(
        PurchaseReturn.supplier_code == code, PurchaseReturn.status != "cancelled"
    ).all()
    for rt in returns:
        movements.append({
            "date": rt.rt_date, "doc_type": "purchase_return", "doc_number": rt.rt_number,
            "description": f"مرتجع مشتريات {rt.rt_number} (على فاتورة {rt.inv_number})",
            "debit": float(rt.total or 0), "credit": 0.0, "journal_entry_id": None,
        })

    payments = db.query(SupplierPayment).filter(
        SupplierPayment.supplier_code == code, SupplierPayment.status != "cancelled"
    ).all()
    for pay in payments:
        allocs_desc = "، ".join(f"{a.inv_number} ({float(a.amount or 0)})" for a in pay.allocations)
        desc = f"سداد {pay.payment_number}" + (f" — {allocs_desc}" if allocs_desc else "")
        movements.append({
            "date": pay.payment_date, "doc_type": "supplier_payment", "doc_number": pay.payment_number,
            "description": desc, "debit": float(pay.amount or 0), "credit": 0.0,
            "journal_entry_id": pay.journal_entry_id,
        })

    movements.sort(key=lambda m: (m["date"], m["doc_number"]))

    running = 0.0
    entries = []
    for m in movements:
        running = round(running + m["credit"] - m["debit"], 2)
        entries.append({**m, "balance": running})

    return {
        "supplier_code": supplier.code, "supplier_name": supplier.name,
        "account_code": supplier.account_code, "opening_balance": 0.0,
        "closing_balance": running, "entries": entries,
    }


@supplier_router.get("/{code}/open-invoices", response_model=list[SupplierOpenInvoiceOut])
def get_supplier_open_invoices(code: str, db: Session = Depends(get_db)):
    """فواتير المورد المرحّلة التي لسه عليها رصيد متبقٍ فعلياً (بعد
    خصم المرتجعات والمدفوعات السابقة) — تُستخدم لتعبئة نموذج تسجيل
    سداد جديد بحيث لا يُسمح بتخصيص مبلغ أكبر من المتبقي الحقيقي."""
    supplier = db.query(Supplier).filter(Supplier.code == code).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="المورد غير موجود")

    invoices = (
        db.query(PurchaseInvoice)
        .filter(PurchaseInvoice.supplier_code == code, PurchaseInvoice.status == "posted")
        .order_by(PurchaseInvoice.inv_date.asc())
        .all()
    )

    result = []
    for inv in invoices:
        returned = db.query(func.coalesce(func.sum(PurchaseReturn.total), 0)).filter(
            PurchaseReturn.inv_number == inv.inv_number, PurchaseReturn.status != "cancelled",
        ).scalar()
        paid = (
            db.query(func.coalesce(func.sum(SupplierPaymentAllocation.amount), 0))
            .join(SupplierPayment, SupplierPayment.payment_number == SupplierPaymentAllocation.payment_number)
            .filter(SupplierPaymentAllocation.inv_number == inv.inv_number, SupplierPayment.status != "cancelled")
            .scalar()
        )
        outstanding = round(float(inv.total or 0) - float(returned or 0) - float(paid or 0), 2)
        if outstanding <= 0.01:
            continue
        result.append(SupplierOpenInvoiceOut(
            inv_number=inv.inv_number, inv_date=inv.inv_date, due_date=inv.due_date,
            total=float(inv.total or 0), returned=float(returned or 0), paid=float(paid or 0),
            outstanding=outstanding,
        ))
    return result


@supplier_router.delete("/{code}", status_code=204)
def delete_supplier(code: str, db: Session = Depends(get_db)):
    from app.models.models import PurchaseOrder, GoodsReceipt
    s = db.query(Supplier).filter(Supplier.code == code).first()
    if not s:
        raise HTTPException(404, "المورد غير موجود")
    if db.query(PurchaseOrder).filter(PurchaseOrder.supplier_code == code).first():
        raise HTTPException(400, "لا يمكن حذف مورد له طلبات شراء")
    if db.query(GoodsReceipt).filter(GoodsReceipt.supplier_code == code).first():
        raise HTTPException(400, "لا يمكن حذف مورد له عمليات استلام")
    db.delete(s)
    db.commit()
    return None
