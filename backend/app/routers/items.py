from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import Item


router = APIRouter()


# GET ITEMS
@router.get("/items")
def get_items(db: Session = Depends(get_db)):
    return db.query(Item).all()


# CREATE ITEM
@router.post("/items")
def create_item(
    code: str,
    name: str,
    unit: str = "حبة",
    price: float = 0,
    db: Session = Depends(get_db)
):

    item = Item(
        code=code,
        name=name,
        unit=unit,
        price=price
    )

    db.add(item)
    db.commit()
    db.refresh(item)

    return item