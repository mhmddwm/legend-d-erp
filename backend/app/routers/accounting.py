from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import Optional
from datetime import date
from app.database import get_db
from app.models.models import Account, JournalEntry
from app.schemas.accounting import AccountIn, AccountUpdate, AccountOut, JournalEntryIn, JournalEntryOut
from app.services import account_rollup_balance

router = APIRouter(prefix="/api/accounts", tags=["Accounts"])
journal_router = APIRouter(prefix="/api/journal", tags=["Journal"])

# ============================================================
# الحسابات (Accounts)
# ============================================================

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
    
    if "parent_code" in data and data["parent_code"] == code:
        raise HTTPException(400, "لا يمكن أن يكون الحساب أبًا لنفسه")
    
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


# ============================================================
# القيود المحاسبية (Journal Entries) مع البحث المتقدم
# ============================================================

@journal_router.get("", response_model=list[JournalEntryOut])
def list_journal_entries(
    entry_no: Optional[int] = Query(None),
    account: Optional[str] = Query(None),
    user: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    amount_min: Optional[float] = Query(None),
    amount_max: Optional[float] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(JournalEntry)

    if entry_no:
        query = query.filter(JournalEntry.id == entry_no)
    if account:
        query = query.filter(or_(JournalEntry.debit_account == account, JournalEntry.credit_account == account))
    if user:
        query = query.filter(JournalEntry.created_by == user)
    if date_from:
        query = query.filter(JournalEntry.entry_date >= date_from)
    if date_to:
        query = query.filter(JournalEntry.entry_date <= date_to)
    if amount_min is not None:
        query = query.filter(JournalEntry.amount >= amount_min)
    if amount_max is not None:
        query = query.filter(JournalEntry.amount <= amount_max)

    return query.order_by(JournalEntry.entry_date.desc(), JournalEntry.id.desc()).all()

@journal_router.post("", response_model=JournalEntryOut, status_code=201)
def create_journal_entry(payload: JournalEntryIn, db: Session = Depends(get_db)):
    if payload.debit_account == payload.credit_account:
        raise HTTPException(400, "لا يمكن أن يكون حساب المدين هو نفسه حساب الدائن")
    if not db.query(Account).filter(Account.code == payload.debit_account).first():
        raise HTTPException(404, "حساب المدين غير موجود")
    if not db.query(Account).filter(Account.code == payload.credit_account).first():
        raise HTTPException(404, "حساب الدائن غير موجود")

    entry = JournalEntry(
        entry_date=payload.entry_date,
        debit_account=payload.debit_account,
        credit_account=payload.credit_account,
        amount=payload.amount,
        description=payload.description,
        source_type="manual",
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry

@journal_router.delete("/{entry_id}", status_code=204)
def delete_journal_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.query(JournalEntry).get(entry_id)
    if not entry:
        raise HTTPException(404, "القيد غير موجود")
    if entry.source_type != "manual":
        raise HTTPException(400, "لا يمكن حذف قيد مُولَّد تلقائياً")
    db.delete(entry)
    db.commit()
    return None