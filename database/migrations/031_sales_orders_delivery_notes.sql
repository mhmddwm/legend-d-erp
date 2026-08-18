-- =========================================================
-- LEGEND D ERP — Migration 031: أمر بيع + إذن تسليم (المرحلة 2 من موديول المبيعات)
--
-- يكمل دورة المبيعات الكاملة: أمر بيع (بلا أثر محاسبي/مخزني، مجرد
-- التزام) ← إذن تسليم (يُخفِّض المخزون فوراً ويُرحِّل قيد تكلفة
-- البضاعة المباعة وقت خروج البضاعة فعلياً) ← فاتورة (تُرحِّل الإيراد
-- والذمة فقط إن كانت مرتبطة بإذن تسليم سابق، أو الاثنين معاً كما هو
-- الحال حالياً في حالة الفاتورة المباشرة بلا إذن تسليم منفصل).
--
-- هذا هو نفس مبدأ "بضاعة مستلمة غير مفوترة" بالمشتريات، لكن معكوساً:
-- بدل تأجيل قيد المخزون حتى الفاتورة، نُرحِّل تكلفة البضاعة المباعة
-- فور خروجها فعلياً (إذن التسليم)، وتبقى الفاتورة مسؤولة عن الإيراد
-- والذمة فقط — لأن التكلفة تُحسم لحظة فقدان السيطرة على البضاعة، بينما
-- الإيراد يُعترف به وقت الفوترة (نفس مبدأ "نقطة الاعتراف" في المحاسبة).
--
-- Idempotent: safe to re-run.
-- =========================================================

CREATE TABLE IF NOT EXISTS sales_orders (
    so_number      VARCHAR(30) PRIMARY KEY,
    so_date        DATE NOT NULL,
    customer_code  VARCHAR(30) NOT NULL REFERENCES customers(code),
    status         VARCHAR(20) NOT NULL DEFAULT 'open',
    total          NUMERIC(18,2) NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_order_lines (
    id          SERIAL PRIMARY KEY,
    so_number   VARCHAR(30) NOT NULL REFERENCES sales_orders(so_number) ON DELETE CASCADE,
    item_id     INTEGER NOT NULL REFERENCES items(id),
    qty         NUMERIC(18,4) NOT NULL,
    unit_price  NUMERIC(18,4) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_order_lines_so ON sales_order_lines(so_number);

CREATE TABLE IF NOT EXISTS delivery_notes (
    dn_number         VARCHAR(30) PRIMARY KEY,
    dn_date           DATE NOT NULL,
    customer_code     VARCHAR(30) NOT NULL REFERENCES customers(code),
    so_number         VARCHAR(30) REFERENCES sales_orders(so_number),
    warehouse_id      INTEGER REFERENCES warehouses(id),
    location_id       INTEGER REFERENCES warehouse_locations(id),
    cogs_total        NUMERIC(18,2) NOT NULL DEFAULT 0,
    invoice_status    VARCHAR(20) NOT NULL DEFAULT 'not_invoiced',
    journal_entry_id  INTEGER REFERENCES journal_entries(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_notes_customer ON delivery_notes(customer_code);

CREATE TABLE IF NOT EXISTS delivery_note_lines (
    id          SERIAL PRIMARY KEY,
    dn_number   VARCHAR(30) NOT NULL REFERENCES delivery_notes(dn_number) ON DELETE CASCADE,
    item_id     INTEGER NOT NULL REFERENCES items(id),
    qty         NUMERIC(18,4) NOT NULL,
    unit_cost   NUMERIC(18,4) NOT NULL DEFAULT 0,
    unit_price  NUMERIC(18,4) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_delivery_note_lines_dn ON delivery_note_lines(dn_number);

ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS delivery_number VARCHAR(30) REFERENCES delivery_notes(dn_number);
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS so_number VARCHAR(30) REFERENCES sales_orders(so_number);

INSERT INTO schema_migrations (version) VALUES ('031_sales_orders_delivery_notes')
ON CONFLICT (version) DO NOTHING;
