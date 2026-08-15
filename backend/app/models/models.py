from datetime import timedelta

from sqlalchemy import (
    Column, String, Numeric, Boolean, Date, DateTime, Integer,
    ForeignKey, CheckConstraint, Text, func
)
from sqlalchemy.orm import relationship
from app.database import Base
# ================= BRANCHES =================
class Branch(Base):
    __tablename__ = "branches"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), unique=True, nullable=False)
    name_ar = Column(String(200), nullable=False)
    name_en = Column(String(200))
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Account(Base):
    __tablename__ = "accounts"

    code = Column(String(20), primary_key=True)
    name_ar = Column(String(200), nullable=False)
    name_en = Column(String(200))
    account_type = Column(String(20), nullable=False)
    nature = Column(String(10), nullable=False, default="مدين")

    parent_code = Column(
        String(20),
        ForeignKey("accounts.code"),
        nullable=True
    )

    opening_balance = Column(Numeric(18, 2), nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    # حساب نظامي أساسي (مثل حساب الموردين وفروعه) لا يمكن حذفه من الشاشة
    # لأن مديولات أخرى بالنظام (المشتريات/الموردون) تعتمد عليه.
    is_system = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    sub_accounts = relationship(
        "Account",
        backref="parent",
        remote_side=[code]
    )


class CostCenter(Base):
    """مركز التكلفة — يدعم التسلسل الهرمي (مركز رئيسي/فرعي) حتى يناسب
    الشركات الصغيرة (تسطيح بدون تفريع) والكبيرة (فروع/إدارات/أقسام
    متداخلة) على حد سواء، بنفس الطريقة المتبعة في أوراكل وساب وأودو."""
    __tablename__ = "cost_centers"

    code = Column(String(20), primary_key=True)
    name_ar = Column(String(200), nullable=False)
    name_en = Column(String(200))

    parent_code = Column(String(20), ForeignKey("cost_centers.code"), nullable=True)
    parent = relationship("CostCenter", remote_side=[code], backref="children")

    # نوع المركز: تكلفة (cost) أو ربحية (profit) — يفيد الشركات الكبيرة
    # التي تتابع مراكز ربحية مستقلة، بينما تتجاهله الشركات الصغيرة.
    cc_type = Column(String(20), nullable=False, default="cost")
    manager_name = Column(String(150), nullable=True)
    budget_amount = Column(Numeric(18, 2), nullable=False, default=0)
    notes = Column(Text, nullable=True)

    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("cc_type IN ('cost','profit')", name="ck_cost_center_type"),
    )


class JournalEntry(Base):
    """رأس القيد المحاسبي — قيد مركب: يحتوي على سطرين أو أكثر عبر JournalEntryLine.
    كل سطر إما مدين أو دائن (وليس كلاهما)، ويجب أن يتوازن إجمالي المدين مع
    إجمالي الدائن عبر كل الأسطر."""
    __tablename__ = "journal_entries"

    id = Column(Integer, primary_key=True)
    entry_date = Column(Date, nullable=False)

    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)
    branch = relationship("Branch")

    description = Column(String)
    source_type = Column(String(30), default="manual")
    created_by_name = Column(String(100))
    source_ref = Column(String(30))

    status = Column(String(20), nullable=False, default="posted")
    cost_center_code = Column(String(20), ForeignKey("cost_centers.code"), nullable=True)

    # حقول اختيارية لقيود ذات طبيعة خاصة (مثل مصروف عليه ضريبة) — تربط
    # القيد برقم فاتورة ومورد لإظهار العملية كاملة بتقارير الضرائب
    invoice_number = Column(String(50), nullable=True)
    supplier_code = Column(String(30), ForeignKey("suppliers.code"), nullable=True)
    supplier = relationship("Supplier")

    # إجمالي القيد = مجموع مدين الأسطر = مجموع دائن الأسطر (محسوب عند الترحيل)
    total_amount = Column(Numeric(18, 2), nullable=False, default=0)

    # حقول تراثية (قبل دعم الأسطر المتعددة) — تبقى NULL للقيود الجديدة، ولا تُستخدم بعد الآن
    debit_account = Column(String(20), ForeignKey("accounts.code"), nullable=True)
    credit_account = Column(String(20), ForeignKey("accounts.code"), nullable=True)
    amount = Column(Numeric(18, 2), nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )

    lines = relationship(
        "JournalEntryLine",
        backref="entry",
        cascade="all, delete-orphan",
        order_by="JournalEntryLine.line_no"
    )

    attachments = relationship(
        "JournalEntryAttachment",
        backref="entry",
        cascade="all, delete-orphan",
        order_by="JournalEntryAttachment.uploaded_at"
    )

    __table_args__ = (
        CheckConstraint(
            "total_amount >= 0",
            name="ck_total_amount_nonneg"
        ),
        CheckConstraint(
            "status IN ('posted','cancelled')",
            name="ck_journal_status_model"
        ),
    )


class TaxType(Base):
    """نوع ضريبة مسجّل بالنظام (مثل: ضريبة قيمة مضافة 15%، معفى، صفري)
    يُختار من قائمة عند إضافة ضريبة على سطر قيد، بدل إدخال نسبة يدوياً."""
    __tablename__ = "tax_types"

    code = Column(String(20), primary_key=True)
    name_ar = Column(String(100), nullable=False)
    name_en = Column(String(100))
    rate = Column(Numeric(5, 2), nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    # حساب الضريبة بدليل الحسابات — بدون هذا الربط لن تُرحّل الضريبة
    # كسطر قيد مستقل، وتبقى مجرد قيمة معلوماتية على سطر المصروف فقط
    account_code = Column(String(20), ForeignKey("accounts.code"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class JournalEntryLine(Base):
    """سطر واحد بقيد مركب: حساب واحد + مبلغ مدين أو دائن (وليس كلاهما).
    يمكن توزيع السطر على أكثر من مركز تكلفة بنسب مئوية عبر cost_allocations."""
    __tablename__ = "journal_entry_lines"

    id = Column(Integer, primary_key=True)
    entry_id = Column(Integer, ForeignKey("journal_entries.id", ondelete="CASCADE"), nullable=False)
    line_no = Column(Integer, nullable=False, default=1)
    account_code = Column(String(20), ForeignKey("accounts.code"), nullable=False)
    debit = Column(Numeric(18, 2), nullable=False, default=0)
    credit = Column(Numeric(18, 2), nullable=False, default=0)
    line_description = Column(String)

    # ضريبة اختيارية على مستوى السطر (مثلاً سطر مصروف عليه ضريبة قيمة مضافة)
    tax_type_code = Column(String(20), ForeignKey("tax_types.code"), nullable=True)
    tax_rate = Column(Numeric(5, 2), nullable=True)
    tax_amount = Column(Numeric(18, 2), nullable=True)

    cost_allocations = relationship(
        "LineCostAllocation",
        backref="line",
        cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint("debit >= 0 AND credit >= 0", name="ck_line_amounts_nonneg"),
        CheckConstraint("debit = 0 OR credit = 0", name="ck_line_single_side"),
    )


class JournalEntryAttachment(Base):
    """مستند مرفق بقيد محاسبي (فاتورة، صورة، PDF...). الملف نفسه يُرفع
    مباشرة من الفرونت إند إلى Supabase Storage، وهنا فقط يُخزَّن رابط
    الملف الناتج وبياناته الوصفية."""
    __tablename__ = "journal_entry_attachments"

    id = Column(Integer, primary_key=True)
    entry_id = Column(Integer, ForeignKey("journal_entries.id", ondelete="CASCADE"), nullable=False)
    file_name = Column(String(255), nullable=False)
    file_url = Column(String, nullable=False)
    file_type = Column(String(100))
    file_size = Column(Integer)
    uploaded_by = Column(String(100))
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())


class LineCostAllocation(Base):
    """توزيع نسبة مئوية من سطر قيد معيّن على مركز تكلفة واحد. مجموع
    النسب لكل أسطر السطر الواحد يجب أن يساوي 100% إذا وُجد أي توزيع."""
    __tablename__ = "line_cost_allocations"

    id = Column(Integer, primary_key=True)
    line_id = Column(Integer, ForeignKey("journal_entry_lines.id", ondelete="CASCADE"), nullable=False)
    cost_center_code = Column(String(20), ForeignKey("cost_centers.code"), nullable=False)
    percentage = Column(Numeric(5, 2), nullable=False)

    __table_args__ = (
        CheckConstraint("percentage > 0 AND percentage <= 100", name="ck_lca_percentage"),
    )


class Item(Base):
    __tablename__ = "items"

    id = Column(Integer, primary_key=True)

    code = Column(
        String(30),
        unique=True,
        nullable=False
    )

    name = Column(String(200), nullable=False)

    unit = Column(
        String(20),
        nullable=False,
        default="حبة"
    )

    default_cost = Column(Numeric(18,4), nullable=False, default=0)
    price = Column(Numeric(18,4), nullable=False, default=0)
    qty = Column(Numeric(18,4), nullable=False, default=0)
    avg_cost = Column(Numeric(18,4), nullable=False, default=0)
    reorder_level = Column(Numeric(18,4), nullable=False, default=0)

    is_active = Column(
        Boolean,
        nullable=False,
        default=True
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )


class StockMove(Base):
    __tablename__ = "stock_moves"

    id = Column(Integer, primary_key=True)

    move_date = Column(Date, nullable=False)

    item_id = Column(
        Integer,
        ForeignKey("items.id"),
        nullable=False
    )

    move_type = Column(String(30), nullable=False)
    reference = Column(String(200))

    qty = Column(Numeric(18,4), nullable=False)
    unit_cost = Column(Numeric(18,4), nullable=False, default=0)
    balance_after = Column(Numeric(18,4), nullable=False)

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )


class Supplier(Base):
    __tablename__ = "suppliers"

    code = Column(String(30), primary_key=True)
    name = Column(String(200), nullable=False)

    phone = Column(String(30))
    email = Column(String(150))
    notes = Column(String)

    # الحساب المحاسبي بدليل الحسابات (فرع من حساب الموردين 211) — يحدد
    # هل المورد ضمن "موردين النشاط الأساسي" أو "موردين آخرين"، أسوة
    # بأنظمة أودو/ساب حيث لكل مورد حساب دفع افتراضي بدليل الحسابات.
    account_code = Column(String(20), ForeignKey("accounts.code"), nullable=True)

    # فترة السماح الافتراضية بالأيام لهذا المورد — تُستخدم لتعبئة فترة
    # سماح فاتورة الشراء تلقائياً عند اختيار المورد (قابلة للتعديل يدوياً
    # على مستوى كل فاتورة على حدة).
    payment_terms_days = Column(Integer, nullable=False, default=0)

    is_active = Column(Boolean, nullable=False, default=True)

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    po_number = Column(String(30), primary_key=True)

    po_date = Column(Date, nullable=False)

    supplier_code = Column(
        String(30),
        ForeignKey("suppliers.code"),
        nullable=False
    )

    status = Column(String(20), nullable=False, default="draft")

    total = Column(
        Numeric(18,2),
        nullable=False,
        default=0
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )

    lines = relationship(
        "PurchaseOrderLine",
        backref="po",
        cascade="all, delete-orphan"
    )


class PurchaseOrderLine(Base):
    __tablename__ = "purchase_order_lines"

    id = Column(Integer, primary_key=True)

    po_number = Column(
        String(30),
        ForeignKey("purchase_orders.po_number"),
        nullable=False
    )

    item_id = Column(
        Integer,
        ForeignKey("items.id"),
        nullable=False
    )

    qty = Column(Numeric(18,4), nullable=False)

    unit_price = Column(
        Numeric(18,4),
        nullable=False
    )


class GoodsReceipt(Base):
    __tablename__ = "goods_receipts"

    grn_number = Column(String(30), primary_key=True)

    grn_date = Column(Date, nullable=False)

    supplier_code = Column(
        String(30),
        ForeignKey("suppliers.code"),
        nullable=False
    )

    po_number = Column(
        String(30),
        ForeignKey("purchase_orders.po_number")
    )

    reference = Column(String(200))

    total = Column(
        Numeric(18,2),
        nullable=False,
        default=0
    )

    invoice_status = Column(
        String(20),
        nullable=False,
        default="not_invoiced"
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )

    lines = relationship(
        "GoodsReceiptLine",
        backref="grn",
        cascade="all, delete-orphan"
    )


class GoodsReceiptLine(Base):
    __tablename__ = "goods_receipt_lines"

    id = Column(Integer, primary_key=True)

    grn_number = Column(
        String(30),
        ForeignKey("goods_receipts.grn_number"),
        nullable=False
    )

    item_id = Column(
        Integer,
        ForeignKey("items.id"),
        nullable=False
    )

    qty = Column(
        Numeric(18,4),
        nullable=False
    )

    unit_cost = Column(
        Numeric(18,4),
        nullable=False
    )


class PurchaseInvoice(Base):
    __tablename__ = "purchase_invoices"

    inv_number = Column(String(30), primary_key=True)

    inv_date = Column(Date, nullable=False)

    supplier_code = Column(
        String(30),
        ForeignKey("suppliers.code"),
        nullable=False
    )

    grn_number = Column(
        String(30),
        ForeignKey("goods_receipts.grn_number"),
        nullable=False
    )

    supplier_inv_number = Column(String(60))

    total = Column(
        Numeric(18,2),
        nullable=False,
        default=0
    )

    status = Column(
        String(20),
        nullable=False,
        default="posted"
    )

    # فترة السماح بالأيام لهذه الفاتورة تحديداً — تُعبَّأ تلقائياً من
    # فترة السماح الافتراضية لدى المورد عند إنشاء الفاتورة، وتبقى قابلة
    # للتعديل اليدوي دون التأثير على إعداد المورد نفسه.
    payment_terms_days = Column(Integer, nullable=False, default=0)

    # مركز التكلفة المرتبط بالفاتورة (اختياري) — لتحليل تكاليف المشتريات
    # حسب الإدارة/الفرع بالتقارير.
    cost_center_code = Column(
        String(20),
        ForeignKey("cost_centers.code"),
        nullable=True,
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )

    @property
    def due_date(self):
        """تاريخ الاستحقاق المحسوب = تاريخ الفاتورة + فترة السماح بالأيام."""
        if self.inv_date is None:
            return None
        return self.inv_date + timedelta(days=self.payment_terms_days or 0)

    lines = relationship(
        "PurchaseInvoiceLine",
        backref="invoice",
        cascade="all, delete-orphan"
    )


class PurchaseInvoiceLine(Base):
    __tablename__ = "purchase_invoice_lines"

    id = Column(Integer, primary_key=True)

    inv_number = Column(
        String(30),
        ForeignKey("purchase_invoices.inv_number"),
        nullable=False
    )

    item_id = Column(
        Integer,
        ForeignKey("items.id"),
        nullable=False
    )

    qty = Column(Numeric(18,4), nullable=False)

    unit_cost = Column(
        Numeric(18,4),
        nullable=False
    )


class PurchaseReturn(Base):
    __tablename__ = "purchase_returns"

    rt_number = Column(String(30), primary_key=True)

    rt_date = Column(Date, nullable=False)

    supplier_code = Column(
        String(30),
        ForeignKey("suppliers.code"),
        nullable=False
    )

    inv_number = Column(
        String(30),
        ForeignKey("purchase_invoices.inv_number"),
        nullable=False
    )

    total = Column(
        Numeric(18,2),
        nullable=False,
        default=0
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )

    lines = relationship(
        "PurchaseReturnLine",
        backref="return_doc",
        cascade="all, delete-orphan"
    )


class PurchaseReturnLine(Base):
    __tablename__ = "purchase_return_lines"

    id = Column(Integer, primary_key=True)

    rt_number = Column(
        String(30),
        ForeignKey("purchase_returns.rt_number"),
        nullable=False
    )

    item_id = Column(
        Integer,
        ForeignKey("items.id"),
        nullable=False
    )

    qty = Column(
        Numeric(18,4),
        nullable=False
    )

    unit_cost = Column(
        Numeric(18,4),
        nullable=False
    )