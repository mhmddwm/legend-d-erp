from sqlalchemy import func
from sqlalchemy.orm import Session
from app.models.models import Account, JournalEntry, JournalEntryLine

def next_sequence(db: Session, model, number_column, prefix: str) -> str:
    """يولّد رقمًا تسلسليًا جديدًا مثل PO-0001, GRN-0002 بالاعتماد على عدد السجلات الحالية."""
    count = db.query(model).count()
    return f"{prefix}-{count + 1:04d}"

def account_direct_balance(db: Session, code: str) -> float:
    """الرصيد المباشر للحساب (افتتاحي + كل أسطر القيود المُرحلة الخاصة به)."""
    acc = db.query(Account).filter(Account.code == code).first()
    if not acc:
        return 0.0

    debit_nature = acc.account_type in ("assets", "expenses")
    opening = float(acc.opening_balance or 0)

    # الربط بجدول JournalEntry للتأكد من حالة القيد 'posted'
    base_query = db.query(JournalEntryLine).join(JournalEntry).filter(
        JournalEntryLine.account_code == code,
        JournalEntry.status == "posted"
    )

    debit_sum = base_query.with_entities(func.coalesce(func.sum(JournalEntryLine.debit), 0)).scalar()
    credit_sum = base_query.with_entities(func.coalesce(func.sum(JournalEntryLine.credit), 0)).scalar()

    debit_sum = float(debit_sum or 0)
    credit_sum = float(credit_sum or 0)

    if debit_nature:
        return opening + debit_sum - credit_sum
    else:
        return opening + credit_sum - debit_sum

def account_rollup_balance(db: Session, code: str) -> float:
    """الرصيد التراكمي للحساب (رصيده المباشر + كل أرصدة حساباته الفرعية)."""
    total = account_direct_balance(db, code)
    children = db.query(Account).filter(Account.parent_code == code).all()
    for child in children:
        total += account_rollup_balance(db, child.code)
    return total