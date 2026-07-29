-- =========================================================
-- LEGEND D ERP — Migration 012: الضريبة + رقم الفاتورة + المورد بالقيد
-- يدعم قيوداً ذات طبيعة خاصة (مثل مصروف عليه ضريبة قيمة مضافة)، مع
-- ربط اختياري برقم فاتورة ومورد، حتى تظهر العملية كاملة بتقارير الضرائب.
-- Idempotent: safe to re-run.
-- =========================================================

-- رقم الفاتورة والمورد على مستوى رأس القيد (اختياريان)
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(50);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS supplier_code VARCHAR(30) REFERENCES suppliers(code);

-- الضريبة على مستوى السطر (بعض أسطر القيد فقط قد تحمل ضريبة، مثل سطر المصروف)
ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2);
ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(18,2);

CREATE INDEX IF NOT EXISTS idx_journal_invoice_number ON journal_entries(invoice_number);
CREATE INDEX IF NOT EXISTS idx_journal_supplier_code ON journal_entries(supplier_code);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(50) PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('012_journal_tax_invoice_supplier')
ON CONFLICT (version) DO NOTHING;
