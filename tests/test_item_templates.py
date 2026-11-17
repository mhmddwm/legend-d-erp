# -*- coding: utf-8 -*-
"""اختبارات ارتباط الأصناف بقوالب الوحدات (SQLite في الذاكرة/ملف مؤقت — لا تلمس الإنتاج).
التشغيل:  cd backend && pytest ../tests -q
"""
import os
import sys

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["JWT_SECRET"] = "test-secret-test-secret-test-secret-123456"
os.environ.pop("ADMIN_EMAIL", None)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import pytest
from fastapi import HTTPException

from app.database import Base, SessionLocal, engine
from app.models.models import Item, UnitTemplate
from app.routers import inventory as inv
from app.schemas.inventory import ItemIn, ItemUpdate, UnitTemplateIn, UnitTemplateUpdate


@pytest.fixture()
def db():
    Base.metadata.create_all(engine, tables=[Item.__table__, UnitTemplate.__table__])
    s = SessionLocal()
    s.query(Item).delete()
    s.query(UnitTemplate).delete()
    s.add_all([
        UnitTemplate(code="T6", name="6", base_unit="حبة", higher_unit="كرتون", factor=6),
        UnitTemplate(code="T12", name="12", base_unit="حبة", higher_unit="كرتون", factor=12),
        UnitTemplate(code="KG", name="كيلو", base_unit="كجم", higher_unit=None, factor=1),
    ])
    s.commit()
    yield s
    s.close()


def _item(db, code="A1", unit="حبة", tpl=None):
    db.add(Item(code=code, name="صنف " + code, unit=unit, unit_template=tpl, qty=0, avg_cost=0))
    db.commit()


def test_ambiguous_unit_without_template_is_rejected(db):
    with pytest.raises(HTTPException) as e:
        inv._resolve_item_template(db, "حبة", None)
    assert e.value.status_code == 400 and "اختر قالب" in e.value.detail


def test_single_template_is_linked_automatically(db):
    db.query(UnitTemplate).filter(UnitTemplate.code == "T12").delete(); db.commit()
    assert inv._resolve_item_template(db, "حبة", None) == "6"


def test_unit_without_templates_stays_unlinked(db):
    assert inv._resolve_item_template(db, "لتر", None) is None


def test_unknown_or_mismatched_template_is_rejected(db):
    with pytest.raises(HTTPException):
        inv._resolve_item_template(db, "حبة", "غير موجود")
    with pytest.raises(HTTPException):
        inv._resolve_item_template(db, "حبة", "كيلو")      # وحدته الأساسية كجم


def test_template_matched_by_name_or_code_with_spaces(db):
    assert inv._resolve_item_template(db, " حبة ", " 12 ") == "12"
    assert inv._resolve_item_template(db, "حبة", "T6") == "6"


def test_create_item_stores_template_and_blocks_ambiguity(db):
    it = inv.create_item(ItemIn(code="N1", name="زيت", unit="حبة", unit_template="12"), db)
    assert it.unit_template == "12"
    with pytest.raises(HTTPException):
        inv.create_item(ItemIn(code="N2", name="سكر", unit="حبة"), db)


def test_update_item_other_fields_do_not_trigger_check(db):
    _item(db, "OLD", "حبة", None)                       # صنف قديم بلا قالب
    inv.update_item("OLD", ItemUpdate(price=5), db)      # تعديل السعر لا يُرفض
    with pytest.raises(HTTPException):
        inv.update_item("OLD", ItemUpdate(name="جديد", unit="حبة"), db)  # لمس الوحدة بلا قالب يُرفض
    inv.update_item("OLD", ItemUpdate(unit="حبة", unit_template="6"), db)
    assert db.query(Item).filter(Item.code == "OLD").one().unit_template == "6"


def test_rename_template_updates_linked_items(db):
    _item(db, "X", "حبة", "6")
    inv.update_unit_template("T6", UnitTemplateUpdate(name="ستة"), db)
    assert db.query(Item).filter(Item.code == "X").one().unit_template == "ستة"


def test_duplicate_template_name_is_rejected(db):
    with pytest.raises(HTTPException):
        inv.create_unit_template(UnitTemplateIn(code="T99", name=" 12 ", base_unit="حبة", higher_unit="كرتون", factor=12), db)
    with pytest.raises(HTTPException):
        inv.update_unit_template("T6", UnitTemplateUpdate(name="12"), db)


def test_cannot_change_base_unit_or_delete_linked_template(db):
    _item(db, "X", "حبة", "6")
    with pytest.raises(HTTPException) as e:
        inv.update_unit_template("T6", UnitTemplateUpdate(base_unit="قطعة"), db)
    assert e.value.status_code == 409
    with pytest.raises(HTTPException) as e:
        inv.delete_unit_template("T6", db)
    assert e.value.status_code == 409
    inv.update_unit_template("T6", UnitTemplateUpdate(factor=8), db)   # تغيير المعامل مسموح
    inv.delete_unit_template("T12", db)                               # قالب غير مستخدم يُحذف


def test_bulk_link_script_end_to_end(tmp_path, db):
    import link_item_templates as lk
    db_file = tmp_path / "t.db"
    from sqlalchemy import create_engine, text
    eng = create_engine(f"sqlite:///{db_file}")
    Base.metadata.create_all(eng, tables=[Item.__table__, UnitTemplate.__table__])
    from sqlalchemy.orm import Session
    with Session(eng) as ses:
        ses.add_all([
            UnitTemplate(code="T6", name="6", base_unit="حبة", higher_unit="كرتون", factor=6),
            UnitTemplate(code="T12", name="12", base_unit="حبة", higher_unit="كرتون", factor=12),
            UnitTemplate(code="KG", name="كيلو", base_unit="كجم", higher_unit=None, factor=1),
        ])
        for code in ("P1", "P2", "P3"):
            ses.add(Item(code=code, name="صنف " + code, unit="حبة", qty=0, avg_cost=0))
        ses.commit()
    lk.make_engine = lambda url=None: eng
    out = tmp_path / "plan.csv"
    assert lk.main(["export", "--out", str(out)]) == 0
    import csv
    rows = list(csv.DictReader(open(out, encoding="utf-8-sig")))
    assert [r["كود_الصنف"] for r in rows] == ["P1", "P2", "P3"]
    # املأ P1 و P2 فقط، و P3 بقالب خاطئ الوحدة
    rows[0]["القالب_الجديد"] = "12"; rows[1]["القالب_الجديد"] = "T6"; rows[2]["القالب_الجديد"] = "كيلو"
    with open(out, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    # الأخطاء توقف كل شيء، والتجربة لا تحفظ
    assert lk.main(["apply", "--file", str(out), "--commit"]) == 1
    with eng.connect() as c:
        assert c.execute(text("SELECT COUNT(*) FROM items WHERE unit_template IS NOT NULL")).scalar() == 0
    assert lk.main(["apply", "--file", str(out), "--commit", "--skip-errors"]) == 0
    with eng.connect() as c:
        got = dict(c.execute(text("SELECT code, unit_template FROM items")).fetchall())
    assert got == {"P1": "12", "P2": "6", "P3": None}
