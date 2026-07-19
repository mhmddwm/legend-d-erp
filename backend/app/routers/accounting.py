from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_
from typing import Optional
from datetime import date
from app.database import get_db
from app.models.models import Account, JournalEntry, JournalEntryLine, CostCenter
from app.schemas.accounting import (
    AccountIn, AccountUpdate, AccountOut,
    JournalEntryIn, JournalEntryOut,
    CostCenterIn, CostCenterOut,
)
from app.services import account_rollup_balance

router = APIRouter(prefix="/api/accounts", tags=["Accounts"])
journal_router = APIRouter(prefix="/api/journal", tags=["Journal"])
cost_center_router = APIRouter(prefix="/api/cost-centers", tags=["Cost Centers"])


@cost_center_router.get("", response_model=list[CostCenterOut])
def list_cost_centers(db: Session = Depends(get_db)):
    return db.query(CostCenter).filter(CostCenter.is_active == True).order_by(CostCenter.code).all()


@cost_center_router.post("", response_model=CostCenterOut, status_code=201)
def create_cost_center(payload: CostCenterIn, db: Session = Depends(get_db)):
    if db.query(CostCenter).filter(CostCenter.code == payload.code).first():
        raise HTTPException(400, "كود مركز التكلفة مستخدم من قبل")
    cc = CostCenter(**payload.model_dump())
    db.add(cc)
    db.commit()
    db.refresh(cc)
    return cc

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
    if db.query(JournalEntryLine).filter(JournalEntryLine.account_code == code).first():
        raise HTTPException(400, "لا يمكن حذف حساب مرتبط بقيود محاسبية")

    db.delete(acc)
    db.commit()
    return None


# ============================================================
# القيود المحاسبية (Journal Entries) مع البحث المتقدم
# ============================================================

@journal_router.get("", response_model=list[JournalEntryOut])
def list_journal_entries(
    entry_no: Optional[int] = Query(None, description="رقم القيد"),
    account: Optional[str] = Query(None, description="كود أو اسم الحساب (في أي سطر من أسطر القيد)"),
    created_by: Optional[str] = Query(None, description="منشئ القيد (بحث جزئي)"),
    description: Optional[str] = Query(None, description="بحث بوصف القيد (بحث جزئي)"),
    date_from: Optional[date] = Query(None, description="تاريخ القيد من"),
    date_to: Optional[date] = Query(None, description="تاريخ القيد إلى"),
    created_from: Optional[date] = Query(None, description="تاريخ الإنشاء من"),
    created_to: Optional[date] = Query(None, description="تاريخ الإنشاء إلى"),
    amount_from: Optional[float] = Query(None, description="المبلغ من"),
    amount_to: Optional[float] = Query(None, description="المبلغ إلى"),
    status: Optional[str] = Query(None, description="حالة القيد: posted / cancelled"),
    cost_center_code: Optional[str] = Query(None, description="مركز التكلفة"),
    db: Session = Depends(get_db)
):
    query = db.query(JournalEntry).options(joinedload(JournalEntry.lines))

    if entry_no:
        query = query.filter(JournalEntry.id == entry_no)

    if account:
        matching_codes = [
            a.code for a in db.query(Account).filter(
                or_(
                    Account.code.ilike(f"%{account}%"),
                    Account.name_ar.ilike(f"%{account}%"),
                    Account.name_en.ilike(f"%{account}%"),
                )
            ).all()
        ]
        matching_entry_ids = [
            row[0] for row in db.query(JournalEntryLine.entry_id).filter(
                JournalEntryLine.account_code.in_(matching_codes)
            ).distinct().all()
        ]
        query = query.filter(
            or_(
                JournalEntry.id.in_(matching_entry_ids),
                JournalEntry.debit_account.in_(matching_codes),
                JournalEntry.credit_account.in_(matching_codes),
            )
        )

    if created_by:
        query = query.filter(JournalEntry.created_by_name.ilike(f"%{created_by}%"))

    if description:
        query = query.filter(JournalEntry.description.ilike(f"%{description}%"))

    if date_from:
        query = query.filter(JournalEntry.entry_date >= date_from)
    if date_to:
        query = query.filter(JournalEntry.entry_date <= date_to)

    if created_from:
        query = query.filter(JournalEntry.created_at >= created_from)
    if created_to:
        query = query.filter(JournalEntry.created_at <= created_to)

    if amount_from is not None:
        query = query.filter(JournalEntry.total_amount >= amount_from)
    if amount_to is not None:
        query = query.filter(JournalEntry.total_amount <= amount_to)

    if status:
        query = query.filter(JournalEntry.status == status)

    if cost_center_code:
        query = query.filter(JournalEntry.cost_center_code == cost_center_code)

    return query.order_by(JournalEntry.entry_date.desc(), JournalEntry.id.desc()).all()


def _validate_lines(payload, db: Session):
    if len(payload.lines) < 2:
        raise HTTPException(400, "يجب أن يحتوي القيد على سطرين على الأقل")

    total_debit = 0.0
    total_credit = 0.0
    for line in payload.lines:
        if (line.debit and line.credit) or (not line.debit and not line.credit):
            raise HTTPException(400, "كل سطر يجب أن يكون له مبلغ مدين أو دائن فقط، وليس كلاهما ولا لا شيء")
        if not db.query(Account).filter(Account.code == line.account_code).first():
            raise HTTPException(404, f"الحساب {line.account_code} غير موجود")
        total_debit += line.debit
        total_credit += line.credit

    if round(total_debit, 2) != round(total_credit, 2):
        raise HTTPException(400, f"القيد غير متوازن: إجمالي المدين {total_debit:.2f} لا يساوي إجمالي الدائن {total_credit:.2f}")
    if total_debit <= 0:
        raise HTTPException(400, "لا يمكن ترحيل قيد بإجمالي صفر")

    return total_debit


@journal_router.post("", response_model=JournalEntryOut, status_code=201)
def create_journal_entry(payload: JournalEntryIn, db: Session = Depends(get_db)):
    total_debit = _validate_lines(payload, db)
    if payload.cost_center_code and not db.query(CostCenter).filter(CostCenter.code == payload.cost_center_code).first():
        raise HTTPException(404, "مركز التكلفة غير موجود")

    entry = JournalEntry(
        entry_date=payload.entry_date,
        description=payload.description,
        created_by_name=payload.created_by_name,
        source_type="manual",
        status="posted",
        cost_center_code=payload.cost_center_code,
        total_amount=total_debit,
    )
    if len(payload.lines) == 2:
        d = next((l for l in payload.lines if l.debit), None)
        c = next((l for l in payload.lines if l.credit), None)
        if d and c:
            entry.debit_account = d.account_code
            entry.credit_account = c.account_code
            entry.amount = total_debit

    db.add(entry)
    db.flush()

    for idx, line in enumerate(payload.lines, start=1):
        db.add(JournalEntryLine(
            entry_id=entry.id,
            line_no=idx,
            account_code=line.account_code,
            debit=line.debit,
            credit=line.credit,
            line_description=line.line_description,
        ))

    db.commit()
    db.refresh(entry)
    return entry


@journal_router.put("/{entry_id}", response_model=JournalEntryOut)
def update_journal_entry(entry_id: int, payload: JournalEntryIn, db: Session = Depends(get_db)):
    entry = db.query(JournalEntry).get(entry_id)
    if not entry:
        raise HTTPException(404, "القيد غير موجود")
    if entry.source_type != "manual":
        raise HTTPException(400, "لا يمكن تعديل قيد مُولَّد تلقائياً")
    if entry.status == "cancelled":
        raise HTTPException(400, "لا يمكن تعديل قيد ملغى")

    total_debit = _validate_lines(payload, db)
    if payload.cost_center_code and not db.query(CostCenter).filter(CostCenter.code == payload.cost_center_code).first():
        raise HTTPException(404, "مركز التكلفة غير موجود")

    entry.entry_date = payload.entry_date
    entry.description = payload.description
    entry.created_by_name = payload.created_by_name
    entry.cost_center_code = payload.cost_center_code
    entry.total_amount = total_debit
    entry.debit_account = None
    entry.credit_account = None
    entry.amount = None
    if len(payload.lines) == 2:
        d = next((l for l in payload.lines if l.debit), None)
        c = next((l for l in payload.lines if l.credit), None)
        if d and c:
            entry.debit_account = d.account_code
            entry.credit_account = c.account_code
            entry.amount = total_debit

    db.query(JournalEntryLine).filter(JournalEntryLine.entry_id == entry_id).delete()
    for idx, line in enumerate(payload.lines, start=1):
        db.add(JournalEntryLine(
            entry_id=entry.id,
            line_no=idx,
            account_code=line.account_code,
            debit=line.debit,
            credit=line.credit,
            line_description=line.line_description,
        ))

    db.commit()
    db.refresh(entry)
    return entry


@journal_router.patch("/{entry_id}/cancel", response_model=JournalEntryOut)
def cancel_journal_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.query(JournalEntry).get(entry_id)
    if not entry:
        raise HTTPException(404, "القيد غير موجود")
    if entry.status == "cancelled":
        raise HTTPException(400, "القيد ملغى بالفعل")
    entry.status = "cancelled"
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