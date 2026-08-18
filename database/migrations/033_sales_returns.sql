-- =========================================================
-- LEGEND D ERP — Migration 033: مرتجعات المبيعات
--
-- عكس تناسبي مزدوج لقيد فاتورة المبيعات (بعكس مرتجع المشتريات الذي
-- يعكس قيداً واحداً فقط، لأن فاتورة المبيعات نفسها قيدان: إيراد+ضريبة،
-- وتكلفة بضاعة مباعة):
--   1) مدين إيرادات المبيعات [+ مدين ضريبة المبيعات المستحقة] / دائن
--      حساب العميل — تخفيض تناسبي لما استحق على العميل
--   2) مدين المخزون / دائن تكلفة البضاعة المباعة — إرجاع البضاعة
--      للمخزون بنفس التكلفة المسجَّلة وقت البيع (مخزَّنة على سطر
--      الفاتورة الأصلية بالفعل: sales_invoice_lines.unit_cost)
--
-- يعمل بنفس المنطق بصرف النظر عن كون الفاتورة الأصلية مباشرة أو
-- مرتبطة بإذن تسليم — لأن البضاعة تعود فعلياً بغض النظر عن توقيت
-- ترحيل قيد التكلفة الأصلي.
--
-- Idempotent: safe to re-run.
-- =========================================================

CREATE TABLE IF NOT EXISTS sales_returns (
    rt_number         VARCHAR(30) PRIMARY KEY,
    rt_date           DATE NOT NULL,
    customer_code     VARCHAR(30) NOT NULL REFERENCES customers(code),
    inv_number        VARCHAR(30) NOT NULL REFERENCES sales_invoices(inv_number),
    subtotal          NUMERIC(18,2) NOT NULL DEFAULT 0,
    tax_type_code     VARCHAR(20) REFERENCES tax_types(code),
    tax_amount        NUMERIC(18,2) NOT NULL DEFAULT 0,
    total             NUMERIC(18,2) NOT NULL DEFAULT 0,
    cogs_total        NUMERIC(18,2) NOT NULL DEFAULT 0,
    status            VARCHAR(20) NOT NULL DEFAULT 'posted',
    journal_entry_id  INTEGER REFERENCES journal_entries(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_returns_customer ON sales_returns(customer_code);
CREATE INDEX IF NOT EXISTS idx_sales_returns_invoice ON sales_returns(inv_number);

CREATE TABLE IF NOT EXISTS sales_return_lines (
    id          SERIAL PRIMARY KEY,
    rt_number   VARCHAR(30) NOT NULL REFERENCES sales_returns(rt_number) ON DELETE CASCADE,
    item_id     INTEGER NOT NULL REFERENCES items(id),
    qty         NUMERIC(18,4) NOT NULL,
    unit_price  NUMERIC(18,4) NOT NULL,
    unit_cost   NUMERIC(18,4) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sales_return_lines_rt ON sales_return_lines(rt_number);

INSERT INTO schema_migrations (version) VALUES ('033_sales_returns')
ON CONFLICT (version) DO NOTHING;
