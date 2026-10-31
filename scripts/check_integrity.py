# -*- coding: utf-8 -*-
"""
فحص سلامة الحسابات والمخزون — LEGEND D ERP (PF-01.4)
=====================================================
أداة **قراءة فقط**: تتصل بالقاعدة في وضع لا يسمح بأي كتابة، وتتحقق من اتساق
القيود والمستندات والمخزون وأرصدة الموردين، وتطبع تقريراً بالعربية.

التشغيل (من المجلد الرئيسي للمشروع):
    python scripts/check_integrity.py
    python scripts/check_integrity.py --limit 0        # عرض كل الأمثلة

مستويات النتائج:
    [سليم]   لا مشكلة.
    [خطأ]    خلل محاسبي أو مخزني يلزم فحصه (يُرجع الأمر رمز خروج 1).
    [تنبيه]  فرق قد يكون مشروعاً (بيانات قديمة، قيد يدوي...) ويحتاج مراجعة.
    [معلومة] أرقام للاطلاع.
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TOL = 0.005       # تسامح المبالغ (هللة)
QTY_TOL = 0.0001  # تسامح الكميات

LABELS = {"ok": "[سليم   ]", "error": "[خطأ    ]", "warn": "[تنبيه  ]", "info": "[معلومة ]"}


# ------------------------------------------------------------------ الاتصال
def load_database_url():
    url = os.getenv("DATABASE_URL", "").strip()
    if url:
        return url
    env_path = os.path.normpath(os.path.join(HERE, "..", "backend", ".env"))
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("DATABASE_URL="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def connect_readonly(url):
    try:
        import psycopg2
    except ImportError:
        sys.exit("psycopg2 غير مثبّت. نفّذ: pip install -r requirements.txt (من مجلد backend)")
    kwargs = {}
    local = "localhost" in url or "127.0.0.1" in url or "host=/" in url
    if not local and "sslmode=" not in url:
        kwargs["sslmode"] = "require"
    conn = psycopg2.connect(url, **kwargs)
    conn.set_session(readonly=True, autocommit=True)   # لا كتابة مطلقاً
    return conn


def fetch(cur, sql, params=None):
    cur.execute(sql, params)
    return cur.fetchall()


def num(x):
    return f"{float(x or 0):,.2f}"


# ----------------------------------------------------------- الفحوص (SQL)
def chk_global_totals(cur, a):
    d, c = fetch(cur, """
        SELECT COALESCE(SUM(l.debit),0), COALESCE(SUM(l.credit),0)
        FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
        WHERE e.status = 'posted'""")[0]
    rows = [f"إجمالي المدين {num(d)} | إجمالي الدائن {num(c)}"]
    if abs(float(d) - float(c)) > TOL:
        return "error", "ميزان المراجعة غير متوازن (مجموع المدين ≠ مجموع الدائن)", \
            rows + [f"الفرق {num(float(d) - float(c))}"], \
            "راجع القيود غير المتوازنة في الفحص التالي."
    return "ok", "ميزان المراجعة متوازن", rows, ""


def chk_unbalanced_entries(cur, a):
    rows = fetch(cur, """
        SELECT e.id, e.entry_date, SUM(l.debit), SUM(l.credit)
        FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id
        WHERE e.status = 'posted'
        GROUP BY e.id, e.entry_date
        HAVING ABS(SUM(l.debit) - SUM(l.credit)) > %s
        ORDER BY e.id""", (TOL,))
    if not rows:
        return "ok", "كل القيود المرحّلة متوازنة (مدين = دائن)", [], ""
    return "error", f"{len(rows)} قيد غير متوازن", \
        [f"قيد #{r[0]} ({r[1]}): مدين {num(r[2])} / دائن {num(r[3])}" for r in rows], \
        "قيد غير متوازن يفسد الأرصدة. لا تعدّله مباشرة؛ أرسله لي لنفهم سببه."


def chk_entry_total(cur, a):
    # قيود فاتورة/مرتجع المبيعات المباشرة تخزّن إجمالي المستند فقط (دون سطر التكلفة)
    # بينما تحوي أسطرها المدينة سطر التكلفة أيضاً؛ فلا يُعدّ ذلك خطأً ما دام الإجمالي
    # المخزّن لا يزيد عن مجموع الأسطر. مطابقتها لمستنداتها تُفحص في «مبلغ المستند والقيد».
    rows = fetch(cur, """
        SELECT e.id, e.entry_date, e.total_amount, SUM(l.debit)
        FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id = e.id
        WHERE e.status = 'posted'
        GROUP BY e.id, e.entry_date, e.total_amount, e.source_type
        HAVING CASE WHEN e.source_type IN ('sales_invoice', 'sales_return')
                    THEN e.total_amount - SUM(l.debit) > %s
                    ELSE ABS(e.total_amount - SUM(l.debit)) > %s END
        ORDER BY e.id""", (TOL, TOL))
    if not rows:
        return "ok", "إجمالي كل قيد يطابق مجموع أسطره", [], ""
    return "error", f"{len(rows)} قيد إجماليه المخزّن لا يطابق أسطره", \
        [f"قيد #{r[0]} ({r[1]}): الإجمالي {num(r[2])} / مجموع الأسطر {num(r[3])}" for r in rows], \
        "الإجمالي المخزّن يظهر في بعض الشاشات والتقارير، فالفرق قد يعرض رقماً خاطئاً."


def chk_entries_without_lines(cur, a):
    rows = fetch(cur, """
        SELECT e.id, e.entry_date, e.total_amount, e.source_type
        FROM journal_entries e
        WHERE e.status = 'posted' AND COALESCE(e.total_amount, 0) > 0
          AND NOT EXISTS (SELECT 1 FROM journal_entry_lines l WHERE l.entry_id = e.id)
        ORDER BY e.id""")
    if not rows:
        return "ok", "لا توجد قيود مرحّلة بلا أسطر", [], ""
    return "warn", f"{len(rows)} قيد مرحّل بمبلغ لكن بلا أسطر", \
        [f"قيد #{r[0]} ({r[1]}): {num(r[2])} — المصدر: {r[3]}" for r in rows], \
        "غالباً قيود قديمة بصيغة ما قبل الأسطر المتعددة؛ لا أثر لها على الأرصدة المحسوبة من الأسطر."


# المستند: (الاسم, الجدول, عمود المفتاح, عمود الإجمالي, يملك status؟, عمود تكلفة إضافي)
DOCS = [
    ("فاتورة مشتريات", "purchase_invoices", "inv_number", "total", True, None),
    ("إذن استلام", "goods_receipts", "grn_number", "total", False, None),
    ("دفعة مورد", "supplier_payments", "payment_number", "amount", True, None),
    ("مرتجع مشتريات", "purchase_returns", "rt_number", "total", True, None),
    ("فاتورة مبيعات", "sales_invoices", "inv_number", "total", True, "cogs_total"),
    ("مرتجع مبيعات", "sales_returns", "rt_number", "total", True, "cogs_total"),
]


def _live(alias, has_status):
    return f"AND {alias}.status <> 'cancelled'" if has_status else ""


def chk_docs_missing_entry(cur, a):
    rows, errs = [], []
    for name, tbl, key, tot, has_status, _ in DOCS:
        try:
            for r in fetch(cur, f"""
                SELECT d.{key}, d.{tot} FROM {tbl} d
                WHERE d.journal_entry_id IS NULL {_live('d', has_status)}
                ORDER BY d.{key}"""):
                rows.append(f"{name} {r[0]}: {num(r[1])} بلا قيد")
        except Exception as exc:  # جدول/عمود غير موجود
            errs.append(f"{name}: تعذر الفحص ({str(exc).splitlines()[0]})")
    if errs:
        return "warn", "تعذر فحص بعض المستندات", errs + rows, ""
    if not rows:
        return "ok", "كل مستند فعّال مرتبط بقيد محاسبي", [], ""
    return "warn", f"{len(rows)} مستند فعّال بلا قيد محاسبي", rows, \
        "إن كانت مستندات قديمة سبقت تفعيل الترحيل المحاسبي فهذا متوقع؛ وإن كانت حديثة فهي مشكلة."


def chk_docs_entry_state(cur, a):
    rows = []
    for name, tbl, key, tot, has_status, _ in DOCS:
        sql_live = f"""
            SELECT d.{key}, e.id, e.status FROM {tbl} d
            JOIN journal_entries e ON e.id = d.journal_entry_id
            WHERE e.status <> 'posted' {_live('d', has_status)} ORDER BY d.{key}"""
        for r in fetch(cur, sql_live):
            rows.append(f"{name} {r[0]} فعّال لكن قيده #{r[1]} حالته «{r[2]}»")
        if has_status:
            for r in fetch(cur, f"""
                SELECT d.{key}, e.id FROM {tbl} d
                JOIN journal_entries e ON e.id = d.journal_entry_id
                WHERE d.status = 'cancelled' AND e.status = 'posted' ORDER BY d.{key}"""):
                rows.append(f"{name} {r[0]} ملغى لكن قيده #{r[1]} ما زال مرحّلاً")
    if not rows:
        return "ok", "حالة المستندات تطابق حالة قيودها (الملغى ملغى والفعّال مرحّل)", [], ""
    return "error", f"{len(rows)} مستند حالته لا تطابق حالة قيده", rows, \
        "مستند ملغى بقيد باقٍ يترك أثراً في الأرصدة، ومستند فعّال بقيد ملغى يُخفي أثره."


def chk_docs_amount(cur, a):
    rows = []
    for name, tbl, key, tot, has_status, extra in DOCS:
        cond = f"ABS(e.total_amount - d.{tot}) > 0.01"
        if extra:  # الفاتورة المباشرة تضيف قيد التكلفة إلى نفس القيد
            cond += f" AND ABS(e.total_amount - (d.{tot} + d.{extra})) > 0.01"
        for r in fetch(cur, f"""
            SELECT d.{key}, d.{tot}, e.total_amount, e.id FROM {tbl} d
            JOIN journal_entries e ON e.id = d.journal_entry_id
            WHERE e.status = 'posted' {_live('d', has_status)} AND {cond}
            ORDER BY d.{key}"""):
            rows.append(f"{name} {r[0]}: المستند {num(r[1])} / القيد #{r[3]} {num(r[2])}")
    if not rows:
        return "ok", "مبالغ المستندات تطابق مبالغ قيودها", [], ""
    return "error", f"{len(rows)} مستند مبلغه يختلف عن قيده", rows, \
        "قد يعني تعديل المستند بعد ترحيله دون تحديث القيد، أو خللاً في الترحيل."


def chk_shared_entries(cur, a):
    unions = " UNION ALL ".join(
        f"SELECT '{t}' src, journal_entry_id FROM {t} WHERE journal_entry_id IS NOT NULL"
        for _, t, *_ in DOCS)
    rows = fetch(cur, f"""
        SELECT journal_entry_id, COUNT(*), STRING_AGG(src, ', ')
        FROM ({unions}) u GROUP BY journal_entry_id HAVING COUNT(*) > 1
        ORDER BY journal_entry_id""")
    if not rows:
        return "ok", "كل قيد مرتبط بمستند واحد فقط", [], ""
    return "warn", f"{len(rows)} قيد مرتبط بأكثر من مستند", \
        [f"قيد #{r[0]} مرتبط بـ {r[1]} مستندات ({r[2]})" for r in rows], \
        "الأصل أن لكل مستند قيده الخاص."


def chk_stock_vs_moves(cur, a):
    rows = fetch(cur, """
        SELECT i.code, i.name, i.qty, COALESCE(m.s, 0)
        FROM items i
        LEFT JOIN (SELECT item_id, SUM(qty) s FROM stock_moves GROUP BY item_id) m ON m.item_id = i.id
        WHERE ABS(i.qty - COALESCE(m.s, 0)) > %s ORDER BY i.code""", (QTY_TOL,))
    if not rows:
        return "ok", "كمية كل صنف تطابق مجموع حركاته", [], ""
    return "error", f"{len(rows)} صنف كميته لا تطابق مجموع حركاته", \
        [f"{r[0]} {r[1]}: الكمية {num(r[2])} / مجموع الحركات {num(r[3])} (فرق {num(float(r[2]) - float(r[3]))})"
         for r in rows], \
        "تغيّرت كمية الصنف دون حركة مسجّلة (تعديل يدوي أو أصناف قبل دفتر الحركات)."


def chk_warehouse_stock(cur, a):
    rows = fetch(cur, """
        SELECT i.code, i.name, i.qty, COALESCE(w.s, 0)
        FROM items i
        LEFT JOIN (SELECT item_id, SUM(quantity) s FROM warehouse_stock GROUP BY item_id) w ON w.item_id = i.id
        WHERE ABS(i.qty - COALESCE(w.s, 0)) > %s ORDER BY i.code""", (QTY_TOL,))
    if not rows:
        return "ok", "كمية كل صنف تطابق مجموعها على المستودعات", [], ""
    return "warn", f"{len(rows)} صنف كميته لا تطابق مجموع المستودعات", \
        [f"{r[0]} {r[1]}: الإجمالي {num(r[2])} / المستودعات {num(r[3])}" for r in rows], \
        "قد يحدث لأصناف بيعت دون تحديد مستودع."


def chk_negative_stock(cur, a):
    rows = fetch(cur, "SELECT code, name, qty FROM items WHERE qty < 0 ORDER BY code")
    if not rows:
        return "ok", "لا توجد أصناف برصيد سالب", [], ""
    return "warn", f"{len(rows)} صنف برصيد سالب", \
        [f"{r[0]} {r[1]}: {num(r[2])}" for r in rows], \
        "بيع أكثر من المتاح يشوّه متوسط التكلفة وقيمة المخزون."


def _gl_balance(cur, root, sign):
    """رصيد الحساب وفروعه من القيود المرحّلة + الرصيد الافتتاحي. sign=+1 مدين، -1 دائن."""
    r = fetch(cur, """
        WITH RECURSIVE t AS (
            SELECT code FROM accounts WHERE code = %s
            UNION ALL SELECT a.code FROM accounts a JOIN t ON a.parent_code = t.code)
        SELECT
          COALESCE((SELECT SUM(opening_balance) FROM accounts WHERE code IN (SELECT code FROM t)), 0),
          COALESCE((SELECT SUM(l.debit - l.credit) FROM journal_entry_lines l
                    JOIN journal_entries e ON e.id = l.entry_id
                    WHERE e.status = 'posted' AND l.account_code IN (SELECT code FROM t)), 0),
          (SELECT COUNT(*) FROM accounts WHERE code = %s)""", (root, root))[0]
    return float(r[0]), float(r[1]) * 1.0, int(r[2])


def chk_inventory_value(cur, a):
    opening, movement, exists = _gl_balance(cur, a.inventory_account, +1)
    if not exists:
        return "warn", f"حساب المخزون {a.inventory_account} غير موجود", [], ""
    items_val = float(fetch(cur, "SELECT COALESCE(SUM(qty * avg_cost), 0) FROM items")[0][0])
    gl = opening + movement
    diff = items_val - gl
    rows = [f"قيمة المخزون حسب الأصناف (الكمية × متوسط التكلفة): {num(items_val)}",
            f"رصيد حساب {a.inventory_account} في الأستاذ: {num(gl)} (افتتاحي {num(opening)} + حركة {num(movement)})",
            f"الفرق: {num(diff)}"]
    tol = max(1.0, 0.001 * abs(gl))
    if abs(diff) <= tol:
        return "ok", "قيمة المخزون تطابق الأستاذ (ضمن تسامح التقريب)", rows, ""
    return "warn", "قيمة المخزون لا تطابق رصيد حساب المخزون في الأستاذ", rows, \
        "أسباب شائعة: مخزون افتتاحي بلا قيد، أو تسويات كميات بلا قيد، أو فروق تقريب متراكمة."


def chk_supplier_balances(cur, a):
    rows = fetch(cur, """
        WITH gl AS (
            SELECT l.account_code, SUM(l.credit - l.debit) bal
            FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
            WHERE e.status = 'posted' GROUP BY l.account_code),
        docs AS (
            SELECT s.account_code,
              COALESCE((SELECT SUM(p.total) FROM purchase_invoices p
                        WHERE p.supplier_code = s.code AND p.status <> 'cancelled'), 0)
            - COALESCE((SELECT SUM(r.total) FROM purchase_returns r
                        WHERE r.supplier_code = s.code AND r.status <> 'cancelled'), 0)
            - COALESCE((SELECT SUM(y.amount) FROM supplier_payments y
                        WHERE y.supplier_code = s.code AND y.status <> 'cancelled'), 0) AS bal
            FROM suppliers s WHERE s.account_code IS NOT NULL)
        SELECT d.account_code, COALESCE(MAX(ac.name_ar), ''), SUM(d.bal), COALESCE(MAX(g.bal), 0)
        FROM docs d
        LEFT JOIN gl g ON g.account_code = d.account_code
        LEFT JOIN accounts ac ON ac.code = d.account_code
        GROUP BY d.account_code
        HAVING ABS(SUM(d.bal) - COALESCE(MAX(g.bal), 0)) > 0.01
        ORDER BY d.account_code""")
    if not rows:
        return "ok", "أرصدة الموردين في الأستاذ تطابق (فواتير − مرتجعات − دفعات)", [], ""
    return "warn", f"{len(rows)} حساب مورد رصيده في الأستاذ يختلف عن مستنداته", \
        [f"{r[0]} {r[1]}: حسب المستندات {num(r[2])} / في الأستاذ {num(r[3])} (فرق {num(float(r[3]) - float(r[2]))})"
         for r in rows], \
        "أسباب شائعة: قيد يدوي على حساب المورد، أو رصيد افتتاحي، أو مستند بلا قيد."


def chk_grni(cur, a):
    _, movement, exists = _gl_balance(cur, a.grni_account, -1)
    if not exists:
        return "info", f"حساب البضاعة المستلمة غير المفوترة {a.grni_account} غير موجود", [], ""
    gl = -movement  # رصيد دائن
    pending = float(fetch(cur, """
        SELECT COALESCE(SUM(total), 0) FROM goods_receipts
        WHERE invoice_status = 'not_invoiced' AND journal_entry_id IS NOT NULL""")[0][0])
    rows = [f"رصيد حساب {a.grni_account} (دائن): {num(gl)}",
            f"إجمالي إيصالات الاستلام غير المفوترة: {num(pending)}",
            f"الفرق: {num(gl - pending)}"]
    if abs(gl - pending) <= 1.0:
        return "ok", "حساب البضاعة المستلمة غير المفوترة يطابق الإيصالات غير المفوترة", rows, ""
    return "warn", "حساب البضاعة المستلمة غير المفوترة لا يطابق الإيصالات المعلّقة", rows, \
        "قد ينتج عن اختلاف سعر الفاتورة عن سعر الاستلام، أو إيصالات قديمة بلا قيد."


CHECKS = [
    ("الميزان العام", chk_global_totals),
    ("توازن القيود", chk_unbalanced_entries),
    ("إجمالي القيود", chk_entry_total),
    ("قيود بلا أسطر", chk_entries_without_lines),
    ("مستندات بلا قيد", chk_docs_missing_entry),
    ("حالة المستند والقيد", chk_docs_entry_state),
    ("مبلغ المستند والقيد", chk_docs_amount),
    ("قيد مشترك", chk_shared_entries),
    ("كمية الصنف وحركاته", chk_stock_vs_moves),
    ("الكمية والمستودعات", chk_warehouse_stock),
    ("مخزون سالب", chk_negative_stock),
    ("قيمة المخزون", chk_inventory_value),
    ("أرصدة الموردين", chk_supplier_balances),
    ("البضاعة غير المفوترة", chk_grni),
]


def run_checks(cur, args):
    results = []
    for name, fn in CHECKS:
        try:
            level, title, rows, hint = fn(cur, args)
        except Exception as exc:  # جدول ناقص أو بنية مختلفة
            level, title, rows, hint = "warn", f"{name}: تعذّر الفحص", [str(exc).strip().splitlines()[0]], ""
        results.append((name, level, title, rows, hint))
    return results


def print_report(results, limit):
    counts = {"ok": 0, "error": 0, "warn": 0, "info": 0}
    for name, level, title, rows, hint in results:
        counts[level] += 1
        print(f"{LABELS[level]} {title}")
        if level != "ok" or (level == "ok" and rows and name in ("الميزان العام", "قيمة المخزون")):
            shown = rows if limit == 0 else rows[:limit]
            for r in shown:
                print("            -", r)
            if limit and len(rows) > limit:
                print(f"            ... و{len(rows) - limit} أخرى (استخدم --limit 0 لعرضها كلها)")
            if hint and level in ("error", "warn"):
                print("            ملاحظة:", hint)
    print("\n" + "=" * 60)
    print(f"النتيجة: {counts['ok']} سليم | {counts['error']} خطأ | {counts['warn']} تنبيه | {counts['info']} معلومة")
    if counts["error"]:
        print("يوجد أخطاء تستحق الفحص. أرسل لي هذا التقرير ولا تعدّل شيئاً قبل ذلك.")
    return counts


def main(argv=None):
    ap = argparse.ArgumentParser(description="فحص سلامة الحسابات والمخزون (قراءة فقط)")
    ap.add_argument("--limit", type=int, default=10, help="أقصى عدد أمثلة لكل فحص (0 = الكل)")
    ap.add_argument("--inventory-account", default="123")
    ap.add_argument("--grni-account", default="217")
    args = ap.parse_args(argv)
    url = load_database_url()
    if not url:
        sys.exit("لم أجد DATABASE_URL (لا في البيئة ولا في backend/.env)")
    conn = connect_readonly(url)
    cur = conn.cursor()
    print("فحص سلامة الحسابات والمخزون — قراءة فقط، لا يغيّر أي بيانات\n")
    counts = print_report(run_checks(cur, args), args.limit)
    conn.close()
    return 1 if counts["error"] else 0


if __name__ == "__main__":
    sys.exit(main())