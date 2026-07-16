-- =========================================================
-- نظام ERP — مخطط قاعدة البيانات (PostgreSQL)
-- الحسابات + المشتريات + المخزون
-- =========================================================

-- ---------- دليل الحسابات ----------
CREATE TABLE IF NOT EXISTS accounts (
    code            VARCHAR(20) PRIMARY KEY,
    name_ar         VARCHAR(200) NOT NULL,
    name_en         VARCHAR(200),
    account_type    VARCHAR(20) NOT NULL CHECK (account_type IN ('assets','liabilities','equity','revenue','expenses')),
    parent_code     VARCHAR(20) REFERENCES accounts(code) ON DELETE RESTRICT,
    opening_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accounts_parent ON accounts(parent_code);

-- ---------- القيود المحاسبية ----------
CREATE TABLE IF NOT EXISTS journal_entries (
    id              SERIAL PRIMARY KEY,
    entry_date      DATE NOT NULL,
    debit_account   VARCHAR(20) NOT NULL REFERENCES accounts(code),
    credit_account  VARCHAR(20) NOT NULL REFERENCES accounts(code),
    amount          NUMERIC(18,2) NOT NULL CHECK (amount > 0),
    description     TEXT,
    source_type     VARCHAR(30) DEFAULT 'manual',
    source_ref      VARCHAR(30),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_journal_source ON journal_entries(source_type, source_ref);

-- ---------- الأصناف ----------
CREATE TABLE IF NOT EXISTS items (
    code            VARCHAR(30) PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    unit            VARCHAR(20) NOT NULL DEFAULT 'حبة',
    default_cost    NUMERIC(18,4) NOT NULL DEFAULT 0,
    price           NUMERIC(18,4) NOT NULL DEFAULT 0,
    qty             NUMERIC(18,4) NOT NULL DEFAULT 0,
    avg_cost        NUMERIC(18,4) NOT NULL DEFAULT 0,
    reorder_level   NUMERIC(18,4) NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- حركات المخزون ----------
CREATE TABLE IF NOT EXISTS stock_moves (
    id              SERIAL PRIMARY KEY,
    move_date       DATE NOT NULL,
    item_code       VARCHAR(30) NOT NULL REFERENCES items(code),
    move_type       VARCHAR(30) NOT NULL,
    reference       VARCHAR(200),
    qty             NUMERIC(18,4) NOT NULL,
    unit_cost       NUMERIC(18,4) NOT NULL DEFAULT 0,
    balance_after   NUMERIC(18,4) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stockmoves_item ON stock_moves(item_code);
CREATE INDEX IF NOT EXISTS idx_stockmoves_date ON stock_moves(move_date);

-- ---------- الموردون ----------
CREATE TABLE IF NOT EXISTS suppliers (
    code            VARCHAR(30) PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    phone           VARCHAR(30),
    email           VARCHAR(150),
    notes           TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- طلبات الشراء ----------
CREATE TABLE IF NOT EXISTS purchase_orders (
    po_number       VARCHAR(30) PRIMARY KEY,
    po_date         DATE NOT NULL,
    supplier_code   VARCHAR(30) NOT NULL REFERENCES suppliers(code),
    status          VARCHAR(20) NOT NULL DEFAULT 'draft',
    total           NUMERIC(18,2) NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
    id              SERIAL PRIMARY KEY,
    po_number       VARCHAR(30) NOT NULL REFERENCES purchase_orders(po_number) ON DELETE CASCADE,
    item_code       VARCHAR(30) NOT NULL REFERENCES items(code),
    qty             NUMERIC(18,4) NOT NULL,
    unit_price      NUMERIC(18,4) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_po_lines_po ON purchase_order_lines(po_number);

-- ---------- الاستلام (GRN) ----------
CREATE TABLE IF NOT EXISTS goods_receipts (
    grn_number      VARCHAR(30) PRIMARY KEY,
    grn_date        DATE NOT NULL,
    supplier_code   VARCHAR(30) NOT NULL REFERENCES suppliers(code),
    po_number       VARCHAR(30) REFERENCES purchase_orders(po_number),
    reference       VARCHAR(200),
    total           NUMERIC(18,2) NOT NULL DEFAULT 0,
    invoice_status  VARCHAR(20) NOT NULL DEFAULT 'not_invoiced',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS goods_receipt_lines (
    id              SERIAL PRIMARY KEY,
    grn_number      VARCHAR(30) NOT NULL REFERENCES goods_receipts(grn_number) ON DELETE CASCADE,
    item_code       VARCHAR(30) NOT NULL REFERENCES items(code),
    qty             NUMERIC(18,4) NOT NULL,
    unit_cost       NUMERIC(18,4) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_grn_lines_grn ON goods_receipt_lines(grn_number);

-- ---------- فواتير المشتريات ----------
CREATE TABLE IF NOT EXISTS purchase_invoices (
    inv_number          VARCHAR(30) PRIMARY KEY,
    inv_date            DATE NOT NULL,
    supplier_code       VARCHAR(30) NOT NULL REFERENCES suppliers(code),
    grn_number          VARCHAR(30) NOT NULL REFERENCES goods_receipts(grn_number),
    supplier_inv_number VARCHAR(60),
    total               NUMERIC(18,2) NOT NULL DEFAULT 0,
    status              VARCHAR(20) NOT NULL DEFAULT 'posted',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_invoice_lines (
    id              SERIAL PRIMARY KEY,
    inv_number      VARCHAR(30) NOT NULL REFERENCES purchase_invoices(inv_number) ON DELETE CASCADE,
    item_code       VARCHAR(30) NOT NULL REFERENCES items(code),
    qty             NUMERIC(18,4) NOT NULL,
    unit_cost       NUMERIC(18,4) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pinv_lines_inv ON purchase_invoice_lines(inv_number);

-- ---------- مرتجعات المشتريات ----------
CREATE TABLE IF NOT EXISTS purchase_returns (
    rt_number       VARCHAR(30) PRIMARY KEY,
    rt_date         DATE NOT NULL,
    supplier_code   VARCHAR(30) NOT NULL REFERENCES suppliers(code),
    inv_number      VARCHAR(30) NOT NULL REFERENCES purchase_invoices(inv_number),
    total           NUMERIC(18,2) NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_return_lines (
    id              SERIAL PRIMARY KEY,
    rt_number       VARCHAR(30) NOT NULL REFERENCES purchase_returns(rt_number) ON DELETE CASCADE,
    item_code       VARCHAR(30) NOT NULL REFERENCES items(code),
    qty             NUMERIC(18,4) NOT NULL,
    unit_cost       NUMERIC(18,4) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prt_lines_rt ON purchase_return_lines(rt_number);

-- ---------- بيانات أولية ----------
INSERT INTO accounts (code, name_ar, name_en, account_type, parent_code, opening_balance) VALUES
('1',   'الأصول',            'Assets',        'assets',      NULL, 0),
('11',  'الأصول المتداولة',   'Current Assets','assets',      '1',  0),
('111', 'النقدية والبنوك',    'Cash & Banks',  'assets',      '11', 0),
('12',  'الأصول الثابتة',     'Fixed Assets',  'assets',      '1',  0),
('113', 'المخزون',           'Inventory',     'assets',      '11', 0),
('2',   'الخصوم',            'Liabilities',   'liabilities', NULL, 0),
('21',  'الخصوم المتداولة',   'Current Liabilities','liabilities','2', 0),
('211', 'الموردون',          'Accounts Payable','liabilities','21', 0),
('3',   'حقوق الملكية',       'Equity',        'equity',      NULL, 0),
('4',   'الإيرادات',          'Revenue',       'revenue',     NULL, 0),
('5',   'المصروفات',          'Expenses',      'expenses',    NULL, 0)
ON CONFLICT (code) DO NOTHING;