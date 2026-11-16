import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from sqlalchemy import create_engine, Column, Integer, String, MetaData, Table, text
from app.schema_check import find_schema_gaps


def _engine():
    e = create_engine("sqlite://")
    with e.begin() as c:
        c.execute(text("CREATE TABLE items (id INTEGER PRIMARY KEY, code VARCHAR(30))"))
    return e


def test_detects_missing_column_and_table():
    md = MetaData()
    Table("items", md, Column("id", Integer, primary_key=True),
          Column("code", String(30)), Column("unit_template", String(120)))
    Table("unit_templates", md, Column("code", String(30), primary_key=True))
    gaps = find_schema_gaps(_engine(), md)
    assert "عمود ناقص: items.unit_template" in gaps
    assert "جدول ناقص: unit_templates" in gaps


def test_no_gaps_when_matching():
    md = MetaData()
    Table("items", md, Column("id", Integer, primary_key=True), Column("code", String(30)))
    assert find_schema_gaps(_engine(), md) == []
