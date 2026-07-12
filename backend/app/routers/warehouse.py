from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.warehouse import Warehouse


router = APIRouter(
    prefix="/api/warehouses",
    tags=["Warehouses"]
)


# =========================
# GET ALL WAREHOUSES
# =========================

@router.get("")
def get_warehouses(
    db: Session = Depends(get_db)
):
    return db.query(Warehouse).all()



# =========================
# CREATE WAREHOUSE
# =========================

@router.post("")
def create_warehouse(
    code: str,
    name: str,
    location: str = None,
    manager: str = None,
    db: Session = Depends(get_db)
):

    existing = (
        db.query(Warehouse)
        .filter(Warehouse.code == code)
        .first()
    )

    if existing:
        raise HTTPException(
            status_code=400,
            detail="Warehouse code already exists"
        )


    warehouse = Warehouse(
        code=code,
        name=name,
        location=location,
        manager=manager
    )


    db.add(warehouse)
    db.commit()
    db.refresh(warehouse)

    return warehouse



# =========================
# DELETE
# =========================

@router.delete("/{id}")
def delete_warehouse(
    id: int,
    db: Session = Depends(get_db)
):

    warehouse = (
        db.query(Warehouse)
        .filter(Warehouse.id == id)
        .first()
    )

    if not warehouse:
        raise HTTPException(
            status_code=404,
            detail="Warehouse not found"
        )


    db.delete(warehouse)
    db.commit()

    return {
        "message":"Warehouse deleted"
    }