# -*- coding: utf-8 -*-
"""
وحدة الخدمات:
  /api/services                    بطاقات الخدمات (قراءة لكل مستخدم مسجَّل، الكتابة بصلاحية المخزون)
  /api/service-sales-invoices      فواتير خدمات المبيعات   (صلاحية المبيعات)
  /api/service-purchase-invoices   فواتير خدمات المشتريات (صلاحية المشتريات)
كل حسابات القيود في app/service_engine.py.
"""
import re
from datetime import date as date_type, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import service_engine as eng
from app.core.security import get_current_user
from app.database import get_db
from app.models.audit_log import AuditLog
from app.models.models import Account, CostCenter, Customer, JournalEntry, JournalEntryLine, Supplier, TaxType
from app.models.service_catalog import Service, ServiceInvoice, ServiceInvoiceLine
from app.schemas.service_catalog import (
    ServiceIn, ServiceInvoiceCancelIn, ServiceInvoiceIn, ServiceInvoiceOut, ServiceInvoicePreviewOut,
    ServiceOut, ServiceSummaryOut, ServiceUpdate,
)

router = APIRouter(prefix="/api/services", tags=["Services"])
sales_router = APIRouter(prefix="/api/service-sales-invoices", tags=["ServiceSalesInvoices"])
purchase_router = APIRouter(prefix="/api/service-purchase-invoices", tags=["ServicePurchaseInvoices"])

_CODE_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,30}$")
_TYPES = ("sales", "purchase", "both")


def _f(v):
    return float(v) if v is not None else 0.0


# =========================================================== بطاقات الخدمات
def _usage(db):
    """{code: dict(posted, lines, sales, purchase)} بإجمالي صافٍ قبل الضريبة."""
    out = {}
    for code, n in db.query(ServiceInvoiceLine.service_code, func.count(ServiceInvoiceLine.id)).group_by(
            ServiceInvoiceLine.service_code).all():
        out.setdefault(code, dict(posted=0, lines=0, sales=0.0, purchase=0.0))["lines"] = n
    rows = (
        db.query(ServiceInvoiceLine.service_code, ServiceInvoice.direction,
                 func.count(ServiceInvoiceLine.id), func.coalesce(func.sum(ServiceInvoiceLine.net_amount), 0))
        .join(ServiceInvoice, ServiceInvoice.inv_number == ServiceInvoiceLine.inv_number)
        .filter(ServiceInvoice.status == "posted")
        .group_by(ServiceInvoiceLine.service_code, ServiceInvoice.direction).all()
    )
    for code, direction, n, net in rows:
        u = out.setdefault(code, dict(posted=0, lines=0, sales=0.0, purchase=0.0))
        u["posted"] += n
        u["sales" if direction == "sales" else "purchase"] += _f(net)
    return out


def _service_out(svc, usage):
    u = usage.get(svc.code, {})
    return ServiceOut(
        code=svc.code, name=svc.name, name_en=svc.name_en, description=svc.description, category=svc.category,
        service_type=svc.service_type, unit=svc.unit, sales_price=_f(svc.sales_price),
        purchase_cost=_f(svc.purchase_cost), tax_type_code=svc.tax_type_code,
        revenue_account_code=svc.revenue_account_code, expense_account_code=svc.expense_account_code,
        cost_center_code=svc.cost_center_code, is_active=bool(svc.is_active), created_at=svc.created_at,
        posted_invoices=u.get("posted", 0), total_lines=u.get("lines", 0),
        sales_total=u.get("sales", 0.0), purchase_total=u.get("purchase", 0.0),
    )


def _next_service_code(db):
    best = 0
    for (code,) in db.query(Service.code).filter(Service.code.like("SRV-%")).all():
        tail = code.split("-")[-1]
        if tail.isdigit():
            best = max(best, int(tail))
    return f"SRV-{str(best + 1).zfill(4)}"


def _validate_service(db, d):
    """يتحقق من بطاقة الخدمة كاملة (d = قاموس القيم النهائية بعد الدمج)."""
    if not (d.get("name") or "").strip():
        raise HTTPException(400, "اسم الخدمة مطلوب")
    if d["service_type"] not in _TYPES:
        raise HTTPException(400, "نوع الخدمة يجب أن يكون: بيع أو شراء أو كلاهما")
    if not (d.get("unit") or "").strip():
        raise HTTPException(400, "وحدة القياس مطلوبة (مثل: ساعة، شهر، خدمة)")
    if float(d.get("sales_price") or 0) < 0 or float(d.get("purchase_cost") or 0) < 0:
        raise HTTPException(400, "السعر والتكلفة لا يكونان سالبين")
    if d.get("tax_type_code") and not db.query(TaxType).filter(TaxType.code == d["tax_type_code"]).first():
        raise HTTPException(400, f"نوع الضريبة {d['tax_type_code']} غير موجود")
    if d.get("cost_center_code") and not db.query(CostCenter).filter(CostCenter.code == d["cost_center_code"]).first():
        raise HTTPException(400, f"مركز التكلفة {d['cost_center_code']} غير موجود")
    st = d["service_type"]
    if st in ("sales", "both") and not d.get("revenue_account_code"):
        raise HTTPException(400, "خدمة البيع تتطلب حساب إيراد — اختره من بطاقة الخدمة")
    if st in ("purchase", "both") and not d.get("expense_account_code"):
        raise HTTPException(400, "خدمة الشراء تتطلب حساب مصروف — اختره من بطاقة الخدمة")
    if d.get("revenue_account_code"):
        eng.validate_gl_account(db, d["revenue_account_code"], "revenue", "حساب الإيراد")
    if d.get("expense_account_code"):
        eng.validate_gl_account(db, d["expense_account_code"], "expenses", "حساب المصروف")


@router.get("", response_model=list[ServiceOut])
def list_services(
    q: str = Query("", description="بحث بالكود/الاسم/التصنيف"),
    service_type: str = Query("", description="sales|purchase|both"),
    active: str = Query("", description="true|false"),
    db: Session = Depends(get_db),
):
    query = db.query(Service)
    if q.strip():
        like = f"%{q.strip()}%"
        query = query.filter((Service.code.ilike(like)) | (Service.name.ilike(like)) |
                             (Service.name_en.ilike(like)) | (Service.category.ilike(like)))
    if service_type in _TYPES:
        query = query.filter(Service.service_type == service_type)
    if active in ("true", "false"):
        query = query.filter(Service.is_active.is_(active == "true"))
    usage = _usage(db)
    return [_service_out(s, usage) for s in query.order_by(Service.code).all()]


@router.get("/summary", response_model=ServiceSummaryOut)
def services_summary(db: Session = Depends(get_db)):
    today = date_type.today()
    start = today.replace(day=1)
    end = date_type(today.year + (today.month == 12), (today.month % 12) + 1, 1)
    base = (
        db.query(ServiceInvoice.direction, func.coalesce(func.sum(ServiceInvoice.subtotal), 0))
        .filter(ServiceInvoice.status == "posted", ServiceInvoice.inv_date >= start, ServiceInvoice.inv_date < end)
        .group_by(ServiceInvoice.direction).all()
    )
    m = {d: _f(v) for d, v in base}
    svcs = db.query(Service).all()
    return ServiceSummaryOut(
        total=len(svcs), active=sum(1 for s in svcs if s.is_active),
        sales_services=sum(1 for s in svcs if s.service_type in ("sales", "both")),
        purchase_services=sum(1 for s in svcs if s.service_type in ("purchase", "both")),
        month_sales_net=m.get("sales", 0.0), month_purchase_net=m.get("purchase", 0.0),
        month_label=today.strftime("%Y-%m"),
    )


@router.get("/next-code")
def next_service_code(db: Session = Depends(get_db)):
    return {"code": _next_service_code(db)}


@router.get("/{code}", response_model=ServiceOut)
def get_service(code: str, db: Session = Depends(get_db)):
    svc = db.query(Service).filter(Service.code == code).first()
    if not svc:
        raise HTTPException(404, "الخدمة غير موجودة")
    return _service_out(svc, _usage(db))


@router.post("", response_model=ServiceOut, status_code=201)
def create_service(payload: ServiceIn, db: Session = Depends(get_db)):
    data = payload.model_dump()
    code = (data.pop("code") or "").strip() or _next_service_code(db)
    if not _CODE_RE.match(code):
        raise HTTPException(400, "كود الخدمة: حروف إنجليزية وأرقام و- _ . فقط (حتى 30 حرفاً)")
    if db.query(Service).filter(Service.code == code).first():
        raise HTTPException(400, f"كود الخدمة {code} مستخدم من قبل")
    data = {k: (v.strip() if isinstance(v, str) else v) or (None if isinstance(v, str) else v) for k, v in data.items()}
    data["unit"] = data.get("unit") or "خدمة"
    _validate_service(db, data)
    svc = Service(code=code, **data)
    db.add(svc)
    db.add(AuditLog(entity_type="service", entity_id=code, action="create", actor="مستخدم النظام",
                    details=f"إنشاء خدمة {svc.name} ({svc.service_type})"))
    db.commit()
    db.refresh(svc)
    return _service_out(svc, {})


@router.put("/{code}", response_model=ServiceOut)
def update_service(code: str, payload: ServiceUpdate, db: Session = Depends(get_db)):
    svc = db.query(Service).filter(Service.code == code).first()
    if not svc:
        raise HTTPException(404, "الخدمة غير موجودة")
    changes = payload.model_dump(exclude_unset=True)
    for k, v in list(changes.items()):
        if isinstance(v, str):
            changes[k] = v.strip() or None
    merged = {c: getattr(svc, c) for c in (
        "name", "name_en", "description", "category", "service_type", "unit", "sales_price", "purchase_cost",
        "tax_type_code", "revenue_account_code", "expense_account_code", "cost_center_code", "is_active")}
    merged.update(changes)
    if not merged.get("unit"):
        merged["unit"] = "خدمة"
    _validate_service(db, merged)
    for k, v in merged.items():
        setattr(svc, k, v)
    svc.updated_at = datetime.now(timezone.utc)
    db.add(AuditLog(entity_type="service", entity_id=code, action="update", actor="مستخدم النظام",
                    details="تعديل بطاقة الخدمة: " + "، ".join(sorted(changes))))
    db.commit()
    db.refresh(svc)
    return _service_out(svc, _usage(db))


@router.post("/{code}/toggle", response_model=ServiceOut)
def toggle_service(code: str, db: Session = Depends(get_db)):
    svc = db.query(Service).filter(Service.code == code).first()
    if not svc:
        raise HTTPException(404, "الخدمة غير موجودة")
    svc.is_active = not svc.is_active
    svc.updated_at = datetime.now(timezone.utc)
    db.add(AuditLog(entity_type="service", entity_id=code, action="toggle", actor="مستخدم النظام",
                    details="تفعيل" if svc.is_active else "تعطيل"))
    db.commit()
    db.refresh(svc)
    return _service_out(svc, _usage(db))


@router.delete("/{code}", status_code=204)
def delete_service(code: str, db: Session = Depends(get_db)):
    svc = db.query(Service).filter(Service.code == code).first()
    if not svc:
        raise HTTPException(404, "الخدمة غير موجودة")
    if db.query(ServiceInvoiceLine).filter(ServiceInvoiceLine.service_code == code).first():
        raise HTTPException(409, "لا يمكن حذف خدمة استُخدمت في فواتير — عطّلها بدلاً من حذفها")
    db.delete(svc)
    db.add(AuditLog(entity_type="service", entity_id=code, action="delete", actor="مستخدم النظام",
                    details=f"حذف الخدمة {svc.name}"))
    db.commit()
    return None


# =========================================================== فواتير الخدمات
def _party_names(db, direction, codes):
    if not codes:
        return {}
    model = Customer if direction == "sales" else Supplier
    return {p.code: p.name for p in db.query(model).filter(model.code.in_(list(codes))).all()}


def _invoice_out(db, inv, names=None, with_journal=False):
    names = names if names is not None else _party_names(db, inv.direction, [inv.party_code])
    svc_names = {s.code: s.name for s in db.query(Service).filter(
        Service.code.in_([l.service_code for l in inv.lines])).all()} if inv.lines else {}
    lines = [dict(
        line_no=l.line_no, service_code=l.service_code, service_name=svc_names.get(l.service_code),
        description=l.description, qty=_f(l.qty), unit_price=_f(l.unit_price),
        discount_percent=_f(l.discount_percent), discount_amount=_f(l.discount_amount),
        net_amount=_f(l.net_amount), tax_type_code=l.tax_type_code,
        tax_rate=_f(l.tax_rate) if l.tax_rate is not None else None, tax_amount=_f(l.tax_amount),
        line_total=_f(l.line_total), account_code=l.account_code) for l in inv.lines]
    journal = None
    if with_journal and inv.journal_entry_id:
        jl = (db.query(JournalEntryLine, Account.name_ar)
              .outerjoin(Account, Account.code == JournalEntryLine.account_code)
              .filter(JournalEntryLine.entry_id == inv.journal_entry_id)
              .order_by(JournalEntryLine.line_no).all())
        journal = [dict(line_no=l.line_no, account_code=l.account_code, account_name=n,
                        debit=_f(l.debit), credit=_f(l.credit), description=l.line_description) for l, n in jl]
    return dict(
        inv_number=inv.inv_number, direction=inv.direction, inv_date=inv.inv_date, party_code=inv.party_code,
        party_name=names.get(inv.party_code), party_inv_number=inv.party_inv_number,
        payment_method=inv.payment_method, settlement_account_code=inv.settlement_account_code,
        tax_calc_method=inv.tax_calc_method, discount_total=_f(inv.discount_total), subtotal=_f(inv.subtotal),
        tax_amount=_f(inv.tax_amount), total=_f(inv.total), status=inv.status,
        journal_entry_id=inv.journal_entry_id, cost_center_code=inv.cost_center_code, notes=inv.notes,
        created_by=inv.created_by, created_at=inv.created_at, cancelled_at=inv.cancelled_at,
        cancel_reason=inv.cancel_reason, lines=lines, journal=journal,
    )


def _actor(user):
    return getattr(user, "full_name", None) or getattr(user, "email", None) or "مستخدم النظام"


def _register(r, direction):
    @r.get("", response_model=list[ServiceInvoiceOut])
    def list_invoices(
        status: str = Query(""), date_from: str = Query(""), date_to: str = Query(""),
        party_code: str = Query(""), q: str = Query(""), db: Session = Depends(get_db),
    ):
        query = db.query(ServiceInvoice).filter(ServiceInvoice.direction == direction)
        if status in ("posted", "cancelled"):
            query = query.filter(ServiceInvoice.status == status)
        if party_code:
            query = query.filter(ServiceInvoice.party_code == party_code)
        try:
            if date_from:
                query = query.filter(ServiceInvoice.inv_date >= date_type.fromisoformat(date_from))
            if date_to:
                query = query.filter(ServiceInvoice.inv_date <= date_type.fromisoformat(date_to))
        except ValueError:
            raise HTTPException(400, "صيغة التاريخ yyyy-mm-dd")
        if q.strip():
            like = f"%{q.strip()}%"
            query = query.filter((ServiceInvoice.inv_number.ilike(like)) | (ServiceInvoice.party_inv_number.ilike(like))
                                 | (ServiceInvoice.notes.ilike(like)))
        rows = query.order_by(ServiceInvoice.inv_date.desc(), ServiceInvoice.inv_number.desc()).limit(2000).all()
        names = _party_names(db, direction, {i.party_code for i in rows})
        return [_invoice_out(db, i, names) for i in rows]

    @r.post("/preview", response_model=ServiceInvoicePreviewOut)
    def preview_invoice(payload: ServiceInvoiceIn, db: Session = Depends(get_db)):
        """محاكاة الترحيل: يعرض أسطر القيد الدقيقة التي ستُنشأ، دون حفظ أي شيء."""
        return eng.preview(db, direction, payload)

    @r.post("", response_model=ServiceInvoiceOut, status_code=201)
    def create_invoice(payload: ServiceInvoiceIn, db: Session = Depends(get_db), user=Depends(get_current_user)):
        inv = eng.post_invoice(db, direction, payload, actor=_actor(user))
        return _invoice_out(db, inv, with_journal=True)

    @r.get("/{inv_number}", response_model=ServiceInvoiceOut)
    def get_invoice(inv_number: str, db: Session = Depends(get_db)):
        inv = db.query(ServiceInvoice).filter(
            ServiceInvoice.inv_number == inv_number, ServiceInvoice.direction == direction).first()
        if not inv:
            raise HTTPException(404, "الفاتورة غير موجودة")
        return _invoice_out(db, inv, with_journal=True)

    @r.post("/{inv_number}/cancel", response_model=ServiceInvoiceOut)
    def cancel(inv_number: str, payload: ServiceInvoiceCancelIn = None, db: Session = Depends(get_db),
               user=Depends(get_current_user)):
        inv = db.query(ServiceInvoice).filter(
            ServiceInvoice.inv_number == inv_number, ServiceInvoice.direction == direction).first()
        if not inv:
            raise HTTPException(404, "الفاتورة غير موجودة")
        eng.cancel_invoice(db, inv, actor=_actor(user), reason=(payload.reason if payload else None))
        return _invoice_out(db, inv, with_journal=True)

    return dict(list=list_invoices, preview=preview_invoice, create=create_invoice, get=get_invoice, cancel=cancel)


sales_api = _register(sales_router, "sales")
purchase_api = _register(purchase_router, "purchase")
