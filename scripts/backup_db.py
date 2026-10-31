# -*- coding: utf-8 -*-
"""
النسخ الاحتياطي والاستعادة — LEGEND D ERP (PF-01.4)
====================================================
لا تحتاج أي برنامج إضافي (لا pg_dump). تنتج ملفاً واحداً مضغوطاً:
    backups/legend_backup_YYYYMMDD_HHMMSS.zip
يحوي: بيانات كل جدول (CSV) + بنية القاعدة (schema.sql) + manifest.json (أعداد وبصمات).
النسخة لقطة واحدة متسقة من القاعدة (كل الجداول في نفس اللحظة).

الأوامر (من المجلد الرئيسي للمشروع):
    python scripts/backup_db.py backup                 إنشاء نسخة جديدة (قراءة فقط من القاعدة)
    python scripts/backup_db.py list                   عرض النسخ الموجودة
    python scripts/backup_db.py verify FILE.zip        فحص سلامة ملف نسخة (بدون القاعدة)
    python scripts/backup_db.py restore FILE.zip --wipe
                                                       استعادة فوق قاعدة بها بيانات (تُمسح ثم تُحمَّل)
    python scripts/backup_db.py restore FILE.zip --create-schema
                                                       استعادة في قاعدة فارغة تماماً (تُنشأ البنية أيضاً)

الأمان:
  • الاستعادة تتم كلها في معاملة واحدة: إما تنجح كاملة أو تتراجع ولا يتغير شيء.
  • قبل مسح أي بيانات تُنشأ تلقائياً نسخة أمان باسم pre_restore_...
  • الملف يحوي بياناتك المالية وتجزئات كلمات المرور: لا ترفعه إلى GitHub ولا تشاركه.
  • النسخة تشمل قاعدة البيانات فقط، لا الملفات المرفقة المخزّنة في Supabase Storage.
"""
import argparse
import csv
import hashlib
import io
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from collections import defaultdict
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.normpath(os.path.join(HERE, ".."))
DEFAULT_OUT = os.path.join(PROJECT_ROOT, "backups")
TOOL_VERSION = 1
NAME_RE = re.compile(r"^(legend_backup|pre_restore)_\d{8}_\d{6}\.zip$")
SEQ_RE = re.compile(r"nextval\('([^']+)'::regclass\)")


# ------------------------------------------------------------------ الاتصال
def load_database_url():
    url = os.getenv("DATABASE_URL", "").strip()
    if url:
        return url
    env_path = os.path.join(PROJECT_ROOT, "backend", ".env")
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("DATABASE_URL="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def _connect_kwargs(url):
    local = "localhost" in url or "127.0.0.1" in url or "host=/" in url
    return {} if local or "sslmode=" in url else {"sslmode": "require"}


def connect(url, readonly_snapshot=False):
    try:
        import psycopg2
    except ImportError:
        sys.exit("psycopg2 غير مثبّت. نفّذ: pip install -r requirements.txt (من مجلد backend)")
    conn = psycopg2.connect(url, **_connect_kwargs(url))
    if readonly_snapshot:
        conn.set_session(isolation_level="REPEATABLE READ", readonly=True, autocommit=False)
    return conn


def qi(name):
    return '"' + name.replace('"', '""') + '"'


# ------------------------------------------------------------ بنية القاعدة
def list_tables(cur):
    cur.execute("""SELECT table_name FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                   ORDER BY table_name""")
    return [r[0] for r in cur.fetchall()]


def fk_edges(cur, tables):
    """(الجدول التابع، الجدول المرجعي) لكل مفتاح أجنبي بين جداول القائمة."""
    cur.execute("""SELECT c.conrelid::regclass::text, c.confrelid::regclass::text
                   FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
                   WHERE c.contype = 'f' AND n.nspname = 'public'""")
    ts = set(tables)
    out = set()
    for child, parent in cur.fetchall():
        child = child.replace("public.", "", 1).strip('"')
        parent = parent.replace("public.", "", 1).strip('"')
        if child in ts and parent in ts and child != parent:
            out.add((child, parent))
    return out


def load_order(tables, edges):
    """ترتيب تحميل آمن للمفاتيح الأجنبية (الأب قبل الابن)."""
    deps = defaultdict(set)
    for child, parent in edges:
        deps[child].add(parent)
    done, order, remaining = set(), [], sorted(tables)
    while remaining:
        ready = [t for t in remaining if deps[t] <= done]
        if not ready:
            raise RuntimeError("علاقات دائرية بين الجداول: " + ", ".join(remaining))
        order.extend(ready)
        done.update(ready)
        remaining = [t for t in remaining if t not in done]
    return order


def export_schema(url):
    """يولّد DDL من القاعدة الحية بالانعكاس (reflection) عبر SQLAlchemy."""
    from sqlalchemy import MetaData, create_engine
    from sqlalchemy.dialects import postgresql
    from sqlalchemy.schema import CreateIndex, CreateTable

    engine = create_engine(url, connect_args=_connect_kwargs(url))
    try:
        md = MetaData()
        md.reflect(bind=engine, schema=None, views=False)
    finally:
        engine.dispose()
    dialect = postgresql.dialect()
    seqs, owned, table_sql = [], [], []
    for t in md.sorted_tables:
        ddl = str(CreateTable(t).compile(dialect=dialect)).strip() + ";"
        for col in t.columns:
            d = str(col.server_default.arg) if col.server_default is not None else ""
            m = SEQ_RE.search(d)
            # العمود المعروض كـ SERIAL ينشئ تسلسله بنفسه (باسم <جدول>_<عمود>_seq)؛
            # فلا نُنشئ تسلسلاً مكرراً له. التسلسلات الأخرى تُنشأ صراحةً قبل الجداول.
            if m and not re.search(rf"\b{re.escape(col.name)} (BIG|SMALL)?SERIAL\b", ddl):
                seqs.append(m.group(1))
                owned.append((m.group(1), t.name, col.name))
        table_sql.append((t, ddl))
    out = ["-- LEGEND D ERP: بنية القاعدة (مولَّدة آلياً بالانعكاس)", ""]
    for sq in dict.fromkeys(seqs):
        out.append(f"CREATE SEQUENCE IF NOT EXISTS {sq};")
    if seqs:
        out.append("")
    for t, ddl in table_sql:
        out.append(ddl)
        for ix in sorted(t.indexes, key=lambda i: i.name or ""):
            out.append(str(CreateIndex(ix, if_not_exists=True).compile(dialect=dialect)).strip() + ";")
        out.append("")
    for seq, tbl, col in owned:
        out.append(f"ALTER SEQUENCE {seq} OWNED BY {qi(tbl)}.{qi(col)};")
    return "\n".join(out) + "\n"


# ----------------------------------------------------------------- ملفات
def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def count_csv_rows(fileobj):
    reader = csv.reader(io.TextIOWrapper(fileobj, encoding="utf-8", newline=""))
    next(reader, None)  # الترويسة
    return sum(1 for _ in reader)


def csv_header(zf, name):
    with zf.open(name) as fh:
        reader = csv.reader(io.TextIOWrapper(fh, encoding="utf-8", newline=""))
        return next(reader)


def human(n):
    return f"{n / 1024:,.0f} KB" if n < 1 << 20 else f"{n / (1 << 20):,.1f} MB"


# ------------------------------------------------------------------ الأوامر
def make_backup(url, out_dir, prefix="legend_backup"):
    os.makedirs(out_dir, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_path = os.path.join(out_dir, f"{prefix}_{stamp}.zip")
    n = 1
    while os.path.exists(zip_path):  # نسختان في نفس الثانية
        n += 1
        zip_path = os.path.join(out_dir, f"{prefix}_{stamp}_{n}.zip")

    conn = connect(url, readonly_snapshot=True)
    tmp = tempfile.mkdtemp(prefix="legend_bk_")
    try:
        cur = conn.cursor()
        cur.execute("SELECT 1")  # يبدأ اللقطة المتسقة
        tables = list_tables(cur)
        tables_info = {}
        for t in tables:
            cur.execute(f"SELECT COUNT(*) FROM {qi(t)}")
            rows = cur.fetchone()[0]
            path = os.path.join(tmp, f"{t}.csv")
            with open(path, "wb") as fh:
                cur.copy_expert(f"COPY (SELECT * FROM {qi(t)}) TO STDOUT WITH (FORMAT csv, HEADER true)", fh)
            tables_info[t] = {"rows": rows, "sha256": sha256_of(path)}
        cur.execute("SELECT current_database()")
        dbname = cur.fetchone()[0]
        last_mig = None
        if "schema_migrations" in tables:
            cur.execute("SELECT MAX(version) FROM schema_migrations")
            last_mig = cur.fetchone()[0]
        edges = fk_edges(cur, tables)
        order = load_order(tables, edges)
        conn.rollback()
    finally:
        conn.close()

    schema_ok = True
    try:
        schema_sql = export_schema(url)
    except Exception as exc:  # نوع غير مألوف مثلاً: لا نُفشل نسخ البيانات بسببه
        schema_ok = False
        schema_sql = "-- تعذّر توليد البنية: " + str(exc).strip().splitlines()[0] + "\n"
    with open(os.path.join(tmp, "schema.sql"), "w", encoding="utf-8") as fh:
        fh.write(schema_sql)
    manifest = {
        "tool_version": TOOL_VERSION,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "database": dbname,
        "last_migration": last_mig,
        "schema_ok": schema_ok,
        "load_order": order,
        "tables": tables_info,
        "schema_sha256": sha256_of(os.path.join(tmp, "schema.sql")),
    }
    with open(os.path.join(tmp, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(os.path.join(tmp, "manifest.json"), "manifest.json")
        zf.write(os.path.join(tmp, "schema.sql"), "schema.sql")
        for t in tables:
            zf.write(os.path.join(tmp, f"{t}.csv"), f"{t}.csv")
    shutil.rmtree(tmp, ignore_errors=True)
    return zip_path, manifest


def verify_zip(zip_path):
    """يرجع (ok, errors, manifest). لا يلمس القاعدة."""
    errors = []
    try:
        zf = zipfile.ZipFile(zip_path)
    except Exception as exc:
        return False, [f"الملف ليس نسخة صالحة: {exc}"], None
    with zf:
        bad = zf.testzip()
        if bad:
            errors.append(f"ملف تالف داخل الأرشيف: {bad}")
        try:
            manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        except Exception:
            return False, errors + ["manifest.json مفقود أو تالف"], None
        names = set(zf.namelist())
        if "schema.sql" not in names:
            errors.append("schema.sql مفقود")
        elif hashlib.sha256(zf.read("schema.sql")).hexdigest() != manifest.get("schema_sha256"):
            errors.append("schema.sql تغيّر محتواه (البصمة لا تطابق)")
        for t, info in manifest["tables"].items():
            name = f"{t}.csv"
            if name not in names:
                errors.append(f"{name} مفقود")
                continue
            h = hashlib.sha256()
            with zf.open(name) as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b""):
                    h.update(chunk)
            if h.hexdigest() != info["sha256"]:
                errors.append(f"{name}: البصمة لا تطابق (الملف تغيّر أو تلف)")
                continue
            with zf.open(name) as fh:
                actual = count_csv_rows(fh)
            if actual != info["rows"]:
                errors.append(f"{name}: عدد الصفوف {actual} بدل {info['rows']}")
    return not errors, errors, manifest


def cmd_backup(args):
    url = load_database_url()
    if not url:
        sys.exit("لم أجد DATABASE_URL (لا في البيئة ولا في backend/.env)")
    print("جارٍ أخذ نسخة احتياطية (قراءة فقط، لا يتغير شيء في القاعدة)...")
    path, manifest = make_backup(url, args.out)
    ok, errors, _ = verify_zip(path)
    total = sum(i["rows"] for i in manifest["tables"].values())
    print(f"\nالقاعدة: {manifest['database']} | الجداول: {len(manifest['tables'])} | السجلات: {total:,}")
    for t, info in manifest["tables"].items():
        if info["rows"]:
            print(f"   {t:32} {info['rows']:>8,}")
    print(f"\nالملف: {path}  ({human(os.path.getsize(path))})")
    if not manifest.get("schema_ok", True):
        print("[تنبيه] لم تُولَّد بنية القاعدة (schema.sql)؛ البيانات محفوظة كاملة، لكن الاستعادة في قاعدة")
        print("        فارغة (--create-schema) غير متاحة من هذه النسخة. الاستعادة فوق قاعدتك الحالية (--wipe) تعمل.")
    if not ok:
        print("[خطأ] فشل فحص النسخة بعد إنشائها:")
        for e in errors:
            print("   -", e)
        return 2
    print("[سليم] تم فحص النسخة (البصمات وأعداد السجلات) وهي صالحة.")
    print("انسخ هذا الملف إلى مكان آمن خارج الجهاز (قرص خارجي أو تخزين سحابي خاص).")
    return 0


def cmd_list(args):
    if not os.path.isdir(args.out):
        print("لا توجد نسخ بعد.")
        return 0
    files = sorted(f for f in os.listdir(args.out) if NAME_RE.match(f) or f.endswith(".zip"))
    if not files:
        print("لا توجد نسخ بعد.")
    for f in files:
        p = os.path.join(args.out, f)
        print(f"{f:44} {human(os.path.getsize(p)):>10}")
    return 0


def cmd_verify(args):
    ok, errors, manifest = verify_zip(args.file)
    if manifest:
        total = sum(i["rows"] for i in manifest["tables"].values())
        print(f"أُنشئت: {manifest['created_at']} | القاعدة: {manifest['database']} | "
              f"الجداول: {len(manifest['tables'])} | السجلات: {total:,}")
    if ok:
        print("[سليم] النسخة سليمة: كل البصمات وأعداد الصفوف مطابقة.")
        return 0
    print("[خطأ] النسخة غير صالحة:")
    for e in errors:
        print("   -", e)
    return 1


def reset_sequences(cur, tables):
    cur.execute("""SELECT table_name, column_name, column_default FROM information_schema.columns
                   WHERE table_schema = 'public' AND column_default LIKE 'nextval(%%'""")
    for t, col, default in cur.fetchall():
        if t not in tables:
            continue
        m = SEQ_RE.search(default)
        if m:
            cur.execute(f"SELECT setval(%s, COALESCE((SELECT MAX({qi(col)}) FROM {qi(t)}), 0) + 1, false)",
                        (m.group(1),))


def cmd_restore(args):
    ok, errors, manifest = verify_zip(args.file)
    if not ok:
        print("[خطأ] لن أستعيد من نسخة غير سليمة:")
        for e in errors:
            print("   -", e)
        return 1
    if args.create_schema and not manifest.get("schema_ok", True):
        sys.exit("هذه النسخة بلا بنية قاعدة (تعذّر توليدها وقت النسخ)؛ لا يمكن استخدام --create-schema معها.")
    if args.create_schema and args.wipe:
        sys.exit("اختر واحداً فقط: --create-schema (لقاعدة فارغة) أو --wipe (لقاعدة بها بيانات).")
    if not args.create_schema and not args.wipe:
        sys.exit("حدّد --wipe (مسح البيانات الحالية ثم الاستعادة) أو --create-schema (لقاعدة فارغة تماماً).")
    url = load_database_url()
    if not url:
        sys.exit("لم أجد DATABASE_URL")
    conn = connect(url)
    cur = conn.cursor()
    try:
        # إن كانت جلسة أخرى تمسك قفلاً على الجداول نفشل بوضوح بدل الانتظار إلى الأبد
        cur.execute(f"SET lock_timeout = '{int(args.lock_timeout) * 1000}ms'")
        cur.execute("SELECT current_database()")
        dbname = cur.fetchone()[0]
        live = set(list_tables(cur))
        wanted = list(manifest["tables"].keys())
        if args.create_schema:
            if live:
                sys.exit(f"القاعدة «{dbname}» ليست فارغة ({len(live)} جدول). --create-schema لقاعدة فارغة فقط.")
        else:
            missing = [t for t in wanted if t not in live]
            if missing:
                sys.exit("جداول النسخة غير موجودة في القاعدة: " + ", ".join(missing[:8]) +
                         "\nإن كانت القاعدة جديدة وفارغة فاستخدم --create-schema.")
        current = {}
        for t in (live if not args.create_schema else []):
            cur.execute(f"SELECT COUNT(*) FROM {qi(t)}")
            current[t] = cur.fetchone()[0]

        print(f"القاعدة الهدف: {dbname}")
        print(f"النسخة: أُنشئت {manifest['created_at']} من قاعدة «{manifest['database']}»")
        if not args.create_schema:
            print("\nالحالة الحالية ← بعد الاستعادة (سجلات):")
            for t in wanted:
                a, b = current.get(t, 0), manifest["tables"][t]["rows"]
                if a or b:
                    print(f"   {t:32} {a:>8,} ← {b:>8,}")
            extra = sorted(live - set(wanted))
            if extra:
                print("\nجداول في القاعدة ليست في النسخة (لن تُمسّ): " + ", ".join(extra))
        if not args.yes:
            print("\nتحذير: هذا يستبدل بيانات القاعدة بمحتوى النسخة.")
            if input("للمتابعة اكتب RESTORE بالأحرف الكبيرة: ").strip() != "RESTORE":
                print("أُلغي. لم يتغير شيء.")
                return 1

        if args.wipe and any(current.values()):
            print("\nجارٍ أخذ نسخة أمان من الوضع الحالي قبل المسح...")
            safety, _ = make_backup(url, args.out, prefix="pre_restore")
            print("نسخة الأمان:", safety)

        if args.create_schema:
            with zipfile.ZipFile(args.file) as zf:
                cur.execute(zf.read("schema.sql").decode("utf-8"))
        order = load_order(wanted, fk_edges(cur, wanted))
        if args.wipe:
            cur.execute("TRUNCATE " + ", ".join(qi(t) for t in wanted))  # بلا CASCADE عمداً
        with zipfile.ZipFile(args.file) as zf:
            for t in order:
                cols = csv_header(zf, f"{t}.csv")
                with zf.open(f"{t}.csv") as fh:
                    cur.copy_expert(
                        f"COPY {qi(t)} ({', '.join(qi(c) for c in cols)}) FROM STDIN WITH (FORMAT csv, HEADER true)", fh)
        reset_sequences(cur, set(wanted))
        for t in wanted:  # تحقق قبل الاعتماد
            cur.execute(f"SELECT COUNT(*) FROM {qi(t)}")
            got = cur.fetchone()[0]
            if got != manifest["tables"][t]["rows"]:
                raise RuntimeError(f"{t}: حُمِّل {got} بدل {manifest['tables'][t]['rows']}")
        conn.commit()
    except SystemExit:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        msg = str(exc).strip().splitlines()[0]
        print(f"[خطأ] فشلت الاستعادة وتم التراجع عن كل شيء: {msg}")
        if "lock timeout" in msg.lower():
            print("جلسة أخرى تستخدم الجداول الآن (مثلاً الخادم أو شاشة مفتوحة). أوقف السيرفر وأعد المحاولة.")
        return 2
    finally:
        conn.close()
    print("\n[سليم] اكتملت الاستعادة وتطابقت أعداد السجلات مع النسخة.")
    print("شغّل بعدها: python scripts/check_integrity.py")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="نسخ احتياطي واستعادة لقاعدة LEGEND D ERP")
    ap.add_argument("--out", default=DEFAULT_OUT, help="مجلد النسخ (الافتراضي backups)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("backup")
    sub.add_parser("list")
    v = sub.add_parser("verify")
    v.add_argument("file")
    r = sub.add_parser("restore")
    r.add_argument("file")
    r.add_argument("--wipe", action="store_true", help="امسح بيانات الجداول الحالية ثم استعد")
    r.add_argument("--create-schema", action="store_true", help="لقاعدة فارغة: أنشئ البنية ثم استعد")
    r.add_argument("--yes", action="store_true", help="تخطَّ سؤال التأكيد (للاختبارات)")
    r.add_argument("--lock-timeout", type=int, default=15,
                   help="ثوانٍ للانتظار على قفل تمسكه جلسة أخرى قبل الفشل (الافتراضي 15)")
    args = ap.parse_args(argv)
    return {"backup": cmd_backup, "list": cmd_list, "verify": cmd_verify,
            "restore": cmd_restore}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())