# -*- coding: utf-8 -*-
"""اختبارات مُشغِّل الهجرات. اختبارات القاعدة تحتاج pgserver (Postgres محلي مؤقت):
    pip install pgserver   — وتُتخطّى تلقائياً إن لم يكن مثبتاً.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import migrate  # noqa: E402


def write(d, name, text):
    (d / name).write_text(text, encoding="utf-8")


# ----------------------------------------------------------------- الفحص
def test_real_migrations_pass_lint():
    errors, warnings = migrate.lint(migrate.list_migrations(migrate.DEFAULT_DIR))
    assert errors == []
    assert len(warnings) == 3  # 022/023/024 المكررة القديمة


def test_lint_rejects_new_duplicates_bad_names_and_destructive(tmp_path):
    write(tmp_path, "040_a.sql", "SELECT 1;")
    write(tmp_path, "040_b.sql", "SELECT 2;")
    write(tmp_path, "BadName.sql", "SELECT 3;")
    write(tmp_path, "041_drop.sql", "DROP TABLE accounts;")
    write(tmp_path, "042_ok.sql", "-- migrate: allow-destructive\nDROP TABLE old_stuff;")
    write(tmp_path, "043_delete_all.sql", "DELETE FROM journal_entries;")
    errors, _ = migrate.lint(migrate.list_migrations(str(tmp_path)))
    joined = "\n".join(errors)
    assert "040" in joined and "BadName" in joined
    assert "041_drop" in joined and "043_delete_all" in joined
    assert "042_ok" not in joined


def test_checksum_ignores_line_endings():
    assert migrate.checksum("a\r\nb\r\n") == migrate.checksum("a\nb\n")
    assert migrate.checksum("a\nb\n") != migrate.checksum("a\nc\n")


# --------------------------------------------------------------- القاعدة
@pytest.fixture(scope="module")
def pg(tmp_path_factory):
    pgserver = pytest.importorskip("pgserver")
    srv = pgserver.get_server(str(tmp_path_factory.mktemp("pg")), cleanup_mode="stop")
    yield srv.get_uri()
    srv.cleanup()


@pytest.fixture()
def env(pg, monkeypatch):
    import psycopg2
    monkeypatch.setenv("DATABASE_URL", pg)
    conn = psycopg2.connect(pg)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    yield cur
    conn.close()


def tables(cur):
    cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")
    return {r[0] for r in cur.fetchall()}


def test_apply_in_order_records_checksums_and_is_rerunnable(env, tmp_path, capsys):
    write(tmp_path, "010_a.sql", "CREATE TABLE a(id int PRIMARY KEY);")
    write(tmp_path, "011_b.sql", "CREATE TABLE b(id int REFERENCES a(id));")
    assert migrate.main(["--dir", str(tmp_path), "apply", "--yes"]) == 0
    assert {"a", "b", "schema_migrations"} <= tables(env)
    env.execute("SELECT version, checksum FROM schema_migrations ORDER BY version")
    rows = env.fetchall()
    assert [r[0] for r in rows] == ["010_a", "011_b"] and all(r[1] for r in rows)
    capsys.readouterr()
    assert migrate.main(["--dir", str(tmp_path), "apply", "--yes"]) == 0
    assert "لا توجد هجرات معلَّقة" in capsys.readouterr().out


def test_failure_is_atomic_stops_and_records_nothing(env, tmp_path):
    write(tmp_path, "010_a.sql", "CREATE TABLE a(id int);")
    write(tmp_path, "011_bad.sql", "CREATE TABLE c(x int); SELECT 1/0;")
    write(tmp_path, "012_after.sql", "CREATE TABLE d(x int);")
    assert migrate.main(["--dir", str(tmp_path), "apply", "--yes"]) == 2
    t = tables(env)
    assert "a" in t and "c" not in t and "d" not in t   # الفاشل تراجع كاملاً، والتالي لم يُنفَّذ
    env.execute("SELECT version FROM schema_migrations")
    assert [r[0] for r in env.fetchall()] == ["010_a"]


def test_dry_run_changes_nothing(env, tmp_path):
    write(tmp_path, "010_a.sql", "CREATE TABLE a(id int);")
    assert migrate.main(["--dir", str(tmp_path), "apply", "--dry-run"]) == 0
    assert "a" not in tables(env)


def test_modified_applied_migration_is_flagged(env, tmp_path, capsys):
    write(tmp_path, "010_a.sql", "CREATE TABLE a(id int);")
    migrate.main(["--dir", str(tmp_path), "apply", "--yes"])
    write(tmp_path, "010_a.sql", "CREATE TABLE a(id int, extra int);")
    capsys.readouterr()
    migrate.main(["--dir", str(tmp_path), "status"])
    assert "عُدِّلت" in capsys.readouterr().out


def test_baseline_marks_without_running(env, tmp_path):
    write(tmp_path, "010_a.sql", "CREATE TABLE a(id int);")
    write(tmp_path, "011_b.sql", "CREATE TABLE b(id int);")
    write(tmp_path, "012_c.sql", "CREATE TABLE c(id int);")
    assert migrate.main(["--dir", str(tmp_path), "baseline", "--through", "011", "--yes"]) == 0
    assert not ({"a", "b"} & tables(env))              # لم يُشغَّل شيء
    migrate.main(["--dir", str(tmp_path), "apply", "--yes"])
    t = tables(env)
    assert "c" in t and "a" not in t                   # نُفِّذ المعلَّق فقط


def test_baseline_only_and_legacy_rows_without_checksum(env, tmp_path):
    write(tmp_path, "002_x.sql", "CREATE TABLE x(id int);")
    write(tmp_path, "003_y.sql", "CREATE TABLE y(id int);")
    # صفوف قديمة سجّلتها الملفات نفسها بلا بصمة
    env.execute("CREATE TABLE schema_migrations(version VARCHAR(50) PRIMARY KEY, "
                "applied_at TIMESTAMPTZ NOT NULL DEFAULT now())")
    env.execute("INSERT INTO schema_migrations(version) VALUES ('003_y')")
    assert migrate.main(["--dir", str(tmp_path), "baseline", "--only", "002,003", "--yes"]) == 0
    env.execute("SELECT version, checksum IS NOT NULL FROM schema_migrations ORDER BY 1")
    assert env.fetchall() == [("002_x", True), ("003_y", True)]
    assert not ({"x", "y"} & tables(env))


def test_files_with_own_begin_commit_and_percent_signs(env, tmp_path):
    write(tmp_path, "010_txn.sql",
          "BEGIN;\nCREATE TABLE t(name text);\nINSERT INTO t VALUES ('50%');\nCOMMIT;")
    assert migrate.main(["--dir", str(tmp_path), "apply", "--yes"]) == 0
    env.execute("SELECT name FROM t")
    assert env.fetchall() == [("50%",)]
