from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.database import get_db
from app.models.models import Account, JournalEntry
from app.schemas.accounting import AccountIn, AccountUpdate, AccountOut, JournalEntryIn, JournalEntryOut
from app.services import account_rollup_balance

router = APIRouter(prefix="/api/accounts", tags=["Accounts"])
journal_router = APIRouter(prefix="/api/journal", tags=["Journal"])

@router.get("", response_model=list[AccountOut])
def list_accounts(db: Session = Depends(get_db)):
    accounts = db.query(Account).filter(Account.is_active == True).all()
    result = []
    for acc in accounts:
        result.append(AccountOut(
            code=acc.code, 
            name_ar=acc.name_ar, 
            name_en=acc.name_en,
            account_type=acc.account_type, 
            nature=acc.nature, 
            parent_code=acc.parent_code,
            opening_balance=float(acc.opening_balance),
            balance=account_rollup_balance(db, acc.code)
        ))
    return result

@router.post("", response_model=AccountOut, status_code=201)
def create_account(payload: AccountIn, db: Session = Depends(get_db)):
    if db.query(Account).filter(Account.code == payload.code).first():
        raise HTTPException(400, "كود الحساب مستخدم من قبل")
    
    # التحقق من وجود الحساب الأب إذا تم إرساله
    if payload.parent_code and not db.query(Account).filter(Account.code == payload.parent_code).first():
        raise HTTPException(400, "الحساب الأب غير موجود")

    acc = Account(**payload.model_dump())
    db.add(acc)
    db.commit()
    db.refresh(acc)
    
    return AccountOut(
        code=acc.code, 
        name_ar=acc.name_ar, 
        name_en=acc.name_en,
        account_type=acc.account_type, 
        nature=acc.nature, 
        parent_code=acc.parent_code,
        opening_balance=float(acc.opening_balance), 
        balance=float(acc.opening_balance)
    )

@router.put("/{code}", response_model=AccountOut)
def update_account(code: str, payload: AccountUpdate, db: Session = Depends(get_db)):
    acc = db.query(Account).filter(Account.code == code).first()
    if not acc:
        raise HTTPException(404, "الحساب غير موجود")

    data = payload.model_dump(exclude_unset=True)
    
    # منع الدوائر المنطقية (حساب يكون أباً لنفسه)
    if "parent_code" in data and data["parent_code"] == code:
        raise HTTPException(400, "لا يمكن أن يكون الحساب أبًا لنفسه")
    
    # التحقق من وجود الحساب الأب الجديد إذا تم تغييره
    if "parent_code" in data and data["parent_code"] and not db.query(Account).filter(Account.code == data["parent_code"]).first():
        raise HTTPException(400, "الحساب الأب الجديد غير موجود")

    for k, v in data.items():
        setattr(acc, k, v)
    db.commit()
    db.refresh(acc)
    
    return AccountOut(
        code=acc.code, name_ar=acc.name_ar, name_en=acc.name_en,
        account_type=acc.account_type, nature=acc.nature, parent_code=acc.parent_code,
        opening_balance=float(acc.opening_balance),
        balance=account_rollup_balance(db, acc.code)
    )

# --- باقي العمليات (Delete & Journal) تبقى كما هي لأنها سليمة ---
# (تم الاحتفاظ بنفس المنطق الذي كتبته أنت لمنع الحذف)
@router.delete("/{code}", status_code=204)
def delete_account(code: str, db: Session = Depends(get_db)):
    acc = db.query(Account).filter(Account.code == code).first()
    if not acc:
        raise HTTPException(404, "الحساب غير موجود")
    
    if db.query(Account).filter(Account.parent_code == code).first():
        raise HTTPException(400, "لا يمكن حذف حساب له حسابات فرعية")

    if db.query(JournalEntry).filter(or_(JournalEntry.debit_account == code, JournalEntry.credit_account == code)).first():
        raise HTTPException(400, "لا يمكن حذف حساب مرتبط بقيود محاسبية")

    db.delete(acc)
    db.commit()
    return None

# [بقية كود Journal Entries كما هو...]