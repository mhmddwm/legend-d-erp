from sqlalchemy import (
    Column, String, Numeric, Boolean, Date, DateTime, Integer,
    ForeignKey, CheckConstraint, func
)
from sqlalchemy.orm import relationship
from app.database import Base


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
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    sub_accounts = relationship(
        "Account",
        backref="parent",
        remote_side=[code]
    )


class JournalEntry(Base):
    __tablename__ = "journal_entries"

    id = Column(Integer, primary_key=True)
    entry_date = Column(Date, nullable=False)

    # حقول تراثية (كانت تُستخدم قبل دعم الأسطر المتعددة) — تبقى موجودة
    # لتوافق البيانات القديمة، لكنها لم تعد تُستخدم للقيود الجديدة.
    debit_account = Column(
        String(20),
        ForeignKey("accounts.code"),
        nullable=True
    )

    credit_account = Column(
        String(20),
        ForeignKey("accounts.code"),
        nullable=True
    )

    amount = Column(Numeric(18, 2), nullable=True)

    # إجمالي القيد (= مجموع مدين الأسطر = مجموع دائن الأسطر)
    total_amount = Column(Numeric(18, 2), nullable=True)

    description = Column(String)
    source_type = Column(String(30), default="manual")
    created_by_name = Column(String(100))
    source_ref = Column(String(30))

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

    __table_args__ = (
        CheckConstraint(
            "amount IS NULL OR amount > 0",
            name="ck_amount_positive"
        ),
    )


class JournalEntryLine(Base):
    __tablename__ = "journal_entry_lines"

    id = Column(Integer, primary_key=True)
    entry_id = Column(Integer, ForeignKey("journal_entries.id", ondelete="CASCADE"), nullable=False)
    line_no = Column(Integer, nullable=False, default=1)
    account_code = Column(String(20), ForeignKey("accounts.code"), nullable=False)
    debit = Column(Numeric(18, 2), nullable=False, default=0)
    credit = Column(Numeric(18, 2), nullable=False, default=0)
    line_description = Column(String)


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

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now()
    )

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