-- =========================================================
-- LEGEND D ERP — Migration 002: Warehouse Management Module
-- مديول المستودعات: تعدد مستودعات + مواقع + دفعات/سيريال
-- + تقييم مخزون (WAC/FIFO/Standard) + صلاحيات واعتماد أمين المستودع
-- + تحويلات بين المستودعات
-- Idempotent: safe to re-run.
-- =========================================================

-- ---------- 1) الأدوار الوظيفية وربطها بالمستودعات ----------
CREATE TABLE IF NOT EXISTS roles (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(40)  UNIQUE NOT NULL,   -- cashier / warehouse_keeper / warehouse_manager / purchasing_officer / accountant / admin / viewer
    name_ar     VARCHAR(120) NOT NULL,
    name_en     VARCHAR(120),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO roles (code, name_ar, name_en) VALUES
('admin',              'مدير النظام',            'System Admin'),
('warehouse_manager',  'مدير المستودع',          'Warehouse Manager'),
('warehouse_keeper',   'أمين المستودع',          'Warehouse Keeper'),
('cashier',            'كاشير',                  'Cashier'),
('purchasing_officer', 'مسؤول المشتريات',        'Purchasing Officer'),
('accountant',         'محاسب',                  'Accountant'),
('viewer',             'مطّلع (قراءة فقط)',       'Viewer')
ON CONFLICT (code) DO NOTHING;

-- ربط مستخدم بدور داخل مستودع معيّن (warehouse_id = NULL يعني الدور صالح لكل المستودعات)
CREATE TABLE IF NOT EXISTS user_warehouse_roles (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    warehouse_id  INTEGER REFERENCES warehouses(id) ON DELETE CASCADE,
    role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, warehouse_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_uwr_user ON user_warehouse_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_uwr_wh ON user_warehouse_roles(warehouse_id);

-- ---------- 2) توسعة المستودعات والمواقع ----------
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS valuation_method VARCHAR(10) NOT NULL DEFAULT 'WAC'
    CHECK (valuation_method IN ('WAC','FIFO','STANDARD'));
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS allow_negative_stock BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE warehouse_locations ADD COLUMN IF NOT EXISTS barcode VARCHAR(60);
ALTER TABLE warehouse_locations ADD COLUMN IF NOT EXISTS picking_sequence INTEGER NOT NULL DEFAULT 0;
ALTER TABLE warehouse_locations ADD COLUMN IF NOT EXISTS max_capacity NUMERIC(18,4);
ALTER TABLE warehouse_locations ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_location_barcode ON warehouse_locations(barcode) WHERE barcode IS NOT NULL;

-- ---------- 3) توسعة الأصناف: مورد التنبؤ الأساسي + طريقة تقييم خاصة بالصنف (اختيارية) ----------
ALTER TABLE items ADD COLUMN IF NOT EXISTS lead_time_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE items ADD COLUMN IF NOT EXISTS safety_stock_days INTEGER NOT NULL DEFAULT 3;
ALTER TABLE items ADD COLUMN IF NOT EXISTS valuation_method VARCHAR(10)
    CHECK (valuation_method IN ('WAC','FIFO','STANDARD'));  -- NULL = يرث طريقة المستودع
ALTER TABLE items ADD COLUMN IF NOT EXISTS standard_cost NUMERIC(18,4);
ALTER TABLE items ADD COLUMN IF NOT EXISTS tracking_mode VARCHAR(10) NOT NULL DEFAULT 'NONE'
    CHECK (tracking_mode IN ('NONE','BATCH','SERIAL'));
ALTER TABLE items ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER;

-- ---------- 4) رصيد المخزون لكل مستودع/موقع (Multi-Warehouse Stock) ----------
CREATE TABLE IF NOT EXISTS warehouse_stock (
    id            SERIAL PRIMARY KEY,
    warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    location_id   INTEGER REFERENCES warehouse_locations(id) ON DELETE SET NULL,
    item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity      NUMERIC(18,4) NOT NULL DEFAULT 0,
    avg_cost      NUMERIC(18,4) NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (warehouse_id, location_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_wstock_item ON warehouse_stock(item_id);
CREATE INDEX IF NOT EXISTS idx_wstock_wh ON warehouse_stock(warehouse_id);

-- ---------- 5) دفعات (Batch) وسيريالات (Serial) للتتبع ----------
CREATE TABLE IF NOT EXISTS item_batches (
    id              SERIAL PRIMARY KEY,
    item_id         INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    location_id     INTEGER REFERENCES warehouse_locations(id) ON DELETE SET NULL,
    batch_number    VARCHAR(60) NOT NULL,
    mfg_date        DATE,
    expiry_date     DATE,
    qty_on_hand     NUMERIC(18,4) NOT NULL DEFAULT 0,
    unit_cost       NUMERIC(18,4) NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (item_id, warehouse_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_batches_item ON item_batches(item_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON item_batches(expiry_date);

CREATE TABLE IF NOT EXISTS item_serials (
    id              SERIAL PRIMARY KEY,
    item_id         INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    location_id     INTEGER REFERENCES warehouse_locations(id) ON DELETE SET NULL,
    batch_id        INTEGER REFERENCES item_batches(id) ON DELETE SET NULL,
    serial_number   VARCHAR(80) NOT NULL UNIQUE,
    status          VARCHAR(15) NOT NULL DEFAULT 'in_stock'
                    CHECK (status IN ('in_stock','reserved','issued','sold','returned','scrapped')),
    unit_cost       NUMERIC(18,4) NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_serials_item ON item_serials(item_id);
CREATE INDEX IF NOT EXISTS idx_serials_status ON item_serials(status);

-- ---------- 6) طبقات التكلفة لتقييم FIFO ----------
CREATE TABLE IF NOT EXISTS item_cost_layers (
    id              SERIAL PRIMARY KEY,
    item_id         INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    receipt_date    DATE NOT NULL,
    qty_remaining   NUMERIC(18,4) NOT NULL,
    unit_cost       NUMERIC(18,4) NOT NULL,
    source_type     VARCHAR(30),
    source_ref      VARCHAR(60),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_layers_item_wh ON item_cost_layers(item_id, warehouse_id, receipt_date);

-- ---------- 7) سجل حركات مخزون على مستوى المستودع/الموقع ----------
CREATE TABLE IF NOT EXISTS warehouse_stock_moves (
    id              SERIAL PRIMARY KEY,
    move_date       TIMESTAMPTZ NOT NULL DEFAULT now(),
    warehouse_id    INTEGER NOT NULL REFERENCES warehouses(id),
    location_id     INTEGER REFERENCES warehouse_locations(id),
    item_id         INTEGER NOT NULL REFERENCES items(id),
    batch_id        INTEGER REFERENCES item_batches(id),
    serial_id       INTEGER REFERENCES item_serials(id),
    move_type       VARCHAR(30) NOT NULL,   -- receipt / issue / transfer_out / transfer_in / adjustment / opening
    qty             NUMERIC(18,4) NOT NULL, -- موجب = وارد، سالب = صادر
    unit_cost       NUMERIC(18,4) NOT NULL DEFAULT 0,
    balance_after   NUMERIC(18,4) NOT NULL DEFAULT 0,
    source_type     VARCHAR(30),            -- stock_issue_request / stock_transfer / grn / manual
    source_ref      VARCHAR(60),
    created_by      INTEGER REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wsm_item_wh ON warehouse_stock_moves(item_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_wsm_source ON warehouse_stock_moves(source_type, source_ref);

-- ---------- 8) طلبات صرف مخزون (تتطلب اعتماد أمين المستودع) ----------
CREATE TABLE IF NOT EXISTS stock_issue_requests (
    id                  SERIAL PRIMARY KEY,
    request_number      VARCHAR(30) UNIQUE NOT NULL,
    warehouse_id        INTEGER NOT NULL REFERENCES warehouses(id),
    request_type        VARCHAR(20) NOT NULL DEFAULT 'sales'
                        CHECK (request_type IN ('sales','transfer_out','adjustment','other')),
    source_type         VARCHAR(30),        -- مثال: sales_invoice
    source_ref          VARCHAR(60),        -- رقم الفاتورة/المستند المرتبط
    status              VARCHAR(15) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','rejected','cancelled')),
    requested_by        INTEGER REFERENCES users(id),
    requested_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by          INTEGER REFERENCES users(id),
    decided_at          TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sir_status ON stock_issue_requests(status);
CREATE INDEX IF NOT EXISTS idx_sir_wh ON stock_issue_requests(warehouse_id);

CREATE TABLE IF NOT EXISTS stock_issue_request_lines (
    id              SERIAL PRIMARY KEY,
    request_id      INTEGER NOT NULL REFERENCES stock_issue_requests(id) ON DELETE CASCADE,
    item_id         INTEGER NOT NULL REFERENCES items(id),
    qty_requested   NUMERIC(18,4) NOT NULL CHECK (qty_requested > 0),
    batch_id        INTEGER REFERENCES item_batches(id),
    serial_id       INTEGER REFERENCES item_serials(id),
    unit_cost_snapshot NUMERIC(18,4)
);

CREATE INDEX IF NOT EXISTS idx_sirl_request ON stock_issue_request_lines(request_id);

-- ---------- 9) تحويلات بين المستودعات ----------
CREATE TABLE IF NOT EXISTS stock_transfers (
    id                  SERIAL PRIMARY KEY,
    transfer_number     VARCHAR(30) UNIQUE NOT NULL,
    from_warehouse_id   INTEGER NOT NULL REFERENCES warehouses(id),
    to_warehouse_id     INTEGER NOT NULL REFERENCES warehouses(id),
    status              VARCHAR(20) NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','pending_approval','in_transit','received','cancelled')),
    requested_by        INTEGER REFERENCES users(id),
    approved_by         INTEGER REFERENCES users(id),
    shipped_at          TIMESTAMPTZ,
    received_at         TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (from_warehouse_id <> to_warehouse_id)
);

CREATE TABLE IF NOT EXISTS stock_transfer_lines (
    id              SERIAL PRIMARY KEY,
    transfer_id     INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    item_id         INTEGER NOT NULL REFERENCES items(id),
    qty             NUMERIC(18,4) NOT NULL CHECK (qty > 0),
    batch_id        INTEGER REFERENCES item_batches(id),
    serial_id       INTEGER REFERENCES item_serials(id),
    unit_cost_snapshot NUMERIC(18,4)
);

CREATE INDEX IF NOT EXISTS idx_stl_transfer ON stock_transfer_lines(transfer_id);

-- ---------- 10) حسابات محاسبية إضافية يحتاجها المديول (تقادم/فروقات جرد) ----------
-- ملاحظة: لا نفترض وجود '11' أو '5' بالضبط في شجرة حساباتك (قد تختلف الأكواد
-- من مشروع لآخر)، لذلك نتحقق ديناميكياً؛ إن لم يوجد الأب المقترح تُنشأ
-- الحسابات بدون أب (parent_code = NULL) ويمكنك ترتيبها لاحقاً من شاشة دليل
-- الحسابات في النظام.
DO $$
DECLARE
    assets_parent   VARCHAR(20);
    expenses_parent VARCHAR(20);
BEGIN
    SELECT code INTO assets_parent FROM accounts WHERE code = '11';
    IF assets_parent IS NULL THEN
        SELECT code INTO assets_parent FROM accounts WHERE code = '1';
    END IF;

    SELECT code INTO expenses_parent FROM accounts WHERE code = '5';

    IF NOT EXISTS (SELECT 1 FROM accounts WHERE code = '124') THEN
        INSERT INTO accounts (code, name_ar, name_en, account_type, parent_code, opening_balance)
        VALUES ('124', 'مخزون بضاعة في الطريق (تحويل)', 'Stock in Transit', 'assets', assets_parent, 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM accounts WHERE code = '52') THEN
        INSERT INTO accounts (code, name_ar, name_en, account_type, parent_code, opening_balance)
        VALUES ('52', 'فروقات جرد ومخزون تالف/متقادم', 'Inventory Adjustments & Obsolescence', 'expenses', expenses_parent, 0);
    END IF;
END $$;
