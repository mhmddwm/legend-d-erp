from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User

router = APIRouter()

# GET USERS
@router.get("/users")
def get_users(db: Session = Depends(get_db)):
    return db.query(User).all()

# CREATE USER
@router.post("/users")
def create_user(full_name: str, email: str, db: Session = Depends(get_db)):
    user = User(full_name=full_name, email=email)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
