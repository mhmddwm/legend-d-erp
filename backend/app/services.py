from sqlalchemy import func
from sqlalchemy.orm import Session
from app.models.models import Account, JournalEntry, JournalEntryLine

def next_sequence(db: Session, model, number_column, prefix: str) -> str:
    """يولّد رقمًا تسلسليًا جديدًا مثل PO-0001, GRN-0002 بالاعتماد على عدد السجلات الحالية."""
    count = db.query(model).count()
    return f"{prefix}-{count + 1:04d}"

def account_direct_balance(db: Session, code: str, branch_id: int = None) -> float:
    """الرصيد المباشر للحساب (افتتاحي + كل أسطر القيود المُرحلة الخاصة به عبر
    كل أسطر القيد المركب، بدون حسابات الأبناء). القيود الملغاة (status='cancelled')
    لا تُحتسب. يمكن تمرير branch_id لحصر الرصيد على فرع معيّن فقط."""
    acc = db.query(Account).filter(Account.code == code).first()
    if not acc:
        return 0.0

    debit_nature = acc.account_type in ("assets", "expenses")
    opening = float(acc.opening_balance or 0)

    base_q = db.query(JournalEntryLine).join(JournalEntry, JournalEntryLine.entry_id == JournalEntry.id).filter(
        JournalEntryLine.account_code == code,
        JournalEntry.status == "posted",
    )
    if branch_id is not None:
        base_q = base_q.filter(JournalEntry.branch_id == branch_id)

    debit_sum = float(base_q.with_entities(func.coalesce(func.sum(JournalEntryLine.debit), 0)).scalar() or 0)
    credit_sum = float(base_q.with_entities(func.coalesce(func.sum(JournalEntryLine.credit), 0)).scalar() or 0)

    if debit_nature:
        return opening + debit_sum - credit_sum
    else:
        return opening + credit_sum - debit_sum

def account_rollup_balance(db: Session, code: str, branch_id: int = None) -> float:
    """الرصيد التراكمي للحساب (رصيده المباشر + كل أرصدة حساباته الفرعية)."""
    total = account_direct_balance(db, code, branch_id)
    children = db.query(Account).filter(Account.parent_code == code).all()
    for child in children:
        total += account_rollup_balance(db, child.code, branch_id)
    return total