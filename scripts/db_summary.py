# -*- coding: utf-8 -*-
"""ملخص محتوى القاعدة (قراءة فقط): كم سجلاً في كل جدول رئيسي، وحالات القيود."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load_url():
    url = os.getenv("DATABASE_URL", "").strip()
    if url:
        return url
    path = os.path.normpath(os.path.join(HERE, "..", "backend", ".env"))
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("DATABASE_URL="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def main():
    import psycopg2
    url = load_url()
    if not url:
        sys.exit("لم أجد DATABASE_URL")
    kw = {}
    if "localhost" not in url and "127.0.0.1" not in url and "sslmode=" not in url:
        kw["sslmode"] = "require"
    conn = psycopg2.connect(url, **kw)
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor()

    cur.execute("SELECT current_database(), inet_server_addr()::text")
    db, addr = cur.fetchone()
    print(f"القاعدة: {db}  | الخادم: {addr}\n")

    print("عدد السجلات في الجداول الرئيسية:")
    for t in ["accounts", "journal_entries", "journal_entry_lines", "items", "stock_moves",
              "suppliers", "goods_receipts", "purchase_invoices", "supplier_payments",
              "purchase_returns", "customers", "sales_invoices", "sales_returns", "users"]:
        try:
            cur.execute(f"SELECT COUNT(*) FROM {t}")
            print(f"   {t:22} {cur.fetchone()[0]}")
        except Exception as exc:
            print(f"   {t:22} تعذّر ({str(exc).splitlines()[0]})")

    print("\nالقيود حسب الحالة:")
    try:
        cur.execute("SELECT status, COUNT(*), MIN(entry_date), MAX(entry_date) "
                    "FROM journal_entries GROUP BY status ORDER BY 2 DESC")
        rows = cur.fetchall()
        for r in rows or []:
            print(f"   {r[0]!s:12} {r[1]:6} قيد   من {r[2]} إلى {r[3]}")
        if not rows:
            print("   لا توجد قيود")
    except Exception as exc:
        print("   تعذّر:", str(exc).splitlines()[0])

    print("\nأصناف بكمية غير صفرية:")
    try:
        cur.execute("SELECT COUNT(*) FILTER (WHERE qty <> 0), COUNT(*) FROM items")
        a, b = cur.fetchone()
        print(f"   {a} من أصل {b}")
    except Exception as exc:
        print("   تعذّر:", str(exc).splitlines()[0])
    conn.close()


if __name__ == "__main__":
    main()