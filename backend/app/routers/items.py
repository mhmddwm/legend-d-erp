from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.item import Item


router = APIRouter()


# GET ITEMS
@router.get("/items")
def get_items(db: Session = Depends(get_db)):
    return db.query(Item).all()


# CREATE ITEM
@router.post("/items")
def create_item(
    name: str,
    sku: str,
    unit: str,
    price: float,
    db: Session = Depends(get_db)
):

    item = Item(
        name=name,
        sku=sku,
        unit=unit,
        price=price
    )

    db.add(item)
    db.commit()
    db.refresh(item)

    return item