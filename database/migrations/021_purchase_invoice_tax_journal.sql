-- =========================================================
-- LEGEND D ERP — Migration 021: ضريبة فاتورة المشتريات + الترحيل المحاسبي التلقائي
-- يضيف حقول الضريبة (نوع الضريبة، صافي القيمة، مبلغ الضريبة) لفاتورة
-- المشتريات، ورابط القيد المحاسبي الناتج عن ترحيلها تلقائياً
-- (مدين المخزون [+ مدين ضريبة المشتريات القابلة للخصم إن وُجد حساب
-- مرتبط بنوع الضريبة] / دائن حساب المورد بدليل الحسابات).
-- Idempotent: safe to re-run.
-- =========================================================

ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS subtotal NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS tax_type_code VARCHAR(20) REFERENCES tax_types(code);
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS journal_entry_id INTEGER REFERENCES journal_entries(id);

-- الفواتير الموجودة مسبقاً (قبل دعم الضريبة) لم يكن لها صافي منفصل عن الإجمالي
UPDATE purchase_invoices SET subtotal = total WHERE subtotal = 0 AND total <> 0;

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_journal ON purchase_invoices(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_purchase_invoices_tax_type ON purchase_invoices(tax_type_code);

INSERT INTO schema_migrations (version) VALUES ('021_purchase_invoice_tax_journal')
ON CONFLICT (version) DO NOTHING;
