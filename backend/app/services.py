from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import (
    Account,
    JournalEntry,
    JournalEntryLine,
)


def next_sequence(db: Session, model, number_column, prefix: str) -> str:
    """
    يولّد رقمًا تسلسليًا جديدًا مثل PO-0001, GRN-0002
    بالاعتماد على عدد السجلات الحالية.
    """
    count = db.query(model).count()
    return f"{prefix}-{count + 1:04d}"



def account_direct_balance(
    db: Session,
    code: str,
    branch_id: int = None
) -> float:
    """
    الرصيد المباشر للحساب:
    الافتتاحي + أسطر القيود المرحلة الخاصة بالحساب فقط.
    بدون حسابات الأبناء.
    """

    acc = (
        db.query(Account)
        .filter(Account.code == code)
        .first()
    )

    if not acc:
        return 0.0


    debit_nature = acc.account_type in (
        "assets",
        "expenses"
    )

    opening = float(
        acc.opening_balance or 0
    )


    query = (
        db.query(JournalEntryLine)
        .join(
            JournalEntry,
            JournalEntryLine.entry_id == JournalEntry.id
        )
        .filter(
            JournalEntryLine.account_code == code,
            JournalEntry.status == "posted"
        )
    )


    if branch_id is not None:
        query = query.filter(
            JournalEntry.branch_id == branch_id
        )


    debit_sum = float(
        query.with_entities(
            func.coalesce(
                func.sum(JournalEntryLine.debit),
                0
            )
        ).scalar()
        or 0
    )


    credit_sum = float(
        query.with_entities(
            func.coalesce(
                func.sum(JournalEntryLine.credit),
                0
            )
        ).scalar()
        or 0
    )


    if debit_nature:
        return opening + debit_sum - credit_sum

    else:
        return opening + credit_sum - debit_sum



def account_rollup_balance(
    db: Session,
    code: str,
    branch_id: int = None
) -> float:
    """
    الرصيد التراكمي للحساب:
    الرصيد المباشر + جميع الحسابات الفرعية.

    تم الإبقاء عليها للتوافق مع باقي النظام.
    """

    total = account_direct_balance(
        db,
        code,
        branch_id
    )


    children = (
        db.query(Account)
        .filter(Account.parent_code == code)
        .all()
    )


    for child in children:

        total += account_rollup_balance(
            db,
            child.code,
            branch_id
        )


    return total



def accounts_balances_tree(
    db: Session,
    branch_id: int = None
):
    """
    حساب أرصدة جميع الحسابات مرة واحدة.

    يستخدم في شاشة دليل الحسابات لمنع مشكلة
    N+1 Query.

    يرجع:
    {
        account_code: cumulative_balance
    }
    """


    accounts = (
        db.query(Account)
        .filter(Account.is_active == True)
        .all()
    )


    if not accounts:
        return {}



    # =====================================
    # تحميل القيود مرة واحدة
    # =====================================

    query = (
        db.query(
            JournalEntryLine.account_code,
            func.coalesce(
                func.sum(JournalEntryLine.debit),
                0
            ).label("debit"),
            func.coalesce(
                func.sum(JournalEntryLine.credit),
                0
            ).label("credit"),
        )
        .join(
            JournalEntry,
            JournalEntryLine.entry_id == JournalEntry.id
        )
        .filter(
            JournalEntry.status == "posted"
        )
    )


    if branch_id is not None:

        query = query.filter(
            JournalEntry.branch_id == branch_id
        )


    query = query.group_by(
        JournalEntryLine.account_code
    )


    movements = {

        row.account_code: {
            "debit": float(row.debit or 0),
            "credit": float(row.credit or 0),
        }

        for row in query.all()

    }



    balances = {}
    children_map = {}



    # =====================================
    # حساب الرصيد المباشر
    # =====================================

    for acc in accounts:

        move = movements.get(
            acc.code,
            {
                "debit": 0,
                "credit": 0
            }
        )


        debit = move["debit"]
        credit = move["credit"]

        opening = float(
            acc.opening_balance or 0
        )


        if acc.account_type in (
            "assets",
            "expenses"
        ):

            balances[acc.code] = (
                opening
                + debit
                - credit
            )

        else:

            balances[acc.code] = (
                opening
                + credit
                - debit
            )



        if acc.parent_code:

            children_map.setdefault(
                acc.parent_code,
                []
            ).append(
                acc.code
            )



    # =====================================
    # تجميع الأبناء للأعلى
    # =====================================

    def calculate_parent(code):

        total = balances.get(
            code,
            0
        )


        for child in children_map.get(
            code,
            []
        ):

            total += calculate_parent(
                child
            )


        balances[code] = total

        return total



    roots = [
        acc.code
        for acc in accounts
        if not acc.parent_code
    ]


    for root in roots:
        calculate_parent(root)



    return balances

def accounts_balances_tree_filtered(
    db: Session,
    date_from=None,
    date_to=None,
    branch_id: int = None,
    include_opening: bool = True,
):
    """نفس منطق accounts_balances_tree (رصيد مباشر + تجميع الأبناء
    للأعلى، بدون N+1) لكن مع دعم فلترة زمنية — للتقارير المالية:
    - ميزان المراجعة / الميزانية العمومية: date_to فقط (تراكمي حتى تاريخ)
      مع include_opening=True.
    - قائمة الدخل: date_from + date_to معاً (نشاط الفترة فقط)
      مع include_opening=False (حسابات الإيرادات/المصروفات لا تحمل
      رصيداً افتتاحياً بطبيعتها).
    يرجع أيضاً raw_movements (مجموع مدين/دائن خام لكل حساب دون تصفية
    حسب الطبيعة) لاستخدامها في ميزان المراجعة الذي يعرض العمودين معاً.
    """
    accounts = (
        db.query(Account)
        .filter(Account.is_active == True)  # noqa: E712
        .all()
    )
    if not accounts:
        return {}, {}

    query = (
        db.query(
            JournalEntryLine.account_code,
            func.coalesce(func.sum(JournalEntryLine.debit), 0).label("debit"),
            func.coalesce(func.sum(JournalEntryLine.credit), 0).label("credit"),
        )
        .join(JournalEntry, JournalEntryLine.entry_id == JournalEntry.id)
        .filter(JournalEntry.status == "posted")
    )
    if branch_id is not None:
        query = query.filter(JournalEntry.branch_id == branch_id)
    if date_from is not None:
        query = query.filter(JournalEntry.entry_date >= date_from)
    if date_to is not None:
        query = query.filter(JournalEntry.entry_date <= date_to)

    query = query.group_by(JournalEntryLine.account_code)

    movements = {
        row.account_code: {"debit": float(row.debit or 0), "credit": float(row.credit or 0)}
        for row in query.all()
    }

    balances = {}
    raw_movements = {}
    children_map = {}

    for acc in accounts:
        move = movements.get(acc.code, {"debit": 0, "credit": 0})
        debit = move["debit"]
        credit = move["credit"]
        opening = float(acc.opening_balance or 0) if include_opening else 0.0

        raw_movements[acc.code] = {"debit": debit, "credit": credit}

        if acc.account_type in ("assets", "expenses"):
            balances[acc.code] = opening + debit - credit
        else:
            balances[acc.code] = opening + credit - debit

        if acc.parent_code:
            children_map.setdefault(acc.parent_code, []).append(acc.code)

    def calculate_parent(code):
        total = balances.get(code, 0)
        raw = dict(raw_movements.get(code, {"debit": 0, "credit": 0}))
        for child in children_map.get(code, []):
            child_total, child_raw = calculate_parent(child)
            total += child_total
            raw["debit"] += child_raw["debit"]
            raw["credit"] += child_raw["credit"]
        balances[code] = total
        raw_movements[code] = raw
        return total, raw

    roots = [acc.code for acc in accounts if not acc.parent_code]
    for root in roots:
        calculate_parent(root)

    return balances, raw_movements
