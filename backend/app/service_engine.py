# -*- coding: utf-8 -*-
"""
محرك فواتير الخدمات وقيودها — دقة الترحيل أولاً.

ضمانات التصميم (كلها مغطاة باختبارات):
  1) كل الحسابات المالية بـ Decimal (ROUND_HALF_UP لخانتين) — لا float في أي حساب.
  2) الضريبة تُحسب لكل سطر ثم تُجمع، فمجموع الفاتورة = مجموع الأسطر بالضبط (لا فروق تقريب).
  3) القيد يُبنى من نفس الأسطر المحسوبة، ويُتحقق قبل الحفظ أن مجموع المدين = مجموع الدائن
     وأن إجمالي الطرف المقابل (عميل/مورد/صندوق/بنك) = إجمالي الفاتورة.
  4) حساب الإيراد/المصروف يجب أن يكون موجوداً ونشطاً وفرعياً (لا يقبل الترحيل على حساب رئيسي)
     ومن النوع الصحيح (إيراد للبيع، مصروف للشراء). الضريبة بلا حساب مربوط تُرفض (لا تُدمج بالإيراد).
  5) الحفظ ذرّي: الفاتورة + أسطرها + القيد في معاملة واحدة؛ أي فشل يلغي الكل.
  6) الإلغاء يغيّر حالة القيد إلى cancelled (نفس اتفاقية النظام) ولا يحذف أثراً.
"""
from collections import OrderedDict
from datetime import date as date_type
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.account_defaults import get_default_account
from app.models.audit_log import AuditLog
from app.models.models import (
    Account, CostCenter, Customer, JournalEntry, JournalEntryLine, Supplier, TaxType,
)
from app.models.service_catalog import Service, ServiceInvoice, ServiceInvoiceLine

CENT = Decimal("0.01")
ZERO = Decimal("0")
HUNDRED = Decimal("100")

SALES, PURCHASE = "sales", "purchase"
PREFIX = {SALES: "SSI", PURCHASE: "SPI"}
SOURCE_TYPE = {SALES: "service_sales_invoice", PURCHASE: "service_purchase_invoice"}
GL_KIND = {SALES: "revenue", PURCHASE: "expenses"}
GL_LABEL = {SALES: "إيراد", PURCHASE: "مصروف"}
VALID_PAYMENT = ("credit", "cash", "bank")
VALID_TAXCALC = ("exclusive", "inclusive")


def D(v) -> Decimal:
    if isinstance(v, Decimal):
        return v
    return Decimal(str(v if v is not None else 0))


def q2(v) -> Decimal:
    return D(v).quantize(CENT, rounding=ROUND_HALF_UP)


# ------------------------------------------------------------------ الحسابات
def validate_gl_account(db, code, kind=None, label="الحساب"):
    """يتأكد أن الحساب موجود ونشط وفرعي (يقبل الترحيل) ومن النوع المطلوب."""
    acc = db.query(Account).filter(Account.code == code).first()
    if not acc:
        raise HTTPException(400, f"{label}: الحساب {code} غير موجود بدليل الحسابات")
    if acc.is_active is False:
        raise HTTPException(400, f"{label}: الحساب {code} غير نشط")
    if db.query(Account).filter(Account.parent_code == code).first():
        raise HTTPException(400, f"{label}: الحساب {code} حساب رئيسي لا يقبل الترحيل — اختر حساباً فرعياً تابعاً له")
    if kind and acc.account_type != kind:
        names = {"revenue": "إيرادات", "expenses": "مصروفات", "assets": "أصول"}
        raise HTTPException(400, f"{label}: الحساب {code} نوعه «{acc.account_type}» والمطلوب حساب {names.get(kind, kind)}")
    return acc


def _existing_active_account(db, code, label):
    acc = db.query(Account).filter(Account.code == code).first()
    if not acc:
        raise HTTPException(400, f"{label}: الحساب {code} غير موجود بدليل الحسابات")
    if acc.is_active is False:
        raise HTTPException(400, f"{label}: الحساب {code} غير نشط")
    return acc


def get_party(db, direction, code):
    if direction == SALES:
        p = db.query(Customer).filter(Customer.code == code).first()
        if not p:
            raise HTTPException(404, f"العميل {code} غير موجود")
    else:
        p = db.query(Supplier).filter(Supplier.code == code).first()
        if not p:
            raise HTTPException(404, f"المورد {code} غير موجود")
    if p.is_active is False:
        raise HTTPException(400, f"{'العميل' if direction == SALES else 'المورد'} {code} غير نشط")
    return p


def resolve_counter_account(db, direction, payment_method, party, settlement_code):
    """حساب الطرف المقابل: ذمة العميل/المورد (آجل) أو الصندوق/البنك (نقدي/بنكي)."""
    if payment_method == "credit":
        if direction == SALES:
            code = (party.account_code or None) or get_default_account(db, "receivable")
            return _existing_active_account(db, code, "حساب العميل")
        code = (party.account_code or None) or get_default_account(db, "payable", "211")
        return _existing_active_account(db, code, "حساب المورد")
    if not settlement_code:
        raise HTTPException(400, "اختر حساب الصندوق/البنك للدفع النقدي أو البنكي")
    return validate_gl_account(db, settlement_code, "assets", "حساب الصندوق/البنك")


# ------------------------------------------------------------------ حساب الأسطر
class LineCalc:
    __slots__ = ("line_no", "service", "description", "qty", "unit_price", "discount_percent",
                 "discount_amount", "net", "tax_type", "tax_rate", "tax", "total", "account_code")


def compute_lines(db, direction, lines_in, tax_calc_method):
    if tax_calc_method not in VALID_TAXCALC:
        raise HTTPException(400, "طريقة احتساب الضريبة غير صحيحة")
    if not lines_in:
        raise HTTPException(400, "أضف خدمة واحدة على الأقل")

    services_cache, tax_cache, gl_cache = {}, {}, {}
    out = []
    for idx, ln in enumerate(lines_in, start=1):
        svc = services_cache.get(ln.service_code)
        if svc is None:
            svc = db.query(Service).filter(Service.code == ln.service_code).first()
            if not svc:
                raise HTTPException(404, f"سطر {idx}: الخدمة {ln.service_code} غير موجودة")
            services_cache[ln.service_code] = svc
        if not svc.is_active:
            raise HTTPException(400, f"سطر {idx}: الخدمة {svc.code} غير نشطة")
        if svc.service_type not in (direction, "both"):
            raise HTTPException(400, f"سطر {idx}: الخدمة {svc.code} ليست خدمة {'بيع' if direction == SALES else 'شراء'}")

        qty = D(ln.qty)
        if qty <= 0:
            raise HTTPException(400, f"سطر {idx}: الكمية يجب أن تكون أكبر من صفر")
        price = D(ln.unit_price) if ln.unit_price is not None else D(
            svc.sales_price if direction == SALES else svc.purchase_cost)
        if price < 0:
            raise HTTPException(400, f"سطر {idx}: السعر لا يكون سالباً")
        disc = D(ln.discount_percent)
        if disc < 0 or disc > 100:
            raise HTTPException(400, f"سطر {idx}: نسبة الخصم بين 0 و100")

        # نوع الضريبة: المرسَل صراحةً (حتى null) يغلب افتراضي الخدمة
        tax_code = ln.tax_type_code if "tax_type_code" in ln.model_fields_set else svc.tax_type_code
        tax_type = None
        if tax_code:
            tax_type = tax_cache.get(tax_code)
            if tax_type is None:
                tax_type = db.query(TaxType).filter(TaxType.code == tax_code, TaxType.is_active.is_(True)).first()
                if not tax_type:
                    raise HTTPException(400, f"سطر {idx}: نوع الضريبة {tax_code} غير موجود أو غير مفعّل")
                tax_cache[tax_code] = tax_type
        rate = D(tax_type.rate) if tax_type else ZERO

        gross = qty * price
        disc_exact = gross * disc / HUNDRED
        base = gross - disc_exact
        if tax_calc_method == "inclusive" and rate > 0:
            total = q2(base)
            net = q2(total / (Decimal("1") + rate / HUNDRED))
            tax = total - net
        else:
            net = q2(base)
            tax = q2(net * rate / HUNDRED)
            total = net + tax

        acc_code = svc.revenue_account_code if direction == SALES else svc.expense_account_code
        if not acc_code:
            raise HTTPException(400, f"سطر {idx}: الخدمة {svc.code} بلا حساب {GL_LABEL[direction]} — عدّل بطاقة الخدمة")
        if acc_code not in gl_cache:
            gl_cache[acc_code] = validate_gl_account(
                db, acc_code, GL_KIND[direction], f"حساب {GL_LABEL[direction]} للخدمة {svc.code}")
        if tax > 0:
            if not tax_type.account_code:
                raise HTTPException(
                    400, f"سطر {idx}: نوع الضريبة {tax_type.code} غير مربوط بحساب في دليل الحسابات — اربطه أولاً من إعدادات الضرائب")
            _existing_active_account(db, tax_type.account_code, f"حساب الضريبة {tax_type.code}")

        c = LineCalc()
        c.line_no, c.service = idx, svc
        c.description = (ln.description or svc.name)[:300]
        c.qty, c.unit_price, c.discount_percent = qty, price, disc
        c.discount_amount = q2(disc_exact)
        c.net, c.tax_type, c.tax_rate, c.tax, c.total = net, tax_type, rate, tax, total
        c.account_code = acc_code
        out.append(c)

    if sum((c.total for c in out), ZERO) <= 0:
        raise HTTPException(400, "إجمالي الفاتورة يجب أن يكون أكبر من صفر")
    return out


def totals(calcs):
    return dict(
        subtotal=sum((c.net for c in calcs), ZERO),
        discount_total=sum((c.discount_amount for c in calcs), ZERO),
        tax_amount=sum((c.tax for c in calcs), ZERO),
        total=sum((c.total for c in calcs), ZERO),
    )


# ------------------------------------------------------------------ بناء القيد
def build_journal(db, direction, calcs, counter_account, inv_ref, party_code, payment_method):
    """يعيد (أسطر القيد، إجمالي المدين، إجمالي الدائن). أسطر: dict بالحقول الجاهزة للحفظ."""
    tot = totals(calcs)
    by_account, by_tax = OrderedDict(), OrderedDict()
    for c in calcs:
        g = by_account.setdefault(c.account_code, dict(amount=ZERO, svcs=[]))
        g["amount"] += c.net
        if c.service.code not in g["svcs"]:
            g["svcs"].append(c.service.code)
        if c.tax > 0:
            t = by_tax.setdefault(c.tax_type.code, dict(amount=ZERO, type=c.tax_type))
            t["amount"] += c.tax

    names = {a.code: a.name_ar for a in db.query(Account).filter(Account.code.in_(
        list(by_account) + [t["type"].account_code for t in by_tax.values()] + [counter_account.code])).all()}

    def line(acc_code, debit, credit, desc, tax=None, tax_amt=None):
        return dict(account_code=acc_code, account_name=names.get(acc_code), debit=debit, credit=credit,
                    description=desc[:250], tax_type=tax, tax_amount=tax_amt)

    svc_label = "فاتورة خدمات " + inv_ref
    jl = []
    if direction == SALES:
        if payment_method == "credit":
            cdesc = f"مستحق على العميل {party_code} — {svc_label}"
        else:
            cdesc = f"تحصيل {'نقدي' if payment_method == 'cash' else 'بنكي'} — {svc_label}"
        jl.append(line(counter_account.code, tot["total"], ZERO, cdesc))
        for code, g in by_account.items():
            if g["amount"] > 0:
                jl.append(line(code, ZERO, g["amount"], f"إيراد خدمات ({'، '.join(g['svcs'])}) — {svc_label}"))
        for tcode, t in by_tax.items():
            jl.append(line(t["type"].account_code, ZERO, t["amount"], f"ضريبة مبيعات مستحقة — {svc_label}",
                           tax=t["type"], tax_amt=t["amount"]))
    else:
        for code, g in by_account.items():
            if g["amount"] > 0:
                jl.append(line(code, g["amount"], ZERO, f"مصروف خدمات ({'، '.join(g['svcs'])}) — {svc_label}"))
        for tcode, t in by_tax.items():
            jl.append(line(t["type"].account_code, t["amount"], ZERO, f"ضريبة مشتريات (مدخلات) — {svc_label}",
                           tax=t["type"], tax_amt=t["amount"]))
        if payment_method == "credit":
            cdesc = f"مستحق للمورد {party_code} — {svc_label}"
        else:
            cdesc = f"سداد {'نقدي' if payment_method == 'cash' else 'بنكي'} — {svc_label}"
        jl.append(line(counter_account.code, ZERO, tot["total"], cdesc))

    deb = sum((l["debit"] for l in jl), ZERO)
    cre = sum((l["credit"] for l in jl), ZERO)
    if deb != cre or deb != tot["total"]:
        # لا يجب أن يحدث أبداً؛ نرفض الحفظ بدل ترحيل قيد خاطئ
        raise HTTPException(500, f"خلل داخلي: القيد غير متوازن (مدين {deb} / دائن {cre} / إجمالي {tot['total']})")
    return jl, deb, cre


# ------------------------------------------------------------------ تجهيز مشترك (معاينة وترحيل)
def prepare(db, direction, payload):
    if payload.payment_method not in VALID_PAYMENT:
        raise HTTPException(400, "طريقة الدفع غير صحيحة")
    party = get_party(db, direction, payload.party_code)
    if payload.cost_center_code and not db.query(CostCenter).filter(CostCenter.code == payload.cost_center_code).first():
        raise HTTPException(404, f"مركز التكلفة {payload.cost_center_code} غير موجود")
    counter = resolve_counter_account(db, direction, payload.payment_method, party, payload.settlement_account_code)
    calcs = compute_lines(db, direction, payload.lines, payload.tax_calc_method)
    return party, counter, calcs


def _line_out(c, svc_name=None):
    return dict(
        line_no=c.line_no, service_code=c.service.code, service_name=c.service.name, description=c.description,
        qty=float(c.qty), unit_price=float(c.unit_price), discount_percent=float(c.discount_percent),
        discount_amount=float(c.discount_amount), net_amount=float(c.net),
        tax_type_code=c.tax_type.code if c.tax_type else None,
        tax_rate=float(c.tax_rate) if c.tax_type else None,
        tax_amount=float(c.tax), line_total=float(c.total), account_code=c.account_code,
    )


def preview(db, direction, payload):
    party, counter, calcs = prepare(db, direction, payload)
    jl, deb, cre = build_journal(db, direction, calcs, counter, "(معاينة)", payload.party_code, payload.payment_method)
    t = totals(calcs)
    warnings = []
    if direction == PURCHASE and payload.party_inv_number:
        if _duplicate_party_ref(db, payload.party_code, payload.party_inv_number):
            warnings.append(f"رقم فاتورة المورد {payload.party_inv_number} مسجّل مسبقاً لهذا المورد — سيُرفض الترحيل")
    return dict(
        direction=direction, subtotal=float(t["subtotal"]), discount_total=float(t["discount_total"]),
        tax_amount=float(t["tax_amount"]), total=float(t["total"]),
        lines=[_line_out(c) for c in calcs],
        journal=[dict(line_no=i, account_code=l["account_code"], account_name=l["account_name"],
                      debit=float(l["debit"]), credit=float(l["credit"]), description=l["description"])
                 for i, l in enumerate(jl, 1)],
        total_debit=float(deb), total_credit=float(cre), balanced=(deb == cre), warnings=warnings,
    )


def _duplicate_party_ref(db, party_code, ref):
    return db.query(ServiceInvoice).filter(
        ServiceInvoice.direction == PURCHASE, ServiceInvoice.party_code == party_code,
        ServiceInvoice.party_inv_number == ref, ServiceInvoice.status != "cancelled").first() is not None


def _next_number(db, direction):
    prefix = PREFIX[direction]
    col = ServiceInvoice.inv_number
    last = db.query(col).filter(col.like(f"{prefix}-%")).order_by(col.desc()).first()
    seq = 1
    if last and last[0]:
        tail = last[0].split("-")[-1]
        if tail.isdigit():
            seq = int(tail) + 1
    return f"{prefix}-{str(seq).zfill(6)}"


def _log(db, inv_number, action, actor, details):
    db.add(AuditLog(entity_type="service_invoice", entity_id=inv_number, action=action,
                    actor=actor or "مستخدم النظام", details=details))


# ------------------------------------------------------------------ الترحيل
def post_invoice(db, direction, payload, actor=None):
    """ينشئ الفاتورة وقيدها في معاملة واحدة. يعيد كائن الفاتورة."""
    party, counter, calcs = prepare(db, direction, payload)
    if direction == PURCHASE and payload.party_inv_number and _duplicate_party_ref(
            db, payload.party_code, payload.party_inv_number):
        raise HTTPException(400, f"رقم فاتورة المورد ({payload.party_inv_number}) مسجّل مسبقاً لهذا المورد — لا يمكن تكراره")
    t = totals(calcs)

    last_error = None
    for _attempt in range(3):        # تصادم رقم المستند عند تزامن مستخدمين: نعيد التوليد
        try:
            inv_number = _next_number(db, direction)
            jl, deb, cre = build_journal(db, direction, calcs, counter, inv_number, payload.party_code,
                                         payload.payment_method)
            inv = ServiceInvoice(
                inv_number=inv_number, direction=direction, inv_date=payload.inv_date,
                party_code=payload.party_code, party_inv_number=(payload.party_inv_number or None),
                payment_method=payload.payment_method,
                settlement_account_code=(payload.settlement_account_code if payload.payment_method != "credit" else None),
                tax_calc_method=payload.tax_calc_method,
                discount_total=t["discount_total"], subtotal=t["subtotal"], tax_amount=t["tax_amount"],
                total=t["total"], status="posted", cost_center_code=payload.cost_center_code or None,
                notes=payload.notes, created_by=actor,
            )
            db.add(inv)
            db.flush()
            for c in calcs:
                db.add(ServiceInvoiceLine(
                    inv_number=inv_number, line_no=c.line_no, service_code=c.service.code,
                    description=c.description, qty=c.qty, unit_price=c.unit_price,
                    discount_percent=c.discount_percent, discount_amount=c.discount_amount, net_amount=c.net,
                    tax_type_code=c.tax_type.code if c.tax_type else None,
                    tax_rate=c.tax_rate if c.tax_type else None, tax_amount=c.tax, line_total=c.total,
                    account_code=c.account_code,
                ))
            who = "العميل" if direction == SALES else "المورد"
            entry = JournalEntry(
                entry_date=payload.inv_date,
                description=f"فاتورة خدمات {'مبيعات' if direction == SALES else 'مشتريات'} {inv_number} — {who} {payload.party_code}",
                source_type=SOURCE_TYPE[direction], source_ref=inv_number,
                status="posted", cost_center_code=payload.cost_center_code or None,
                total_amount=t["total"], created_by_name=actor,
                invoice_number=inv_number if direction == PURCHASE else None,
                supplier_code=payload.party_code if direction == PURCHASE else None,
            )
            db.add(entry)
            db.flush()
            for i, l in enumerate(jl, start=1):
                kw = dict(entry_id=entry.id, line_no=i, account_code=l["account_code"],
                          debit=l["debit"], credit=l["credit"], line_description=l["description"])
                if l["tax_type"] is not None:
                    kw.update(tax_type_code=l["tax_type"].code, tax_rate=l["tax_type"].rate, tax_amount=l["tax_amount"])
                db.add(JournalEntryLine(**kw))
            inv.journal_entry_id = entry.id
            _log(db, inv_number, "post", actor,
                 f"ترحيل فاتورة خدمات {t['total']} — قيد رقم {entry.id} ({len(jl)} أسطر)")
            db.commit()
            db.refresh(inv)
            return inv
        except IntegrityError as e:
            db.rollback()
            last_error = e
            continue
    raise HTTPException(409, "تعذّر إنشاء رقم المستند بسبب ازدحام — أعد المحاولة") from last_error


def cancel_invoice(db, inv, actor=None, reason=None):
    if inv.status == "cancelled":
        raise HTTPException(400, "الفاتورة ملغاة بالفعل")
    entry = db.query(JournalEntry).filter(JournalEntry.id == inv.journal_entry_id).first() if inv.journal_entry_id else None
    if not entry:
        raise HTTPException(409, "قيد الفاتورة غير موجود — لا يمكن إلغاؤها آلياً، راجع مسؤول النظام")
    if entry.status == "posted":
        entry.status = "cancelled"
    inv.status = "cancelled"
    inv.cancelled_at = _now()
    inv.cancel_reason = (reason or "").strip() or None
    _log(db, inv.inv_number, "cancel", actor, f"إلغاء الفاتورة وقيدها {entry.id}" + (f" — {reason}" if reason else ""))
    db.commit()
    db.refresh(inv)
    return inv


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc)
