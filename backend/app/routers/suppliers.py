from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import Supplier


router = APIRouter()


# GET ALL SUPPLIERS
@router.get("/suppliers")
def get_suppliers(db: Session = Depends(get_db)):
    return db.query(Supplier).all()


# CREATE SUPPLIER
@router.post("/suppliers")
def create_supplier(
    name: str,
    code: str,
    phone: str,
    email: str,
    db: Session = Depends(get_db)
):

    supplier = Supplier(
        name=name,
        code=code,
        phone=phone,
        email=email
    )

    db.add(supplier)
    db.commit()
    db.refresh(supplier)

    return supplier