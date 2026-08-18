-- =========================================================
-- LEGEND D ERP — Migration 030: العملاء + فاتورة المبيعات المباشرة (المرحلة 1 من موديول المبيعات)
--
-- مرآة كاملة لبنية فاتورة المشتريات: عميل (نظير المورد) + فاتورة
-- مبيعات مباشرة تُنقص المخزون فوراً (نظير الفاتورة المباشرة بالمشتريات)
-- مع ضريبة وترحيل قيد محاسبي تلقائي مزدوج:
--   1) مدين حساب العميل (إجمالي شامل الضريبة) / دائن إيرادات المبيعات
--      [+ دائن ضريبة المبيعات المستحقة]
--   2) مدين تكلفة البضاعة المباعة / دائن المخزون (بالتكلفة المتوسطة
--      الحالية للصنف وقت البيع — لا تُعدَّل التكلفة المتوسطة نفسها،
--      فقط الكمية تنخفض، تماماً كما لا يُعاد حساب WAC عند المرتجعات)
--
-- الحسابات المطلوبة (112/1121 الذمم المدينة/العملاء، 214 ضريبة
-- المبيعات المستحقة، 41 إيرادات المبيعات، 51 تكلفة البضاعة المباعة)
-- موجودة أصلاً بدليل الحسابات الافتراضي (Migration 003) — لم تكن
-- مستخدَمة من أي كود فعلي حتى الآن.
--
-- ملاحظة: نوع الضريبة المستخدَم بالمبيعات يجب أن يكون سجلاً منفصلاً
-- (حتى لو بنفس النسبة) عن نوع ضريبة المشتريات، لأن حساب الضريبة
-- يختلف: 214 (التزام) بالمبيعات مقابل 125 (أصل قابل للخصم) بالمشتريات.
--
-- Idempotent: safe to re-run.
-- =========================================================

CREATE TABLE IF NOT EXISTS customers (
    code              VARCHAR(30) PRIMARY KEY,
    name              VARCHAR(200) NOT NULL,
    phone             VARCHAR(30),
    email             VARCHAR(120),
    notes             TEXT,
    account_code      VARCHAR(20) REFERENCES accounts(code),
    payment_terms_days INTEGER NOT NULL DEFAULT 0,
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

UPDATE customers SET account_code = '1121' WHERE account_code IS NULL;

CREATE TABLE IF NOT EXISTS sales_invoices (
    inv_number          VARCHAR(30) PRIMARY KEY,
    inv_date             DATE NOT NULL,
    customer_code        VARCHAR(30) NOT NULL REFERENCES customers(code),
    customer_ref_number  VARCHAR(60),
    warehouse_id         INTEGER REFERENCES warehouses(id),
    location_id          INTEGER REFERENCES warehouse_locations(id),
    subtotal             NUMERIC(18,2) NOT NULL DEFAULT 0,
    tax_type_code        VARCHAR(20) REFERENCES tax_types(code),
    tax_amount           NUMERIC(18,2) NOT NULL DEFAULT 0,
    total                NUMERIC(18,2) NOT NULL DEFAULT 0,
    cogs_total            NUMERIC(18,2) NOT NULL DEFAULT 0,
    payment_terms_days   INTEGER NOT NULL DEFAULT 0,
    cost_center_code     VARCHAR(20) REFERENCES cost_centers(code),
    status               VARCHAR(20) NOT NULL DEFAULT 'posted',
    journal_entry_id     INTEGER REFERENCES journal_entries(id),
    notes                TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer ON sales_invoices(customer_code);

CREATE TABLE IF NOT EXISTS sales_invoice_lines (
    id           SERIAL PRIMARY KEY,
    inv_number   VARCHAR(30) NOT NULL REFERENCES sales_invoices(inv_number) ON DELETE CASCADE,
    item_id      INTEGER NOT NULL REFERENCES items(id),
    qty          NUMERIC(18,4) NOT NULL,
    unit_price   NUMERIC(18,4) NOT NULL,
    unit_cost    NUMERIC(18,4) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_inv ON sales_invoice_lines(inv_number);

INSERT INTO schema_migrations (version) VALUES ('030_customers_sales_invoice')
ON CONFLICT (version) DO NOTHING;
