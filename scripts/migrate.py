# -*- coding: utf-8 -*-
"""
مُشغِّل الهجرات — LEGEND D ERP (PF-01.4)
=========================================
الأوامر (من مجلد backend وبعد تفعيل البيئة):

  python ../scripts/migrate.py check               فحص ملفات الهجرات (بدون قاعدة بيانات)
  python ../scripts/migrate.py status              ما المطبَّق وما المعلَّق على القاعدة
  python ../scripts/migrate.py apply --dry-run     عرض ما سيُنفَّذ دون تنفيذ
  python ../scripts/migrate.py apply               تنفيذ المعلَّق بالترتيب (يطلب تأكيداً)
  python ../scripts/migrate.py baseline --only 002,003,005
  python ../scripts/migrate.py baseline --through 033
                                                   تسجيل ملفات كمطبَّقة دون تشغيلها
                                                   (لقاعدة قائمة تعرف أنها محدّثة)

القواعد:
  • الترتيب = ترتيب اسم الملف أبجدياً (الرقم أولاً). الأرقام المكررة القديمة
    (022 و023 و024) تبقى كما هي لأن أسماءها مسجَّلة في قاعدتك؛ أي هجرة جديدة
    يجب أن تحمل رقماً فريداً.
  • يُسجَّل كل ملف في جدول schema_migrations مع بصمة (checksum) لكشف أي تعديل
    على هجرة طُبِّقت سابقاً.
  • الملف بلا BEGIN/COMMIT يُنفَّذ كله أو لا شيء. عند أول فشل يتوقف المُشغِّل ولا
    يسجّل الملف الفاشل.
  • يقرأ DATABASE_URL من البيئة أو من backend/.env.
"""
import argparse
import hashlib
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DIR = os.path.normpath(os.path.join(HERE, "..", "database", "migrations"))

NAME_RE = re.compile(r"^(\d{3})_[a-z0-9_]+\.sql$")
MAX_VERSION_LEN = 50                      # عرض عمود schema_migrations.version
GRANDFATHERED_DUP_PREFIXES = {"022", "023", "024"}  # أرقام مكررة قديمة مسموحة
STRICT_FROM = 34                          # من هذا الرقم تُطبَّق قواعد الحماية الإضافية
DESTRUCTIVE_RE = re.compile(
    r"\b(DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DROP\s+SCHEMA)\b|\bDELETE\s+FROM\s+\w+\s*;",
    re.IGNORECASE,
)
ALLOW_MARKER = "-- migrate: allow-destructive"


# ---------------------------------------------------------------- الملفات
def read_text(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def checksum(text):
    """بصمة مستقلة عن نهايات الأسطر (Windows CRLF مقابل LF)."""
    norm = text.replace("\r\n", "\n").replace("\r", "\n").rstrip() + "\n"
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()


def list_migrations(directory):
    files = sorted(f for f in os.listdir(directory) if f.endswith(".sql"))
    out = []
    for f in files:
        path = os.path.join(directory, f)
        text = read_text(path)
        out.append({"file": f, "version": f[:-4], "path": path,
                    "number": f[:3], "text": text, "checksum": checksum(text)})
    return out


def lint(migs):
    """يرجع (errors, warnings)."""
    errors, warnings = [], []
    by_number = {}
    for m in migs:
        if not NAME_RE.match(m["file"]):
            errors.append(f"{m['file']}: الاسم لا يطابق النمط NNN_اسم_بحروف_صغيرة.sql")
        if len(m["version"]) > MAX_VERSION_LEN:
            errors.append(f"{m['file']}: الاسم أطول من {MAX_VERSION_LEN} حرفاً (حد عمود version)")
        by_number.setdefault(m["number"], []).append(m["file"])
        if not m["text"].strip():
            errors.append(f"{m['file']}: الملف فارغ")
        try:
            strict = int(m["number"]) >= STRICT_FROM
        except ValueError:
            strict = False
        if strict and DESTRUCTIVE_RE.search(m["text"]) and ALLOW_MARKER not in m["text"]:
            errors.append(
                f"{m['file']}: يحوي أمراً مدمّراً (DROP/TRUNCATE/DELETE بلا شرط). "
                f"إن كان مقصوداً أضف السطر: {ALLOW_MARKER}"
            )
    for number, names in sorted(by_number.items()):
        if len(names) > 1:
            if number in GRANDFATHERED_DUP_PREFIXES:
                warnings.append(f"رقم {number} مكرر (قديم ومسموح): {', '.join(names)} — يُنفَّذان بترتيب الاسم")
            else:
                errors.append(f"رقم {number} مكرر ولا يُسمح بتكرار جديد: {', '.join(names)}")
    return errors, warnings


# ------------------------------------------------------------ قاعدة البيانات
def load_database_url():
    url = os.getenv("DATABASE_URL", "").strip()
    if url:
        return url
    env_path = os.path.normpath(os.path.join(HERE, "..", "backend", ".env"))
    if os.path.exists(env_path):
        for line in read_text(env_path).splitlines():
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def connect(url):
    try:
        import psycopg2
    except ImportError:
        sys.exit("psycopg2 غير مثبّت. نفّذ: pip install -r requirements.txt (من مجلد backend)")
    kwargs = {}
    local = "localhost" in url or "127.0.0.1" in url or "host=/" in url
    if not local and "sslmode=" not in url:
        kwargs["sslmode"] = "require"
    conn = psycopg2.connect(url, **kwargs)
    conn.autocommit = True
    return conn


def ensure_tracking(cur):
    cur.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        " version VARCHAR(50) PRIMARY KEY,"
        " applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
    )
    cur.execute("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum VARCHAR(64)")


def applied_map(cur):
    cur.execute("SELECT version, checksum FROM schema_migrations")
    return {v: c for v, c in cur.fetchall()}


def classify(migs, applied):
    rows = []
    for m in migs:
        if m["version"] not in applied:
            state = "pending"
        elif applied[m["version"]] and applied[m["version"]] != m["checksum"]:
            state = "modified"
        else:
            state = "applied"
        rows.append((m, state))
    return rows


def record(cur, m):
    cur.execute(
        "INSERT INTO schema_migrations (version, checksum) VALUES (%s, %s) "
        "ON CONFLICT (version) DO UPDATE SET checksum = EXCLUDED.checksum",
        (m["version"], m["checksum"]),
    )


# ------------------------------------------------------------------ الأوامر
def cmd_check(args):
    migs = list_migrations(args.dir)
    errors, warnings = lint(migs)
    for w in warnings:
        print("[تنبيه]", w)
    for e in errors:
        print("[خطأ]  ", e)
    print(f"{len(migs)} ملف هجرة — {len(errors)} خطأ، {len(warnings)} تنبيه")
    return 1 if errors else 0


def _open(args):
    url = load_database_url()
    if not url:
        sys.exit("لم أجد DATABASE_URL (لا في البيئة ولا في backend/.env)")
    conn = connect(url)
    return conn, conn.cursor()


def cmd_status(args):
    migs = list_migrations(args.dir)
    conn, cur = _open(args)
    ensure_tracking(cur)
    applied = applied_map(cur)
    rows = classify(migs, applied)
    labels = {"applied": "مطبَّقة ", "pending": "معلَّقة ", "modified": "عُدِّلت!"}
    for m, state in rows:
        print(f"  [{labels[state]}] {m['file']}")
    files = {m["version"] for m in migs}
    orphans = sorted(v for v in applied if v not in files)
    for v in orphans:
        print(f"  [بلا ملف ] {v}  (مسجَّلة في القاعدة ولا ملف لها)")
    pend = sum(1 for _, s in rows if s == "pending")
    mod = sum(1 for _, s in rows if s == "modified")
    print(f"\nالمجموع: {len(rows)} | معلَّقة: {pend} | معدَّلة بعد التطبيق: {mod} | يتيمة: {len(orphans)}")
    if mod:
        print("تحذير: ملف طُبِّق سابقاً ثم تغيّر محتواه. لا تعدّل هجرة مطبَّقة، بل أنشئ هجرة جديدة.")
    return 0


def cmd_baseline(args):
    if not args.through and not args.only:
        sys.exit("حدّد --through NNN (كل ما حتى هذا الرقم) أو --only 002,003 (أرقاماً بعينها)")
    only = {x.strip().zfill(3) for x in args.only.split(",")} if args.only else None

    def selected(m):
        if only is not None and m["number"] not in only:
            return False
        return not args.through or m["number"] <= args.through

    migs = list_migrations(args.dir)
    conn, cur = _open(args)
    ensure_tracking(cur)
    applied = applied_map(cur)
    todo = [m for m in migs if selected(m) and m["version"] not in applied]
    # الملفات المسجَّلة سابقاً دون بصمة تُكمَّل بصمتها
    fill = [m for m in migs if selected(m) and m["version"] in applied
            and not applied[m["version"]]]
    if not todo and not fill:
        print("لا شيء لتسجيله.")
        return 0
    for m in todo:
        print(f"  سيُسجَّل كمطبَّق دون تشغيل: {m['file']}")
    for m in fill:
        print(f"  ستُضاف بصمة لمسجَّل سابقاً: {m['file']}")
    if not args.yes and input("اكتب yes للمتابعة: ").strip().lower() != "yes":
        print("أُلغي.")
        return 1
    for m in todo + fill:
        record(cur, m)
    print(f"تم: {len(todo)} سُجِّلت، {len(fill)} أُكملت بصمتها.")
    return 0


def cmd_apply(args):
    migs = list_migrations(args.dir)
    errors, _ = lint(migs)
    if errors:
        for e in errors:
            print("[خطأ]", e)
        sys.exit("أصلح أخطاء الفحص (check) أولاً.")
    conn, cur = _open(args)
    ensure_tracking(cur)
    cur.execute("SELECT pg_try_advisory_lock(727001)")
    if not cur.fetchone()[0]:
        sys.exit("مُشغِّل هجرات آخر يعمل الآن على نفس القاعدة.")
    try:
        rows = classify(migs, applied_map(cur))
        modified = [m for m, s in rows if s == "modified"]
        for m in modified:
            print(f"[تحذير] هجرة مطبَّقة تغيّر محتواها: {m['file']}")
        pending = [m for m, s in rows if s == "pending"]
        if not pending:
            print("لا توجد هجرات معلَّقة. القاعدة محدّثة.")
            return 0
        print("ستُنفَّذ بهذا الترتيب:")
        for m in pending:
            print("   ", m["file"])
        if args.dry_run:
            print("(تجربة فقط — لم يُنفَّذ شيء)")
            return 0
        print("\nتنبيه: خذ نسخة احتياطية من القاعدة قبل المتابعة.")
        if not args.yes and input("اكتب yes للتنفيذ: ").strip().lower() != "yes":
            print("أُلغي.")
            return 1
        for m in pending:
            print(f"-> {m['file']} ...", end=" ", flush=True)
            try:
                cur.execute(m["text"])
            except Exception as exc:
                print("فشل")
                print("   ", str(exc).strip().splitlines()[0])
                print("توقّف التنفيذ. لم يُسجَّل هذا الملف، وما بعده لم يُنفَّذ.")
                return 2
            record(cur, m)
            print("تم")
        print(f"اكتمل: {len(pending)} هجرة.")
        return 0
    finally:
        cur.execute("SELECT pg_advisory_unlock(727001)")


def main(argv=None):
    ap = argparse.ArgumentParser(description="مُشغِّل هجرات LEGEND D ERP")
    ap.add_argument("--dir", default=DEFAULT_DIR, help="مجلد الهجرات (الافتراضي database/migrations)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    sub.add_parser("status")
    a = sub.add_parser("apply")
    a.add_argument("--dry-run", action="store_true")
    a.add_argument("--yes", action="store_true")
    b = sub.add_parser("baseline")
    b.add_argument("--through", help="آخر رقم يُعتبر مطبَّقاً، مثل 033")
    b.add_argument("--only", help="أرقام بعينها مفصولة بفواصل، مثل 002,003,005")
    b.add_argument("--yes", action="store_true")
    args = ap.parse_args(argv)
    return {"check": cmd_check, "status": cmd_status, "apply": cmd_apply,
            "baseline": cmd_baseline}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())