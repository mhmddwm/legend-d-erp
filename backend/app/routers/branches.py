from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.models import Branch
from pydantic import BaseModel
from typing import List

router = APIRouter(prefix="/api/branches", tags=["Branches"])

class BranchIn(BaseModel):
    code: str
    name_ar: str
    name_en: str = None
    is_active: bool = True

class BranchOut(BranchIn):
    id: int

    class Config:
        from_attributes = True

@router.get("", response_model=List[BranchOut])
def list_branches(db: Session = Depends(get_db)):
    return db.query(Branch).filter(Branch.is_active == True).all()

@router.post("", response_model=BranchOut, status_code=201)
def create_branch(payload: BranchIn, db: Session = Depends(get_db)):
    if db.query(Branch).filter(Branch.code == payload.code).first():
        raise HTTPException(400, "كود الفرع مستخدم من قبل")
    
    new_branch = Branch(**payload.model_dump())
    db.add(new_branch)
    db.commit()
    db.refresh(new_branch)
    return new_branch