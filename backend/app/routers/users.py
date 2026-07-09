from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User


router = APIRouter(
    prefix="/users",
    tags=["Users"]
)


# =========================
# GET ALL USERS
# =========================
@router.get("")
def get_users(db: Session = Depends(get_db)):
    return db.query(User).all()


# =========================
# CREATE USER
# =========================
@router.post("")
def create_user(
    full_name: str,
    email: str,
    password_hash: str,
    role: str = "user",
    db: Session = Depends(get_db)
):

    # Check existing email
    existing_user = (
        db.query(User)
        .filter(User.email == email)
        .first()
    )

    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="Email already exists"
        )

    user = User(
        full_name=full_name,
        email=email,
        password_hash=password_hash,
        role=role
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return user
