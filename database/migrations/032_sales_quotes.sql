-- =========================================================
-- LEGEND D ERP — Migration 032: عرض سعر بيع (أول حلقة بدورة المبيعات)
--
-- عرض سعر يُقدَّم للعميل قبل أي التزام فعلي (أمر بيع) — بلا أي أثر
-- محاسبي أو مخزني، مع تاريخ صلاحية وحالة (مسودة/مُرسَل/مقبول/مرفوض/
-- منتهي الصلاحية/محوَّل لأمر بيع). يمكن تحويله مباشرة إلى أمر بيع
-- حقيقي بضغطة واحدة عند قبول العميل.
--
-- Idempotent: safe to re-run.
-- =========================================================

CREATE TABLE IF NOT EXISTS sales_quotes (
    quote_number   VARCHAR(30) PRIMARY KEY,
    quote_date     DATE NOT NULL,
    customer_code  VARCHAR(30) NOT NULL REFERENCES customers(code),
    valid_until    DATE,
    status         VARCHAR(20) NOT NULL DEFAULT 'draft',
    total          NUMERIC(18,2) NOT NULL DEFAULT 0,
    so_number      VARCHAR(30) REFERENCES sales_orders(so_number),
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_quotes_customer ON sales_quotes(customer_code);

CREATE TABLE IF NOT EXISTS sales_quote_lines (
    id            SERIAL PRIMARY KEY,
    quote_number  VARCHAR(30) NOT NULL REFERENCES sales_quotes(quote_number) ON DELETE CASCADE,
    item_id       INTEGER NOT NULL REFERENCES items(id),
    qty           NUMERIC(18,4) NOT NULL,
    unit_price    NUMERIC(18,4) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_quote_lines_quote ON sales_quote_lines(quote_number);

INSERT INTO schema_migrations (version) VALUES ('032_sales_quotes')
ON CONFLICT (version) DO NOTHING;
