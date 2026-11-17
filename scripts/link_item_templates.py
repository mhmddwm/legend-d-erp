# -*- coding: utf-8 -*-
"""
ربط الأصناف بقوالب الوحدات دفعة واحدة — LEGEND D ERP (PF-01.6.2)
================================================================
المشكلة: الصنف المحفوظ بلا قالب وحدات (unit_template فارغ) لا تظهر له «كرتون» في
طلب الشراء إذا كان أكثر من قالب يشترك في الوحدة الأساسية نفسها (مثل «حبة»).

الخطوات (من مجلد backend):
    1) تصدير الأصناف غير المرتبطة إلى ملف CSV:
         python ../scripts/link_item_templates.py export
    2) افتح الملف في Excel واكتب اسم القالب (أو كوده) في عمود «القالب_الجديد» لكل صنف.
       اترك الخانة فارغة للصنف الذي لا تريد ربطه الآن.
    3) تجربة بلا حفظ (الافتراضي — يعرض ما سيحدث ويتحقق من الأخطاء):
         python ../scripts/link_item_templates.py apply --file items_unit_templates.csv
    4) التنفيذ الفعلي بعد أخذ نسخة احتياطية:
         python ../scripts/link_item_templates.py apply --file items_unit_templates.csv --commit
    تقرير الحالة في أي وقت (قراءة فقط):
         python ../scripts/link_item_templates.py report

القواعد التي تفرضها الأداة (نفس قواعد الخادم):
    - القالب يجب أن يكون موجوداً.
    - الوحدة الأساسية للقالب يجب أن تطابق وحدة الصنف.
    - عند وجود أي خطأ لا يُنفَّذ شيء (إلا مع --skip-errors).
"""
import argparse
import csv
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
COLS = ["كود_الصنف", "اسم_الصنف", "الوحدة", "القالب_الحالي", "قوالب_مناسبة", "القالب_الجديد"]


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


def make_engine(url=None):
    from sqlalchemy import create_engine
    url = url or load_database_url()
    if not url:
        sys.exit("DATABASE_URL غير موجود. ضعه في backend/.env أو في متغير البيئة.")
    kwargs = {}
    local = "localhost" in url or "127.0.0.1" in url or url.startswith("sqlite")
    if not local and "sslmode=" not in url:
        kwargs["connect_args"] = {"sslmode": "require"}
    return create_engine(url, **kwargs)


def norm(v):
    return " ".join(str(v or "").split()).casefold()


def load_templates(conn):
    from sqlalchemy import text
    rows = conn.execute(text(
        "SELECT code, name, base_unit, higher_unit, factor FROM unit_templates ORDER BY code")).fetchall()
    return [dict(code=r[0], name=r[1], base=r[2], higher=r[3], factor=r[4]) for r in rows]


def find_template(key, tpls):
    key = str(key or "").strip()
    if not key:
        return None
    nk = norm(key)
    return next((t for t in tpls if t["code"] == key or norm(t["name"]) == nk), None)


def candidates(unit, tpls):
    return [t for t in tpls if norm(t["base"]) == norm(unit)]


def classify(conn):
    """يعيد (items, problems) حيث problems قاموس بأنواع المشاكل."""
    from sqlalchemy import text
    tpls = load_templates(conn)
    items = conn.execute(text(
        "SELECT code, name, unit, unit_template FROM items WHERE is_active = :a ORDER BY code"),
        {"a": True}).fetchall()
    out = {"unlinked_ambiguous": [], "unlinked_single": [], "unknown_template": [], "base_mismatch": []}
    for code, name, unit, ut in items:
        ut = (ut or "").strip()
        if not ut:
            c = candidates(unit, tpls)
            if len(c) > 1:
                out["unlinked_ambiguous"].append((code, name, unit, ut))
            elif len(c) == 1:
                out["unlinked_single"].append((code, name, unit, ut))
            continue
        t = find_template(ut, tpls)
        if not t:
            out["unknown_template"].append((code, name, unit, ut))
        elif norm(t["base"]) != norm(unit):
            out["base_mismatch"].append((code, name, unit, ut))
    return tpls, items, out


def cmd_report(args):
    eng = make_engine()
    with eng.connect() as conn:
        tpls, items, p = classify(conn)
    print(f"قوالب الوحدات: {len(tpls)} | الأصناف النشطة: {len(items)}")
    labels = {
        "unlinked_ambiguous": "بلا قالب وأكثر من قالب يناسب وحدتها (هذه التي تُظهر «حبة» فقط)",
        "unlinked_single": "بلا قالب ويوجد قالب واحد يناسبها (يُستدل عليه تلقائياً، يُنصح بربطها)",
        "unknown_template": "مرتبطة باسم قالب غير موجود (غالباً أُعيدت تسميته أو حُذف)",
        "base_mismatch": "وحدة الصنف لا تطابق الوحدة الأساسية لقالبه",
    }
    bad = 0
    for k, label in labels.items():
        rows = p[k]
        print(f"[{len(rows):>4}] {label}")
        for code, name, unit, ut in rows[:10]:
            print(f"        - {code} {name} | الوحدة: {unit} | القالب: {ut or '-'}")
        if len(rows) > 10:
            print(f"        ... و{len(rows) - 10} أخرى (استخدم export لرؤيتها كلها)")
        if k != "unlinked_single":
            bad += len(rows)
    return 1 if bad else 0


def cmd_export(args):
    eng = make_engine()
    with eng.connect() as conn:
        tpls, items, p = classify(conn)
    rows = p["unlinked_ambiguous"] + p["unlinked_single"] + p["unknown_template"] + p["base_mismatch"]
    rows.sort(key=lambda r: r[0])
    with open(args.out, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(COLS)
        for code, name, unit, ut in rows:
            cands = " | ".join(t["name"] for t in candidates(unit, tpls))
            w.writerow([code, name, unit, ut, cands, ""])
    print(f"تم تصدير {len(rows)} صنف إلى: {args.out}")
    print("\nقوالب الوحدات المتاحة:")
    for t in tpls:
        print(f"  - {t['name']}  (كود {t['code']}): {t['base']} -> {t['higher'] or '-'}  ×{t['factor']}")
    print("\nاكتب اسم القالب في عمود «القالب_الجديد» ثم شغّل apply.")
    return 0


def read_plan(path):
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def cmd_apply(args):
    from sqlalchemy import text
    plan = read_plan(args.file)
    eng = make_engine()
    errors, updates = [], []
    with eng.connect() as conn:
        tpls = load_templates(conn)
        for i, row in enumerate(plan, start=2):
            code = str(row.get("كود_الصنف", "")).strip()
            want = str(row.get("القالب_الجديد", "")).strip()
            if not code or not want:
                continue
            item = conn.execute(text("SELECT unit, unit_template FROM items WHERE code = :c"), {"c": code}).fetchone()
            if not item:
                errors.append(f"سطر {i}: الصنف {code} غير موجود")
                continue
            t = find_template(want, tpls)
            if not t:
                errors.append(f"سطر {i}: {code} — القالب «{want}» غير موجود")
                continue
            if norm(t["base"]) != norm(item[0]):
                errors.append(f"سطر {i}: {code} — وحدة الصنف «{item[0]}» لا تطابق الوحدة الأساسية للقالب «{t['name']}» ({t['base']})")
                continue
            updates.append((code, t["name"], item[1] or ""))
    print(f"صفوف ستُحدَّث: {len(updates)} | أخطاء: {len(errors)}")
    for e in errors:
        print("  [خطأ]", e)
    for code, name, old in updates[:20]:
        print(f"  {code}: {old or '(بلا قالب)'} -> {name}")
    if len(updates) > 20:
        print(f"  ... و{len(updates) - 20} أخرى")
    if errors and not args.skip_errors:
        print("\nلم يُنفَّذ شيء بسبب الأخطاء. صحّح الملف أو استخدم --skip-errors لتجاوزها.")
        return 1
    if not args.commit:
        print("\n(تجربة فقط — لم يُحفظ شيء. أضف --commit للتنفيذ بعد أخذ نسخة احتياطية.)")
        return 0
    with eng.begin() as conn:  # معاملة واحدة: إما كل التحديثات أو لا شيء
        for code, name, _old in updates:
            conn.execute(text("UPDATE items SET unit_template = :t WHERE code = :c"), {"t": name, "c": code})
    print(f"\nتم تحديث {len(updates)} صنف.")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="ربط الأصناف بقوالب الوحدات")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("report", help="تقرير بحالة ارتباط الأصناف بالقوالب (قراءة فقط)").set_defaults(fn=cmd_report)
    e = sub.add_parser("export", help="تصدير الأصناف التي تحتاج ربطاً إلى CSV")
    e.add_argument("--out", default="items_unit_templates.csv")
    e.set_defaults(fn=cmd_export)
    a = sub.add_parser("apply", help="تطبيق الملف (تجربة افتراضياً)")
    a.add_argument("--file", required=True)
    a.add_argument("--commit", action="store_true", help="نفّذ فعلياً")
    a.add_argument("--skip-errors", action="store_true", help="تجاوز الصفوف الخاطئة ونفّذ الصحيحة")
    a.set_defaults(fn=cmd_apply)
    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
