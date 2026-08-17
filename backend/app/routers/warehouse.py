from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.warehouse import Warehouse
from app.models.location import WarehouseLocation
from app.models.warehouse_stock import WarehouseStock
from app.models.models import Item
from app.schemas.warehouse import (
    WarehouseIn,
    WarehouseUpdate,
    WarehouseOut,
    WarehouseStockOut,
)


router = APIRouter(
    prefix="/api/warehouses",
    tags=["Warehouses"]
)

# راوتر مستقل لتقرير رصيد المخزون حسب المستودع، على المسار المُستخدَم
# أصلاً بالفرونت إند (renderWarehouseStockBalances) بدل تحت /api/warehouses
stock_router = APIRouter(
    prefix="/api/warehouse-stock",
    tags=["WarehouseStock"]
)


# =========================
# GET ALL WAREHOUSES
# =========================

@router.get("", response_model=list[WarehouseOut])
def get_warehouses(db: Session = Depends(get_db)):
    return db.query(Warehouse).order_by(Warehouse.code.asc()).all()


# =========================
# CREATE WAREHOUSE
# =========================

@router.post("", response_model=WarehouseOut, status_code=201)
def create_warehouse(payload: WarehouseIn, db: Session = Depends(get_db)):
    existing = (
        db.query(Warehouse)
        .filter(Warehouse.code == payload.code)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="كود المستودع مستخدم من قبل")

    warehouse = Warehouse(
        code=payload.code,
        name=payload.name,
        location=payload.location,
        manager=payload.manager,
    )
    db.add(warehouse)
    db.commit()
    db.refresh(warehouse)

    # موقع عام افتراضي لكل مستودع جديد، حتى يصلح للاستلام مباشرة دون
    # إجبار المستخدم على تعريف مواقع فرعية (رفوف/أرفف) قبل أول عملية شراء
    db.add(WarehouseLocation(warehouse_id=warehouse.id, code="GENERAL", name="موقع عام"))
    db.commit()

    return warehouse


# =========================
# UPDATE WAREHOUSE
# =========================

@router.put("/{warehouse_id}", response_model=WarehouseOut)
def update_warehouse(warehouse_id: int, payload: WarehouseUpdate, db: Session = Depends(get_db)):
    warehouse = db.query(Warehouse).filter(Warehouse.id == warehouse_id).first()
    if not warehouse:
        raise HTTPException(status_code=404, detail="المستودع غير موجود")

    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(warehouse, key, value)

    db.commit()
    db.refresh(warehouse)
    return warehouse


# =========================
# DELETE
# =========================

@router.delete("/{warehouse_id}", status_code=204)
def delete_warehouse(warehouse_id: int, db: Session = Depends(get_db)):
    warehouse = db.query(Warehouse).filter(Warehouse.id == warehouse_id).first()
    if not warehouse:
        raise HTTPException(status_code=404, detail="المستودع غير موجود")

    has_stock = (
        db.query(WarehouseStock)
        .filter(WarehouseStock.warehouse_id == warehouse_id, WarehouseStock.quantity != 0)
        .first()
    )
    if has_stock:
        raise HTTPException(
            status_code=400,
            detail="لا يمكن حذف مستودع به رصيد مخزون قائم — قم بتحويل أو تصفير الرصيد أولاً",
        )

    db.delete(warehouse)
    db.commit()
    return None


# =========================
# رصيد المخزون حسب المستودع (لكل الأصناف، أو مُصفّى بصنف/مستودع)
# =========================

@stock_router.get("", response_model=list[WarehouseStockOut])
def get_warehouse_stock(
    item_id: int | None = None,
    warehouse_id: int | None = None,
    db: Session = Depends(get_db),
):
    query = (
        db.query(WarehouseStock, Item, Warehouse, WarehouseLocation)
        .join(Item, Item.id == WarehouseStock.item_id)
        .join(Warehouse, Warehouse.id == WarehouseStock.warehouse_id)
        .outerjoin(WarehouseLocation, WarehouseLocation.id == WarehouseStock.location_id)
        .filter(WarehouseStock.quantity != 0)
    )
    if item_id is not None:
        query = query.filter(WarehouseStock.item_id == item_id)
    if warehouse_id is not None:
        query = query.filter(WarehouseStock.warehouse_id == warehouse_id)

    rows = query.order_by(Item.code.asc(), Warehouse.code.asc()).all()
    return [
        WarehouseStockOut(
            item_id=item.id, item_code=item.code, item_name=item.name,
            warehouse_id=wh.id, warehouse_code=wh.code, warehouse_name=wh.name,
            location_id=loc.id if loc else None, location_name=loc.name if loc else None,
            quantity=float(ws.quantity or 0), avg_cost=float(ws.avg_cost or 0),
        )
        for ws, item, wh, loc in rows
    ]
