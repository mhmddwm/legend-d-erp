from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import Account
from app.services import accounts_balances_tree_filtered


router = APIRouter(prefix="/api/reports", tags=["Financial Reports"])


def _account_out(acc: Account, extra: dict) -> dict:
    return {
        "code": acc.code,
        "name_ar": acc.name_ar,
        "name_en": acc.name_en,
        "account_type": acc.account_type,
        "parent_code": acc.parent_code,
        **extra,
    }


@router.get("/trial-balance")
def get_trial_balance(
    date_from: Optional[date] = Query(None, description="بداية الفترة (اختياري — الرصيد تراكمي من الأساس افتراضياً)"),
    date_to: Optional[date] = Query(None, description="نهاية الفترة (كما بتاريخ). افتراضياً اليوم."),
    branch_id: Optional[int] = Query(None, description="فلترة بفرع معيّن"),
    db: Session = Depends(get_db),
):
    """ميزان المراجعة: كل حساب نشط مع إجمالي المدين والدائن التراكمي
    (شامل الرصيد الافتتاحي) حتى تاريخ معيّن، والرصيد الصافي. إجمالي
    عمود المدين يجب أن يساوي إجمالي عمود الدائن دائماً في نظام قيد
    مزدوج سليم — وهذا هو الغرض الأساسي من التقرير: التحقق من ذلك."""
    as_of = date_to or date.today()
    balances, raw = accounts_balances_tree_filtered(db, date_from=date_from, date_to=as_of, branch_id=branch_id, include_opening=True)

    accounts = db.query(Account).filter(Account.is_active == True).order_by(Account.code.asc()).all()  # noqa: E712

    rows = []
    total_debit_col = 0.0
    total_credit_col = 0.0

    for acc in accounts:
        balance = round(balances.get(acc.code, 0.0), 2)
        movement = raw.get(acc.code, {"debit": 0, "credit": 0})
        opening = float(acc.opening_balance or 0)
        is_debit_nature = acc.account_type in ("assets", "expenses")

        # تمثيل ميزان المراجعة التقليدي: عمود مدين وعمود دائن، الرصيد
        # الموجب يظهر في عمود طبيعة الحساب فقط (لا يظهر في كلا العمودين)
        debit_col = balance if (is_debit_nature and balance > 0) else (abs(balance) if (not is_debit_nature and balance < 0) else 0)
        credit_col = balance if (not is_debit_nature and balance > 0) else (abs(balance) if (is_debit_nature and balance < 0) else 0)

        if opening == 0 and movement["debit"] == 0 and movement["credit"] == 0 and balance == 0:
            continue  # حساب بلا أي نشاط أو رصيد — لا داعي لإدراجه بالتقرير

        rows.append(_account_out(acc, {
            "opening_balance": round(opening, 2),
            "period_debit": round(movement["debit"], 2),
            "period_credit": round(movement["credit"], 2),
            "balance": balance,
            "debit_column": round(debit_col, 2),
            "credit_column": round(credit_col, 2),
        }))
        total_debit_col += debit_col
        total_credit_col += credit_col

    return {
        "as_of": as_of,
        "date_from": date_from,
        "accounts": rows,
        "total_debit": round(total_debit_col, 2),
        "total_credit": round(total_credit_col, 2),
        "is_balanced": abs(round(total_debit_col, 2) - round(total_credit_col, 2)) < 0.01,
    }


@router.get("/income-statement")
def get_income_statement(
    date_from: date = Query(..., description="بداية الفترة"),
    date_to: date = Query(..., description="نهاية الفترة"),
    branch_id: Optional[int] = Query(None, description="فلترة بفرع معيّن"),
    db: Session = Depends(get_db),
):
    """قائمة الدخل (الأرباح والخسائر) لفترة محدَّدة: إجمالي الإيرادات
    ناقص إجمالي المصروفات = صافي الربح/الخسارة. حسابات الإيرادات
    والمصروفات لا تحمل رصيداً افتتاحياً بطبيعتها — النشاط هنا هو نشاط
    الفترة المحدَّدة فقط."""
    balances, raw = accounts_balances_tree_filtered(db, date_from=date_from, date_to=date_to, branch_id=branch_id, include_opening=False)

    accounts = db.query(Account).filter(Account.is_active == True).order_by(Account.code.asc()).all()  # noqa: E712

    revenue_rows, expense_rows = [], []
    total_revenue, total_expenses = 0.0, 0.0

    for acc in accounts:
        balance = round(balances.get(acc.code, 0.0), 2)
        if acc.parent_code:
            # نعرض فقط الحسابات ذات النشاط المباشر (الأوراق) لتفادي ازدواج
            # عرض المجاميع المرحّلة للأعلى ضمن قائمة مسطّحة
            movement = raw.get(acc.code, {"debit": 0, "credit": 0})
            if movement["debit"] == 0 and movement["credit"] == 0:
                continue
        elif balance == 0:
            continue

        if acc.account_type == "revenue" and balance != 0:
            revenue_rows.append(_account_out(acc, {"amount": balance}))
            total_revenue += balance
        elif acc.account_type == "expenses" and balance != 0:
            expense_rows.append(_account_out(acc, {"amount": balance}))
            total_expenses += balance

    return {
        "date_from": date_from,
        "date_to": date_to,
        "revenue": revenue_rows,
        "expenses": expense_rows,
        "total_revenue": round(total_revenue, 2),
        "total_expenses": round(total_expenses, 2),
        "net_income": round(total_revenue - total_expenses, 2),
    }


@router.get("/balance-sheet")
def get_balance_sheet(
    as_of: Optional[date] = Query(None, description="كما بتاريخ (افتراضياً اليوم)"),
    branch_id: Optional[int] = Query(None, description="فلترة بفرع معيّن"),
    db: Session = Depends(get_db),
):
    """الميزانية العمومية كما بتاريخ معيّن: الأصول = الخصوم + حقوق
    الملكية. بما أن النظام لا يُجري قيود إقفال دورية رسمية، يُضاف صافي
    ربح/خسارة الفترة منذ البداية وحتى تاريخ التقرير كبند مستقل تحت
    حقوق الملكية ("صافي الربح غير المرحّل") لضمان توازن المعادلة
    دائماً بما يعكس السلامة المحاسبية للقيود المزدوجة."""
    as_of_date = as_of or date.today()
    balances, raw = accounts_balances_tree_filtered(db, date_from=None, date_to=as_of_date, branch_id=branch_id, include_opening=True)

    accounts = db.query(Account).filter(Account.is_active == True).order_by(Account.code.asc()).all()  # noqa: E712

    assets_rows, liabilities_rows, equity_rows = [], [], []
    total_assets, total_liabilities, total_equity = 0.0, 0.0, 0.0

    for acc in accounts:
        balance = round(balances.get(acc.code, 0.0), 2)
        if acc.parent_code:
            movement = raw.get(acc.code, {"debit": 0, "credit": 0})
            opening = float(acc.opening_balance or 0)
            if movement["debit"] == 0 and movement["credit"] == 0 and opening == 0:
                continue
        elif balance == 0:
            continue

        if acc.account_type == "assets" and balance != 0:
            assets_rows.append(_account_out(acc, {"amount": balance}))
            total_assets += balance
        elif acc.account_type == "liabilities" and balance != 0:
            liabilities_rows.append(_account_out(acc, {"amount": balance}))
            total_liabilities += balance
        elif acc.account_type == "equity" and balance != 0:
            equity_rows.append(_account_out(acc, {"amount": balance}))
            total_equity += balance

    # صافي الربح/الخسارة منذ بداية النشاط وحتى تاريخ التقرير، كبند
    # مستقل ضمن حقوق الملكية (نفس منطق "Current Year Earnings")
    income_balances, income_raw = accounts_balances_tree_filtered(
        db, date_from=None, date_to=as_of_date, branch_id=branch_id, include_opening=False,
    )
    net_income_to_date = 0.0
    for acc in accounts:
        if acc.parent_code:
            continue
        if acc.account_type == "revenue":
            net_income_to_date += income_balances.get(acc.code, 0.0)
        elif acc.account_type == "expenses":
            net_income_to_date -= income_balances.get(acc.code, 0.0)
    net_income_to_date = round(net_income_to_date, 2)

    if abs(net_income_to_date) > 0.005:
        equity_rows.append({
            "code": "—", "name_ar": "صافي الربح غير المرحّل (منذ البداية)", "name_en": "Current Earnings (Unposted)",
            "account_type": "equity", "parent_code": None, "amount": net_income_to_date,
        })
        total_equity += net_income_to_date

    total_liabilities_and_equity = round(total_liabilities + total_equity, 2)

    return {
        "as_of": as_of_date,
        "assets": assets_rows,
        "liabilities": liabilities_rows,
        "equity": equity_rows,
        "total_assets": round(total_assets, 2),
        "total_liabilities": round(total_liabilities, 2),
        "total_equity": round(total_equity, 2),
        "total_liabilities_and_equity": total_liabilities_and_equity,
        "is_balanced": abs(round(total_assets, 2) - total_liabilities_and_equity) < 0.01,
    }
