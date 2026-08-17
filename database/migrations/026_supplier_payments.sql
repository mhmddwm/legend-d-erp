-- =========================================================
-- LEGEND D ERP — Migration 026: مدفوعات الموردين
--
-- يكمل دورة المشتريات المحاسبية: فاتورة (دائن) ← مرتجع (مدين جزئي) ←
-- سداد (مدين). كل دفعة تُخصَّص صراحةً على فاتورة أو أكثر (لا "خصم
-- عام من الرصيد" بدون تحديد أي فاتورة سُدِّدت) — هذا هو الفرق الجوهري
-- بين سجل مدفوعات حقيقي ودفتر بسيط، ويتيح معرفة أي فاتورة مسدَّدة
-- بالكامل وأيها لسه مفتوحة جزئياً.
--
-- القيد المحاسبي التلقائي: مدين حساب المورد (يُخفِّض المستحق) / دائن
-- حساب النقدية أو البنك المُحدَّد.
--
-- Idempotent: safe to re-run.
-- =========================================================

CREATE TABLE IF NOT EXISTS supplier_payments (
    payment_number   VARCHAR(30) PRIMARY KEY,
    payment_date     DATE NOT NULL,
    supplier_code    VARCHAR(30) NOT NULL REFERENCES suppliers(code),
    payment_method   VARCHAR(20) NOT NULL DEFAULT 'bank_transfer',
    account_code     VARCHAR(20) NOT NULL REFERENCES accounts(code),
    reference        VARCHAR(120),
    notes            TEXT,
    amount           NUMERIC(18,2) NOT NULL DEFAULT 0,
    status           VARCHAR(20) NOT NULL DEFAULT 'posted',
    journal_entry_id INTEGER REFERENCES journal_entries(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_code);

CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
    id               SERIAL PRIMARY KEY,
    payment_number   VARCHAR(30) NOT NULL REFERENCES supplier_payments(payment_number) ON DELETE CASCADE,
    inv_number       VARCHAR(30) NOT NULL REFERENCES purchase_invoices(inv_number),
    amount           NUMERIC(18,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_spa_payment ON supplier_payment_allocations(payment_number);
CREATE INDEX IF NOT EXISTS idx_spa_invoice ON supplier_payment_allocations(inv_number);

INSERT INTO schema_migrations (version) VALUES ('026_supplier_payments')
ON CONFLICT (version) DO NOTHING;
