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
from app.models.models import UnitTemplateLevel, Account, GoodsReceipt, GoodsReceiptLine, Item, JournalEntry, JournalEntryLine, PriceList, PriceListItem, StockMove, UnitTemplate
from app.models.warehouse_stock import WarehouseStock
from app.routers import inventory as inv
from app.schemas.inventory import ItemIn, ItemUpdate, UnitTemplateIn, UnitTemplateLevelIn, UnitTemplateOut, UnitTemplateUpdate


@pytest.fixture()
def db():
    Base.metadata.create_all(engine)
    s = SessionLocal()
    for m in (JournalEntryLine, JournalEntry, GoodsReceiptLine, GoodsReceipt, PriceListItem):
        s.query(m).delete()
    s.query(StockMove).delete()
    s.query(WarehouseStock).delete()
    s.query(Item).delete()
    s.query(UnitTemplateLevel).delete()
    s.query(UnitTemplate).delete()
    if not s.query(Account).filter(Account.code == '123').first():
        s.add_all([Account(code='123', name_ar='المخزون', account_type='assets'),
                   Account(code='34', name_ar='أرصدة افتتاحية — مخزون', account_type='equity')])
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


def test_opening_balance_creates_receipt_journal_and_move(db):
    inv.create_item(ItemIn(code="O1", name="تجريبي", unit="حبة", unit_template="6", opening_qty=5, default_cost=10), db)
    grn = db.query(GoodsReceipt).one()
    assert grn.invoice_status == "opening" and grn.supplier_code is None and float(grn.total) == 50
    assert db.query(GoodsReceiptLine).filter(GoodsReceiptLine.grn_number == grn.grn_number).count() == 1
    mv = db.query(StockMove).one()
    assert mv.move_type == "افتتاحي" and mv.reference == f"GRN-{grn.grn_number}"
    je = db.query(JournalEntry).one()
    assert je.source_type == "opening_stock" and grn.journal_entry_id == je.id
    lines = {l.account_code: (float(l.debit), float(l.credit)) for l in db.query(JournalEntryLine).all()}
    assert lines == {"123": (50.0, 0.0), "34": (0.0, 50.0)}


def test_zero_cost_opening_has_receipt_but_no_journal(db):
    inv.create_item(ItemIn(code="Z1", name="ز", unit="حبة", unit_template="6", opening_qty=3, default_cost=0), db)
    assert db.query(GoodsReceipt).count() == 1 and db.query(JournalEntry).count() == 0


def test_delete_requires_confirmation_then_removes_voucher_and_journal(db):
    inv.create_item(ItemIn(code="O1", name="تجريبي", unit="حبة", unit_template="6", opening_qty=5, default_cost=10), db)
    prev = inv.delete_item_preview("O1", db)
    assert prev["can_delete"] and prev["needs_confirmation"] and len(prev["opening_receipts"]) == 1
    with pytest.raises(HTTPException) as e:
        inv.delete_item("O1", confirm=False, db=db)
    assert e.value.status_code == 409
    assert db.query(Item).filter(Item.code == "O1").count() == 1      # لم يُحذف شيء
    inv.delete_item("O1", confirm=True, db=db)
    for m in (Item, StockMove, GoodsReceipt, GoodsReceiptLine, JournalEntry, JournalEntryLine):
        assert db.query(m).count() == 0


def test_item_without_opening_is_deleted_without_confirmation(db):
    inv.create_item(ItemIn(code="N1", name="س", unit="حبة", unit_template="6"), db)
    assert inv.delete_item_preview("N1", db)["needs_confirmation"] is False
    inv.delete_item("N1", confirm=False, db=db)
    assert db.query(Item).count() == 0


def test_item_with_other_moves_or_documents_cannot_be_deleted(db):
    import datetime
    inv.create_item(ItemIn(code="O2", name="س", unit="حبة", unit_template="6", opening_qty=5, default_cost=1), db)
    it = db.query(Item).filter(Item.code == "O2").one()
    db.add(StockMove(move_date=datetime.date.today(), item_id=it.id, move_type="استلام مشتريات",
                     reference="GRN-X", qty=3, unit_cost=1, balance_after=8))
    db.commit()
    with pytest.raises(HTTPException) as e:
        inv.delete_item("O2", confirm=True, db=db)
    assert e.value.status_code == 400
    assert db.query(GoodsReceipt).count() == 1                         # الإذن باقٍ


def test_item_in_purchase_receipt_is_blocked_by_name(db):
    import datetime
    from app.models.models import Supplier
    inv.create_item(ItemIn(code="B1", name="س", unit="حبة", unit_template="6"), db)
    it = db.query(Item).filter(Item.code == "B1").one()
    db.add(Supplier(code="S1", name="مورد"))
    db.add(GoodsReceipt(grn_number="GRN-000009", grn_date=datetime.date.today(), supplier_code="S1",
                        total=1, invoice_status="not_invoiced"))
    db.flush()
    db.add(GoodsReceiptLine(grn_number="GRN-000009", item_id=it.id, qty=1, unit_cost=1))
    db.commit()
    prev = inv.delete_item_preview("B1", db)
    assert not prev["can_delete"] and "أذون استلام مشتريات" in prev["message"]


def test_price_list_rows_are_listed_and_removed_with_confirmation(db):
    inv.create_item(ItemIn(code="P1", name="س", unit="حبة", unit_template="6"), db)
    it = db.query(Item).filter(Item.code == "P1").one()
    db.add(PriceList(code="PL1", name="قائمة"))
    db.flush()
    db.add(PriceListItem(price_list_code="PL1", item_id=it.id, price=5)); db.commit()
    prev = inv.delete_item_preview("P1", db)
    assert prev["needs_confirmation"] and prev["price_list_rows"] == 1
    inv.delete_item("P1", confirm=True, db=db)
    assert db.query(Item).count() == 0 and db.query(PriceListItem).count() == 0


def test_opening_receipt_cannot_be_edited_or_invoiced(db):
    from app.routers import purchasing as pur
    inv.create_item(ItemIn(code="O3", name="س", unit="حبة", unit_template="6", opening_qty=2, default_cost=1), db)
    num = db.query(GoodsReceipt).one().grn_number
    with pytest.raises(HTTPException) as e:
        pur.update_grn(num, pur.GoodsReceiptIn(grn_date="2026-01-01", supplier_code="S", lines=[]), db)
    assert e.value.status_code == 400


def test_single_unit_template_without_factor_is_accepted(db):
    t = inv.create_unit_template(UnitTemplateIn(code="U1", name="كرتون", base_unit="كرتون"), db)
    assert t.higher_unit is None and float(t.factor) == 1
    # عامل مُرسَل بلا وحدة أعلى يُتجاهل
    t2 = inv.create_unit_template(UnitTemplateIn(code="U2", name="علبة", base_unit="علبة", factor=7), db)
    assert float(t2.factor) == 1
    # الوحدة الأعلى = الأساسية تُعامل كوحدة واحدة
    t3 = inv.create_unit_template(UnitTemplateIn(code="U3", name="حبة مفردة", base_unit="حبة", higher_unit=" حبة "), db)
    assert t3.higher_unit is None and float(t3.factor) == 1


def test_two_unit_template_still_requires_factor_above_one(db):
    with pytest.raises(HTTPException) as e:
        inv.create_unit_template(UnitTemplateIn(code="U4", name="كرتون 1", base_unit="حبة", higher_unit="كرتون", factor=1), db)
    assert e.value.status_code == 400 and "وحدة واحدة" in e.value.detail
    ok = inv.create_unit_template(UnitTemplateIn(code="U5", name="كرتون 20", base_unit="حبة", higher_unit="كرتون", factor=20), db)
    assert float(ok.factor) == 20


def test_clearing_higher_unit_resets_factor(db):
    t = inv.update_unit_template("T6", UnitTemplateUpdate(higher_unit=None), db)
    assert t.higher_unit is None and float(t.factor) == 1
    with pytest.raises(HTTPException):
        inv.update_unit_template("T12", UnitTemplateUpdate(factor=1), db)


def test_single_unit_template_can_be_linked_to_items(db):
    inv.create_unit_template(UnitTemplateIn(code="U6", name="كرتون", base_unit="كرتون"), db)
    it = inv.create_item(ItemIn(code="C1", name="س", unit="كرتون"), db)   # قالب واحد فقط بهذه الوحدة → ربط تلقائي
    assert it.unit_template == "كرتون"


# ===================== قوالب متعددة المستويات: حبة ← شدة ← كرتون =====================
def L(unit, per):
    return UnitTemplateLevelIn(unit=unit, per_parent=per)


def mk(db, code="M1", name="كرتون شد 12", base="حبة", levels=None, **kw):
    return inv.create_unit_template(UnitTemplateIn(code=code, name=name, base_unit=base, levels=levels, **kw), db)


def test_multi_level_template_computes_cumulative_factors(db):
    t = mk(db, levels=[L("شدة", 12), L("كرتون", 6)])
    got = [(l.level_no, l.unit_name, float(l.per_parent), float(l.factor)) for l in t.effective_levels]
    assert got == [(1, "شدة", 12.0, 12.0), (2, "كرتون", 6.0, 72.0)]
    assert t.higher_unit == "كرتون" and float(t.factor) == 72          # الحقلان القديمان = أكبر مستوى
    out = UnitTemplateOut.model_validate(t).model_dump()
    assert [(l["unit"], l["per_parent"], l["factor"]) for l in out["levels"]] == [("شدة", 12.0, 12.0), ("كرتون", 6.0, 72.0)]


def test_three_levels_and_decimal_ratio(db):
    t = mk(db, levels=[L("علبة", 4), L("شدة", 2.5), L("كرتون", 6)])
    assert [float(l.factor) for l in t.effective_levels] == [4.0, 10.0, 60.0]


@pytest.mark.parametrize("levels,msg", [
    ([L("شدة", 12), L("شدة", 6)], "مكرر"),                  # اسم مكرر
    ([L("حبة", 12)], "مكرر"),                                # يطابق الأساسية
    ([L(" ", 12)], "اكتب اسم الوحدة"),
    ([L("شدة", 1)], "أكبر من 1"),
    ([L("شدة", 0)], "أكبر من 1"),
    ([L("شدة", 12), L("كرتون", 1)], "أكبر من 1"),
    ([L("أ%d" % i, 2) for i in range(7)], "الحد الأقصى"),
    ([L("شدة", 100000), L("كرتون", 100000)], "كبير جداً"),
])
def test_invalid_levels_rejected(db, levels, msg):
    with pytest.raises(HTTPException) as e:
        mk(db, levels=levels)
    assert e.value.status_code == 400 and msg in e.value.detail
    assert db.query(UnitTemplate).filter(UnitTemplate.code == "M1").count() == 0


def test_legacy_payload_still_makes_single_level(db):
    t = inv.create_unit_template(UnitTemplateIn(code="LG", name="قديم", base_unit="حبة", higher_unit="كرتون", factor=24), db)
    assert [(l.unit_name, float(l.factor)) for l in t.effective_levels] == [("كرتون", 24.0)]


def test_legacy_rows_without_level_rows_get_synthesized_level(db):
    # T6 أُنشئ بالفيكستشر مباشرة (حقول قديمة فقط)
    out = UnitTemplateOut.model_validate(db.query(UnitTemplate).filter(UnitTemplate.code == "T6").one()).model_dump()
    assert [(l["unit"], l["factor"]) for l in out["levels"]] == [("كرتون", 6.0)]


def test_update_replaces_levels_and_keeps_them_when_untouched(db):
    mk(db, levels=[L("شدة", 12), L("كرتون", 6)])
    t = inv.update_unit_template("M1", UnitTemplateUpdate(levels=[L("علبة", 10)]), db)
    assert [(l.unit_name, float(l.factor)) for l in t.effective_levels] == [("علبة", 10.0)] and t.higher_unit == "علبة"
    t = inv.update_unit_template("M1", UnitTemplateUpdate(min_price=3), db)            # لا تلمس المستويات
    assert [l.unit_name for l in t.effective_levels] == ["علبة"] and float(t.min_price) == 3
    t = inv.update_unit_template("M1", UnitTemplateUpdate(levels=[]), db)             # وحدة واحدة
    assert t.effective_levels == [] and t.higher_unit is None and float(t.factor) == 1
    assert db.query(UnitTemplateLevel).filter(UnitTemplateLevel.template_code == "M1").count() == 0


def test_update_to_invalid_levels_changes_nothing(db):
    mk(db, levels=[L("شدة", 12), L("كرتون", 6)])
    with pytest.raises(HTTPException):
        inv.update_unit_template("M1", UnitTemplateUpdate(levels=[L("شدة", 12), L("شدة", 5)]), db)
    db.rollback()
    t = db.query(UnitTemplate).filter(UnitTemplate.code == "M1").one()
    assert [float(l.factor) for l in t.effective_levels] == [12.0, 72.0]


def test_base_rename_blocked_when_linked_and_cannot_clash_with_level_name(db):
    mk(db, levels=[L("شدة", 12), L("كرتون", 6)])
    with pytest.raises(HTTPException):
        inv.update_unit_template("M1", UnitTemplateUpdate(base_unit="شدة"), db)      # يطابق اسم مستوى
    db.rollback()
    inv.create_item(ItemIn(code="MM", name="س", unit="حبة", unit_template="كرتون شد 12"), db)
    with pytest.raises(HTTPException) as e:
        inv.update_unit_template("M1", UnitTemplateUpdate(base_unit="قطعة"), db)
    assert e.value.status_code == 409


def test_delete_template_removes_its_levels(db):
    mk(db, levels=[L("شدة", 12), L("كرتون", 6)])
    inv.delete_unit_template("M1", db)
    assert db.query(UnitTemplateLevel).count() == 0


def test_legacy_edit_of_multilevel_template_collapses_to_one_level(db):
    mk(db, levels=[L("شدة", 12), L("كرتون", 6)])
    t = inv.update_unit_template("M1", UnitTemplateUpdate(higher_unit="كرتون", factor=72), db)   # واجهة قديمة
    assert [(l.unit_name, float(l.factor)) for l in t.effective_levels] == [("كرتون", 72.0)]
