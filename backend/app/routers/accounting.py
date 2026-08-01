from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import or_, func
from typing import Optional
from datetime import date
from app.database import get_db
from app.models.models import Account, JournalEntry, JournalEntryLine, CostCenter, LineCostAllocation, JournalEntryAttachment, Supplier, TaxType
from app.schemas.accounting import (
    AccountIn, AccountUpdate, AccountOut,
    JournalEntryIn, JournalEntryOut,
    CostCenterIn, CostCenterOut,
    LedgerResponseOut, LedgerTransactionOut,
    JournalEntryAttachmentIn, JournalEntryAttachmentOut,
    TaxTypeIn, TaxTypeUpdate, TaxTypeOut,
)
from app.services import account_rollup_balance, account_direct_balance

router = APIRouter(prefix="/api/accounts", tags=["Accounts"])
journal_router = APIRouter(prefix="/api/journal", tags=["Journal"])
cost_center_router = APIRouter(prefix="/api/cost-centers", tags=["Cost Centers"])
tax_type_router = APIRouter(prefix="/api/tax-types", tags=["Tax Types"])


@tax_type_router.get("", response_model=list[TaxTypeOut])
def list_tax_types(db: Session = Depends(get_db)):
    return db.query(TaxType).filter(TaxType.is_active == True).order_by(TaxType.code).all()


@tax_type_router.post("", response_model=TaxTypeOut, status_code=201)
def create_tax_type(payload: TaxTypeIn, db: Session = Depends(get_db)):
    if db.query(TaxType).filter(TaxType.code == payload.code).first():
        raise HTTPException(400, "كود نوع الضريبة مستخدم من قبل")
    if payload.account_code and not db.query(Account).filter(Account.code == payload.account_code).first():
        raise HTTPException(404, "الحساب المحدد للضريبة غير موجود")
    t = TaxType(**payload.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@tax_type_router.put("/{code}", response_model=TaxTypeOut)
def update_tax_type(code: str, payload: TaxTypeUpdate, db: Session = Depends(get_db)):
    t = db.query(TaxType).filter(TaxType.code == code).first()
    if not t:
        raise HTTPException(404, "نوع الضريبة غير موجود")
    data = payload.model_dump(exclude_unset=True)
    if data.get("account_code") and not db.query(Account).filter(Account.code == data["account_code"]).first():
        raise HTTPException(404, "الحساب المحدد للضريبة غير موجود")
    for k, v in data.items():
        setattr(t, k, v)
    db.commit()
    db.refresh(t)
    return t


@cost_center_router.get("", response_model=list[CostCenterOut])
def list_cost_centers(db: Session = Depends(get_db)):
    return db.query(CostCenter).filter(CostCenter.is_active == True).order_by(CostCenter.code).all()


@cost_center_router.post("", response_model=CostCenterOut, status_code=201)
def create_cost_center(payload: CostCenterIn, db: Session = Depends(get_db)):
    if db.query(CostCenter).filter(CostCenter.code == payload.code).first():
        raise HTTPException(400, "كود مركز التكلفة مستخدم من قبل")
    cc = CostCenter(**payload.model_dump())
    db.add(cc)
    db.commit()
    db.refresh(cc)
    return cc

# ============================================================
# الحسابات (Accounts)
# ============================================================

@router.get("", response_model=list[AccountOut])
def list_accounts(branch_id: Optional[int] = Query(None, description="فلترة الأرصدة حسب فرع معيّن"), db: Session = Depends(get_db)):
    accounts = db.query(Account).filter(Account.is_active == True).all()
    result = []
    for acc in accounts:
        result.append(AccountOut(
            code=acc.code, 
            name_ar=acc.name_ar, 
            name_en=acc.name_en,
            account_type=acc.account_type, 
            nature=acc.nature, 
            parent_code=acc.parent_code,
            opening_balance=float(acc.opening_balance),
            balance=account_rollup_balance(db, acc.code, branch_id)
        ))
    return result

@router.post("", response_model=AccountOut, status_code=201)
def create_account(payload: AccountIn, db: Session = Depends(get_db)):
    if db.query(Account).filter(Account.code == payload.code).first():
        raise HTTPException(400, "كود الحساب مستخدم من قبل")
    
    if payload.parent_code and not db.query(Account).filter(Account.code == payload.parent_code).first():
        raise HTTPException(400, "الحساب الأب غير موجود")

    acc = Account(**payload.model_dump())
    db.add(acc)
    db.commit()
    db.refresh(acc)
    
    return AccountOut(
        code=acc.code, 
        name_ar=acc.name_ar, 
        name_en=acc.name_en,
        account_type=acc.account_type, 
        nature=acc.nature, 
        parent_code=acc.parent_code,
        opening_balance=float(acc.opening_balance), 
        balance=float(acc.opening_balance)
    )

@router.put("/{code}", response_model=AccountOut)
def update_account(code: str, payload: AccountUpdate, db: Session = Depends(get_db)):
    acc = db.query(Account).filter(Account.code == code).first()
    if not acc:
        raise HTTPException(404, "الحساب غير موجود")

    data = payload.model_dump(exclude_unset=True)
    
    if "parent_code" in data and data["parent_code"] == code:
        raise HTTPException(400, "لا يمكن أن يكون الحساب أبًا لنفسه")
    
    if "parent_code" in data and data["parent_code"] and not db.query(Account).filter(Account.code == data["parent_code"]).first():
        raise HTTPException(400, "الحساب الأب الجديد غير موجود")

    for k, v in data.items():
        setattr(acc, k, v)
    db.commit()
    db.refresh(acc)
    
    return AccountOut(
        code=acc.code, name_ar=acc.name_ar, name_en=acc.name_en,
        account_type=acc.account_type, nature=acc.nature, parent_code=acc.parent_code,
        opening_balance=float(acc.opening_balance),
        balance=account_rollup_balance(db, acc.code)
    )

@router.delete("/{code}", status_code=204)
def delete_account(code: str, db: Session = Depends(get_db)):
    acc = db.query(Account).filter(Account.code == code).first()
    if not acc:
        raise HTTPException(404, "الحساب غير موجود")
    
    if db.query(Account).filter(Account.parent_code == code).first():
        raise HTTPException(400, "لا يمكن حذف حساب له حسابات فرعية")

    if db.query(JournalEntryLine).filter(JournalEntryLine.account_code == code).first():
        raise HTTPException(400, "لا يمكن حذف حساب مرتبط بقيود محاسبية")

    db.delete(acc)
    db.commit()
    return None


# ============================================================
# القيود المحاسبية (Journal Entries) مع البحث المتقدم
# ============================================================

@journal_router.get("", response_model=list[JournalEntryOut])
def list_journal_entries(
    entry_no: Optional[int] = Query(None, description="رقم القيد"),
    account: Optional[str] = Query(None, description="كود أو اسم الحساب (في أي سطر من أسطر القيد)"),
    created_by: Optional[str] = Query(None, description="منشئ القيد (بحث جزئي)"),
    description: Optional[str] = Query(None, description="بحث بوصف القيد (بحث جزئي)"),
    date_from: Optional[date] = Query(None, description="تاريخ القيد من"),
    date_to: Optional[date] = Query(None, description="تاريخ القيد إلى"),
    created_from: Optional[date] = Query(None, description="تاريخ الإنشاء من"),
    created_to: Optional[date] = Query(None, description="تاريخ الإنشاء إلى"),
    amount_from: Optional[float] = Query(None, description="المبلغ من"),
    amount_to: Optional[float] = Query(None, description="المبلغ إلى"),
    status: Optional[str] = Query(None, description="حالة القيد: posted / cancelled"),
    cost_center_code: Optional[str] = Query(None, description="مركز التكلفة"),
    branch_id: Optional[int] = Query(None, description="الفرع"),
    db: Session = Depends(get_db)
):
    query = db.query(JournalEntry).options(
        selectinload(JournalEntry.lines).selectinload(JournalEntryLine.cost_allocations),
        selectinload(JournalEntry.attachments),
    )

    if entry_no:
        query = query.filter(JournalEntry.id == entry_no)

    if account:
        matching_codes = [
            a.code for a in db.query(Account).filter(
                or_(
                    Account.code.ilike(f"%{account}%"),
                    Account.name_ar.ilike(f"%{account}%"),
                    Account.name_en.ilike(f"%{account}%"),
                )
            ).all()
        ]
        matching_entry_ids = [
            row[0] for row in db.query(JournalEntryLine.entry_id).filter(
                JournalEntryLine.account_code.in_(matching_codes)
            ).distinct().all()
        ]
        query = query.filter(JournalEntry.id.in_(matching_entry_ids))

    if created_by:
        query = query.filter(JournalEntry.created_by_name.ilike(f"%{created_by}%"))

    if description:
        query = query.filter(JournalEntry.description.ilike(f"%{description}%"))

    if date_from:
        query = query.filter(JournalEntry.entry_date >= date_from)
    if date_to:
        query = query.filter(JournalEntry.entry_date <= date_to)

    if created_from:
        query = query.filter(JournalEntry.created_at >= created_from)
    if created_to:
        query = query.filter(JournalEntry.created_at <= created_to)

    if amount_from is not None:
        query = query.filter(JournalEntry.total_amount >= amount_from)
    if amount_to is not None:
        query = query.filter(JournalEntry.total_amount <= amount_to)

    if status:
        query = query.filter(JournalEntry.status == status)

    if cost_center_code:
        matching_entry_ids = [
            row[0] for row in db.query(JournalEntryLine.entry_id)
            .join(LineCostAllocation, LineCostAllocation.line_id == JournalEntryLine.id)
            .filter(LineCostAllocation.cost_center_code == cost_center_code)
            .distinct().all()
        ]
        query = query.filter(JournalEntry.id.in_(matching_entry_ids))

    if branch_id:
        query = query.filter(JournalEntry.branch_id == branch_id)

    return query.order_by(JournalEntry.entry_date.desc(), JournalEntry.id.desc()).all()


def _validate_and_total_lines(payload: JournalEntryIn, db: Session) -> float:
    if len(payload.lines) < 2:
        raise HTTPException(400, "يجب أن يحتوي القيد على سطرين على الأقل")

    if payload.supplier_code and not db.query(Supplier).filter(Supplier.code == payload.supplier_code).first():
        raise HTTPException(404, "المورد المحدد غير موجود")

    total_debit = 0.0
    total_credit = 0.0
    for line in payload.lines:
        if (line.debit and line.credit) or (not line.debit and not line.credit):
            raise HTTPException(400, "كل سطر يجب أن يكون له مبلغ مدين أو دائن فقط، وليس كلاهما ولا لا شيء")
        if not db.query(Account).filter(Account.code == line.account_code).first():
            raise HTTPException(404, f"الحساب {line.account_code} غير موجود")

        # إن اختار المستخدم نوع ضريبة من القائمة، تُجلب نسبتها من النظام
        # مباشرة (نسخة مجمّدة بالسطر)، ولا تُقبل نسبة يدوية إلا إذا لم
        # يُختر نوع ضريبة (توافقاً مع الإدخال اليدوي القديم إن وُجد)
        if line.tax_type_code:
            tax_type = db.query(TaxType).filter(TaxType.code == line.tax_type_code).first()
            if not tax_type:
                raise HTTPException(404, f"نوع الضريبة {line.tax_type_code} غير موجود")
            line.tax_rate = float(tax_type.rate)

        # إن وُجدت نسبة ضريبة (من نوع مُختار أو مُدخلة يدوياً) بدون قيمة، تُحسب تلقائياً
        if line.tax_rate is not None and line.tax_amount is None:
            line_amount = line.debit or line.credit
            line.tax_amount = round(line_amount * line.tax_rate / 100, 2)

        if line.cost_allocations:
            total_pct = sum(a.percentage for a in line.cost_allocations)
            if round(total_pct, 2) != 100:
                raise HTTPException(400, f"مجموع نسب مراكز التكلفة لسطر الحساب {line.account_code} يجب أن يساوي 100% (الحالي: {total_pct:.2f}%)")
            for alloc in line.cost_allocations:
                if not db.query(CostCenter).filter(CostCenter.code == alloc.cost_center_code).first():
                    raise HTTPException(404, f"مركز التكلفة {alloc.cost_center_code} غير موجود")

        total_debit += line.debit
        total_credit += line.credit

    if round(total_debit, 2) != round(total_credit, 2):
        raise HTTPException(400, f"القيد غير متوازن: إجمالي المدين {total_debit:.2f} لا يساوي إجمالي الدائن {total_credit:.2f}")
    if total_debit <= 0:
        raise HTTPException(400, "لا يمكن ترحيل قيد بإجمالي صفر")

    return total_debit


def _persist_entry_lines(db: Session, entry: JournalEntry, lines):
    """يحفظ أسطر القيد. إن كان لسطر ضريبة مرتبطة بحساب فعلي بدليل الحسابات،
    يُقسَّم تلقائياً إلى سطرين: صافي المبلغ على الحساب الأصلي + قيمة
    الضريبة على حساب الضريبة (نفس الجهة مدين/دائن)، حتى تظهر الضريبة
    كسطر قيد مستقل عند فتح حساب أستاذها — بدل أن تبقى مجرد قيمة
    معلوماتية على سطر المصروف فقط."""
    line_no = 1
    for line in lines:
        tax_type = None
        if line.tax_type_code:
            tax_type = db.query(TaxType).filter(TaxType.code == line.tax_type_code).first()

        splits_tax = bool(tax_type and tax_type.account_code and line.tax_amount)

        net_debit = line.debit
        net_credit = line.credit
        if splits_tax:
            if line.debit:
                net_debit = round(line.debit - line.tax_amount, 2)
            else:
                net_credit = round(line.credit - line.tax_amount, 2)

        line_row = JournalEntryLine(
            entry_id=entry.id,
            line_no=line_no,
            account_code=line.account_code,
            debit=net_debit,
            credit=net_credit,
            line_description=line.line_description,
            tax_type_code=line.tax_type_code,
            tax_rate=line.tax_rate,
            tax_amount=line.tax_amount,
        )
        db.add(line_row)
        db.flush()
        line_no += 1
        for alloc in line.cost_allocations:
            db.add(LineCostAllocation(
                line_id=line_row.id,
                cost_center_code=alloc.cost_center_code,
                percentage=alloc.percentage,
            ))

        if splits_tax:
            tax_line = JournalEntryLine(
                entry_id=entry.id,
                line_no=line_no,
                account_code=tax_type.account_code,
                debit=line.tax_amount if line.debit else 0,
                credit=line.tax_amount if line.credit else 0,
                line_description=f"ضريبة: {tax_type.name_ar}",
                tax_type_code=line.tax_type_code,
                tax_rate=line.tax_rate,
                tax_amount=line.tax_amount,
            )
            db.add(tax_line)
            db.flush()
            line_no += 1


@journal_router.post("", response_model=JournalEntryOut, status_code=201)
def create_journal_entry(payload: JournalEntryIn, db: Session = Depends(get_db)):
    total = _validate_and_total_lines(payload, db)

    entry = JournalEntry(
        entry_date=payload.entry_date,
        description=payload.description,
        created_by_name=payload.created_by_name,
        branch_id=payload.branch_id,
        invoice_number=payload.invoice_number,
        supplier_code=payload.supplier_code,
        source_type="manual",
        status="posted",
        total_amount=total,
        # عمود amount قديم ولا يزال NOT NULL في قاعدة البيانات الفعلية؛
        # نُبقيه معبّأً دائماً بإجمالي القيد لتفادي كسر القيد بدون الحاجة
        # لتشغيل migration إضافية الآن.
        amount=total,
    )
    db.add(entry)
    db.flush()  # للحصول على entry.id قبل إضافة الأسطر

    _persist_entry_lines(db, entry, payload.lines)

    db.commit()
    db.refresh(entry)
    return entry


@journal_router.put("/{entry_id}", response_model=JournalEntryOut)
def update_journal_entry(entry_id: int, payload: JournalEntryIn, db: Session = Depends(get_db)):
    entry = db.query(JournalEntry).get(entry_id)
    if not entry:
        raise HTTPException(404, "القيد غير موجود")
    if entry.source_type != "manual":
        raise HTTPException(400, "لا يمكن تعديل قيد مُولَّد تلقائياً")
    if entry.status == "cancelled":
        raise HTTPException(400, "لا يمكن تعديل قيد ملغى — أنشئ قيداً جديداً بدلاً من ذلك")

    total = _validate_and_total_lines(payload, db)

    entry.entry_date = payload.entry_date
    entry.description = payload.description
    entry.created_by_name = payload.created_by_name
    if payload.branch_id is not None:
        entry.branch_id = payload.branch_id
    entry.invoice_number = payload.invoice_number
    entry.supplier_code = payload.supplier_code
    entry.total_amount = total
    entry.amount = total

    # استبدال الأسطر بالكامل بالقيمة الجديدة (يحذف تلقائياً توزيعات مركز التكلفة القديمة عبر cascade)
    db.query(JournalEntryLine).filter(JournalEntryLine.entry_id == entry.id).delete()
    db.flush()
    _persist_entry_lines(db, entry, payload.lines)

    db.commit()
    db.refresh(entry)
    return entry


@journal_router.patch("/{entry_id}/cancel", response_model=JournalEntryOut)
def cancel_journal_entry(entry_id: int, db: Session = Depends(get_db)):
    """إلغاء قيد بعد ترحيله (بدلاً من حذفه) — يحافظ على أثره بالسجل دون احتسابه بالأرصدة."""
    entry = db.query(JournalEntry).get(entry_id)
    if not entry:
        raise HTTPException(404, "القيد غير موجود")
    if entry.status == "cancelled":
        raise HTTPException(400, "القيد ملغى بالفعل")
    entry.status = "cancelled"
    db.commit()
    db.refresh(entry)
    return entry


@journal_router.delete("/{entry_id}", status_code=204)
def delete_journal_entry(entry_id: int, db: Session = Depends(get_db)):
    entry = db.query(JournalEntry).get(entry_id)
    if not entry:
        raise HTTPException(404, "القيد غير موجود")
    if entry.source_type != "manual":
        raise HTTPException(400, "لا يمكن حذف قيد مُولَّد تلقائياً من عملية أخرى (مشتريات/مستودعات...)")
    db.delete(entry)
    db.commit()
    return None


# ============================================================
# حساب الأستاذ الاحترافي (General Ledger)
# ============================================================

@router.get("/{code}/ledger", response_model=LedgerResponseOut)
def get_account_ledger(
    code: str,
    branch_id: Optional[int] = Query(None, description="الفرع"),
    date_from: Optional[date] = Query(None, description="الفترة من"),
    date_to: Optional[date] = Query(None, description="الفترة إلى"),
    created_by: Optional[str] = Query(None, description="أنشئ بواسطة (بحث جزئي)"),
    cost_center_code: Optional[str] = Query(None, description="مركز التكلفة"),
    fiscal_year: Optional[int] = Query(None, description="السنة المالية"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
):
    """كشف حساب احترافي: كل حركات حساب معيّن مرتبة زمنياً مع الرصيد بعد كل
    حركة. يدعم الفلترة بالفرع/الفترة/منشئ القيد/مركز التكلفة/السنة المالية،
    والترقيم (آخر 20 حركة افتراضياً، مع إمكانية التنقل للأقدم)."""
    acc = db.query(Account).filter(Account.code == code).first()
    if not acc:
        raise HTTPException(404, "الحساب غير موجود")

    debit_nature = acc.account_type in ("assets", "expenses")

    # كل حركات هذا الحساب (بدون فلاتر) لحساب الرصيد قبل بداية الفترة المطلوبة بدقة
    all_lines_q = (
        db.query(JournalEntryLine, JournalEntry)
        .join(JournalEntry, JournalEntryLine.entry_id == JournalEntry.id)
        .filter(JournalEntryLine.account_code == code, JournalEntry.status == "posted")
        .order_by(JournalEntry.entry_date.asc(), JournalEntry.id.asc())
    )
    if branch_id:
        all_lines_q = all_lines_q.filter(JournalEntry.branch_id == branch_id)

    all_rows = all_lines_q.all()

    # الرصيد قبل بداية الفترة المفلترة (date_from) إن وُجدت
    balance_before_period = float(acc.opening_balance or 0)
    filtered_rows = []
    for line, entry in all_rows:
        before_start = date_from and entry.entry_date < date_from
        if before_start:
            d, c = float(line.debit or 0), float(line.credit or 0)
            balance_before_period += (d - c) if debit_nature else (c - d)
            continue
        if date_to and entry.entry_date > date_to:
            continue
        if created_by and (not entry.created_by_name or created_by.lower() not in entry.created_by_name.lower()):
            continue
        if fiscal_year and entry.entry_date.year != fiscal_year:
            continue
        if cost_center_code:
            has_cc = any(a.cost_center_code == cost_center_code for a in line.cost_allocations)
            if not has_cc:
                continue
        filtered_rows.append((line, entry))

    # احتساب الرصيد التراكمي لكل حركة ضمن الفترة المفلترة، بدءاً من balance_before_period
    running = balance_before_period
    enriched = []
    for line, entry in filtered_rows:
        d, c = float(line.debit or 0), float(line.credit or 0)
        running += (d - c) if debit_nature else (c - d)
        enriched.append({
            "entry_id": entry.id,
            "entry_date": entry.entry_date,
            "operation": (entry.description or line.line_description or "-"),
            "debit": d,
            "credit": c,
            "balance_after": running,
            "branch_id": entry.branch_id,
            "created_by_name": entry.created_by_name,
            "status": entry.status,
        })

    total = len(enriched)
    # الأحدث أولاً (لعرض "آخر 20 حركة" افتراضياً)، مع دعم التنقل للأقدم
    enriched.reverse()
    start = (page - 1) * page_size
    page_rows = enriched[start:start + page_size]

    return LedgerResponseOut(
        account_code=acc.code,
        account_name_ar=acc.name_ar,
        account_name_en=acc.name_en,
        account_type=acc.account_type,
        opening_balance=float(acc.opening_balance or 0),
        balance_before_period=balance_before_period,
        current_balance=account_direct_balance(db, code, branch_id),
        total=total,
        page=page,
        page_size=page_size,
        transactions=[LedgerTransactionOut(**row) for row in page_rows],
    )


# ============================================================
# مرفقات القيود (فواتير/صور/PDF) — الملف نفسه يُرفع من الفرونت إند
# مباشرة إلى Supabase Storage؛ هنا فقط نخزّن رابط الملف الناتج.
# ============================================================

@journal_router.get("/{entry_id}/attachments", response_model=list[JournalEntryAttachmentOut])
def list_attachments(entry_id: int, db: Session = Depends(get_db)):
    entry = db.query(JournalEntry).get(entry_id)
    if not entry:
        raise HTTPException(404, "القيد غير موجود")
    return db.query(JournalEntryAttachment).filter(
        JournalEntryAttachment.entry_id == entry_id
    ).order_by(JournalEntryAttachment.uploaded_at).all()


@journal_router.post("/{entry_id}/attachments", response_model=JournalEntryAttachmentOut, status_code=201)
def add_attachment(entry_id: int, payload: JournalEntryAttachmentIn, db: Session = Depends(get_db)):
    entry = db.query(JournalEntry).get(entry_id)
    if not entry:
        raise HTTPException(404, "القيد غير موجود")
    att = JournalEntryAttachment(
        entry_id=entry_id,
        file_name=payload.file_name,
        file_url=payload.file_url,
        file_type=payload.file_type,
        file_size=payload.file_size,
        uploaded_by=payload.uploaded_by,
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    return att


@journal_router.delete("/{entry_id}/attachments/{attachment_id}", status_code=204)
def delete_attachment(entry_id: int, attachment_id: int, db: Session = Depends(get_db)):
    att = db.query(JournalEntryAttachment).filter(
        JournalEntryAttachment.id == attachment_id,
        JournalEntryAttachment.entry_id == entry_id,
    ).first()
    if not att:
        raise HTTPException(404, "المرفق غير موجود")
    # ملاحظة: هذا يحذف السجل من قاعدة بياناتنا فقط. حذف الملف الفعلي من
    # Supabase Storage يتم من الفرونت إند مباشرة عبر الـ API الخاص بهم
    # (نفس ما يحدث عند الرفع)، قبل أو بعد استدعاء هذا المسار.
    db.delete(att)
    db.commit()
    return None
