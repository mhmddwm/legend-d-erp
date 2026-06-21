from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date as date_type
from app.database import get_db
from app.models.models import Item, StockMove, Supplier, PurchaseInvoice, PurchaseReturn
from app.schemas.inventory import ItemIn, ItemUpdate, ItemOut, StockMoveOut, SupplierIn, SupplierUpdate, SupplierOut

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

    if opening_qty > 0:
        move = StockMove(
            move_date=date_type.today(),
            item_code=payload.code,
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
        db.query(StockMove).filter(StockMove.item_code == code).update({"item_code": new_code})
        item.code = new_code

    db.commit()
    db.refresh(item)
    return item


@router.delete("/{code}", status_code=204)
def delete_item(code: str, db: Session = Depends(get_db)):
    item = db.query(Item).filter(Item.code == code).first()
    if not item:
        raise HTTPException(404, "الصنف غير موجود")
    if db.query(StockMove).filter(StockMove.item_code == code).first():
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
        q = q.filter(StockMove.item_code == item_code)
    return q.all()


# ============================================================
# SUPPLIERS
# ============================================================

def calc_payable(db: Session, supplier_code: str) -> float:
    invoiced = db.query(func.coalesce(func.sum(PurchaseInvoice.total), 0)).filter(
        PurchaseInvoice.supplier_code == supplier_code
    ).scalar()
    returned = db.query(func.coalesce(func.sum(PurchaseReturn.total), 0)).filter(
        PurchaseReturn.supplier_code == supplier_code
    ).scalar()
    return float(invoiced or 0) - float(returned or 0)


@supplier_router.get("", response_model=list[SupplierOut])
def list_suppliers(db: Session = Depends(get_db)):
    suppliers = db.query(Supplier).filter(Supplier.is_active == True).all()  # noqa: E712
    result = []
    for s in suppliers:
        out = SupplierOut(
            code=s.code, name=s.name, phone=s.phone,
            email=s.email, notes=s.notes,
            payable_balance=calc_payable(db, s.code)
        )
        result.append(out)
    return result


@supplier_router.post("", response_model=SupplierOut, status_code=201)
def create_supplier(payload: SupplierIn, db: Session = Depends(get_db)):
    if db.query(Supplier).filter(Supplier.code == payload.code).first():
        raise HTTPException(400, "كود المورد مستخدم من قبل")
    s = Supplier(**payload.model_dump())
    db.add(s)
    db.commit()
    db.refresh(s)
    return SupplierOut(code=s.code, name=s.name, phone=s.phone,
                       email=s.email, notes=s.notes, payable_balance=0)


@supplier_router.put("/{code}", response_model=SupplierOut)
def update_supplier(code: str, payload: SupplierUpdate, db: Session = Depends(get_db)):
    s = db.query(Supplier).filter(Supplier.code == code).first()
    if not s:
        raise HTTPException(404, "المورد غير موجود")

    data = payload.model_dump(exclude_unset=True)
    new_code = data.pop("code", None)

    for k, v in data.items():
        setattr(s, k, v)

    if new_code and new_code != code:
        if db.query(Supplier).filter(Supplier.code == new_code).first():
            raise HTTPException(400, "الكود الجديد مستخدم من قبل")
        s.code = new_code

    db.commit()
    db.refresh(s)
    return SupplierOut(code=s.code, name=s.name, phone=s.phone,
                       email=s.email, notes=s.notes,
                       payable_balance=calc_payable(db, s.code))


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
