# -*- coding: utf-8 -*-
"""
إذن الإضافة التلقائي للرصيد الافتتاحي + حذف الصنف المرتبط به.

عند إضافة صنف برصيد افتتاحي يُنشأ إذن إضافة (GoodsReceipt بلا مورد، invoice_status='opening')
وحركة مخزون «افتتاحي» مرتبطة به، وقيد: مدين المخزون (123) / دائن أرصدة افتتاحية — مخزون (34).
لا يظهر هذا الإذن بين الأذون القابلة للفوترة، ولا يمكن تعديله ولا فوترته.

حذف صنف رصيده الافتتاحي وحده: يتطلب تأكيداً ثم يحذف الإذن وقيده والحركة والصنف معاً.
أي صنف عليه مستند (شراء/بيع/مرتجع/عرض سعر...) لا يُحذف أبداً.
"""
from datetime import date as date_type

from fastapi import HTTPException
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

from app.models.audit_log import AuditLog
from app.models.models import (
    Account, DeliveryNoteLine, GoodsReceipt, GoodsReceiptLine, JournalEntry, JournalEntryLine,
    PriceListItem, PurchaseInvoiceLine, PurchaseOrderLine, PurchaseReturnLine, SalesInvoiceLine,
    SalesOrderLine, SalesQuoteLine, SalesReturnLine, StockMove,
)
from app.models.warehouse_stock import WarehouseStock

OPENING_STATUS = "opening"
OPENING_MOVE_TYPE = "افتتاحي"
INVENTORY_ACCOUNT = "123"
OPENING_EQUITY_ACCOUNT = "34"

_schema_ok = False


def _ensure_schema(db):
    """الهجرة 035 يجب أن تكون مطبّقة (المورد اختياري في goods_receipts)."""
    global _schema_ok
    if _schema_ok:
        return
    try:
        cols = inspect(db.connection()).get_columns("goods_receipts")
        col = next((c for c in cols if c["name"] == "supplier_code"), None)
        if col is not None and col.get("nullable") is False:
            raise HTTPException(
                400,
                "لا يمكن إنشاء إذن الرصيد الافتتاحي: طبّق الهجرة 035 أولاً "
                "(python ../scripts/migrate.py apply)",
            )
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 — الفحص مساعد فقط
        return
    _schema_ok = True


def _next_grn_number(db):
    col = GoodsReceipt.grn_number
    last = db.query(col).filter(col.like("GRN-%")).order_by(col.desc()).first()
    seq = 1
    if last and last[0]:
        tail = last[0].split("-")[-1]
        if tail.isdigit():
            seq = int(tail) + 1
    return f"GRN-{str(seq).zfill(6)}"


def _log(db, entity_id, action, details):
    db.add(AuditLog(entity_type="goods_receipt", entity_id=entity_id, action=action,
                    actor="مستخدم النظام", details=details))


def create_opening_receipt(db, item, qty, unit_cost, warehouse_id=None, location_id=None):
    """ينشئ إذن الإضافة + حركة المخزون + القيد المحاسبي. لا يعمل commit."""
    _ensure_schema(db)
    qty = float(qty or 0)
    unit_cost = float(unit_cost or 0)
    total = round(qty * unit_cost, 2)

    inv = eq = None
    if total > 0:
        inv = db.query(Account).filter(Account.code == INVENTORY_ACCOUNT).first()
        if not inv:
            raise HTTPException(400, "حساب المخزون (123) غير موجود بدليل الحسابات — لا يمكن ترحيل قيد الرصيد الافتتاحي")
        eq = db.query(Account).filter(Account.code == OPENING_EQUITY_ACCOUNT).first()
        if not eq:
            raise HTTPException(
                400,
                "حساب «أرصدة افتتاحية — مخزون» (34) غير موجود — طبّق الهجرة 035 (python ../scripts/migrate.py apply)",
            )

    today = date_type.today()
    grn = GoodsReceipt(
        grn_number=_next_grn_number(db),
        grn_date=today,
        supplier_code=None,
        po_number=None,
        reference=f"رصيد افتتاحي — {item.code}",
        warehouse_id=warehouse_id,
        location_id=location_id,
        total=total,
        invoice_status=OPENING_STATUS,
    )
    db.add(grn)
    db.flush()
    db.add(GoodsReceiptLine(grn_number=grn.grn_number, item_id=item.id, qty=qty, unit_cost=unit_cost))
    db.add(StockMove(
        move_date=today, item_id=item.id, move_type=OPENING_MOVE_TYPE,
        reference=f"GRN-{grn.grn_number}", warehouse_id=warehouse_id,
        qty=qty, unit_cost=unit_cost, balance_after=qty,
    ))

    if total > 0:
        entry = JournalEntry(
            entry_date=today,
            description=f"رصيد افتتاحي — {item.code} {item.name} — إذن {grn.grn_number}",
            source_type="opening_stock", source_ref=grn.grn_number,
            status="posted", total_amount=total,
        )
        db.add(entry)
        db.flush()
        db.add(JournalEntryLine(entry_id=entry.id, line_no=1, account_code=inv.code, debit=total, credit=0,
                                line_description=f"مخزون — رصيد افتتاحي {item.code}"))
        db.add(JournalEntryLine(entry_id=entry.id, line_no=2, account_code=eq.code, debit=0, credit=total,
                                line_description=f"أرصدة افتتاحية — {item.code}"))
        grn.journal_entry_id = entry.id

    _log(db, grn.grn_number, "create_opening", f"إذن إضافة رصيد افتتاحي للصنف {item.code}: كمية {qty} × تكلفة {unit_cost}")
    return grn


def find_opening_receipts(db, item_id):
    """أذون الرصيد الافتتاحي لهذا الصنف (إذن يخصه وحده)."""
    rows = (
        db.query(GoodsReceipt)
        .join(GoodsReceiptLine, GoodsReceiptLine.grn_number == GoodsReceipt.grn_number)
        .filter(GoodsReceiptLine.item_id == item_id, GoodsReceipt.invoice_status == OPENING_STATUS)
        .all()
    )
    return rows


def item_blockers(db, item):
    """المستندات التي تمنع حذف الصنف: {الاسم: العدد}."""
    iid = item.id
    checks = [
        ("أوامر شراء", db.query(PurchaseOrderLine).filter(PurchaseOrderLine.item_id == iid)),
        ("أذون استلام مشتريات", db.query(GoodsReceiptLine).join(
            GoodsReceipt, GoodsReceipt.grn_number == GoodsReceiptLine.grn_number)
            .filter(GoodsReceiptLine.item_id == iid, GoodsReceipt.invoice_status != OPENING_STATUS)),
        ("فواتير مشتريات", db.query(PurchaseInvoiceLine).filter(PurchaseInvoiceLine.item_id == iid)),
        ("مرتجعات مشتريات", db.query(PurchaseReturnLine).filter(PurchaseReturnLine.item_id == iid)),
        ("فواتير مبيعات", db.query(SalesInvoiceLine).filter(SalesInvoiceLine.item_id == iid)),
        ("أوامر بيع", db.query(SalesOrderLine).filter(SalesOrderLine.item_id == iid)),
        ("أذون تسليم", db.query(DeliveryNoteLine).filter(DeliveryNoteLine.item_id == iid)),
        ("عروض أسعار", db.query(SalesQuoteLine).filter(SalesQuoteLine.item_id == iid)),
        ("مرتجعات مبيعات", db.query(SalesReturnLine).filter(SalesReturnLine.item_id == iid)),
    ]
    out = {}
    for label, q in checks:
        n = q.count()
        if n:
            out[label] = n
    return out


def delete_plan(db, item):
    """يقرر هل يُحذف الصنف وما الذي سيُحذف معه. لا يغيّر شيئاً."""
    blockers = item_blockers(db, item)
    moves = db.query(StockMove).filter(StockMove.item_id == item.id).all()
    receipts = find_opening_receipts(db, item.id)
    price_rows = db.query(PriceListItem).filter(PriceListItem.item_id == item.id).count()

    reason = None
    if blockers:
        reason = "لا يمكن حذف الصنف: عليه عمليات — " + "، ".join(f"{k} ({v})" for k, v in blockers.items())
    elif any((m.move_type or "") != OPENING_MOVE_TYPE for m in moves):
        reason = "لا يمكن حذف صنف له حركات مخزون غير الرصيد الافتتاحي"
    elif abs(float(item.qty or 0) - sum(float(m.qty or 0) for m in moves)) > 0.0001:
        reason = "لا يمكن حذف الصنف: رصيده الحالي تغيّر عن الرصيد الافتتاحي"
    else:
        for g in receipts:
            if db.query(GoodsReceiptLine).filter(GoodsReceiptLine.grn_number == g.grn_number).count() != 1:
                reason = f"لا يمكن حذف الصنف: إذن الرصيد الافتتاحي {g.grn_number} يضم أصنافاً أخرى"
                break

    numbers = [g.grn_number for g in receipts]
    parts = []
    if numbers:
        parts.append("إذن الإضافة المنشأ من النظام (" + "، ".join(numbers) + ") وقيده المحاسبي (مدين المخزون / دائن أرصدة افتتاحية)")
    if price_rows:
        parts.append(f"إدراجه في قوائم الأسعار ({price_rows})")
    needs_confirmation = bool(parts)
    message = reason or (
        (f"سيتم حذف الصنف {item.code} مع " + " و".join(parts) + ". هل توافق؟") if parts
        else f"سيتم حذف الصنف {item.code} نهائياً."
    )
    return {
        "code": item.code,
        "can_delete": reason is None,
        "needs_confirmation": reason is None and needs_confirmation,
        "opening_receipts": numbers,
        "price_list_rows": price_rows,
        "blockers": blockers,
        "message": message,
    }


def delete_item_with_opening(db, item, confirm=False):
    plan = delete_plan(db, item)
    if not plan["can_delete"]:
        raise HTTPException(400, plan["message"])
    if plan["needs_confirmation"] and not confirm:
        raise HTTPException(409, "يتطلب تأكيداً: " + plan["message"])
    try:
        for g in find_opening_receipts(db, item.id):
            je_id = g.journal_entry_id
            num = g.grn_number
            db.delete(g)            # يحذف أسطر الإذن (cascade)
            db.flush()
            if je_id:
                entry = db.query(JournalEntry).filter(JournalEntry.id == je_id).first()
                if entry:
                    db.delete(entry)  # يحذف أسطر القيد (cascade)
            _log(db, num, "delete_opening", f"حُذف إذن الرصيد الافتتاحي بحذف الصنف {item.code}")
        db.query(StockMove).filter(StockMove.item_id == item.id).delete(synchronize_session=False)
        db.query(WarehouseStock).filter(WarehouseStock.item_id == item.id).delete(synchronize_session=False)
        db.query(PriceListItem).filter(PriceListItem.item_id == item.id).delete(synchronize_session=False)
        db.delete(item)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "لا يمكن حذف الصنف: مستخدم في مستندات أخرى")
