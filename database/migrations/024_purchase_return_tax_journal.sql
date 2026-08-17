-- =========================================================
-- LEGEND D ERP — Migration 024: ضريبة مرتجع المشتريات + الترحيل المحاسبي التلقائي
--
-- حتى الآن كان مرتجع المشتريات يخصم القيمة الصافية فقط من رصيد
-- المورد (calc_payable) رغم أن الفاتورة الأصلية كانت تُحسب شاملة
-- الضريبة — ما يجعل رصيد المورد بعد أي مرتجع مبالغاً فيه بمقدار حصة
-- الضريبة من المرتجع. هذه الهجرة تصحح ذلك: يُحسب نصيب المرتجع من
-- الضريبة تناسبياً من الفاتورة الأصلية، ويُرحَّل قيد محاسبي تلقائي
-- (مدين حساب المورد / دائن المخزون [+ دائن حساب الضريبة]) يعكس تماماً
-- قيد الفاتورة الأصلية بنفس منطق الحسابات المستخدَم فيها.
--
-- Idempotent: safe to re-run.
-- =========================================================

ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS subtotal NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS tax_type_code VARCHAR(20) REFERENCES tax_types(code);
ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS journal_entry_id INTEGER REFERENCES journal_entries(id);
ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'posted';

-- المرتجعات القديمة (قبل دعم الضريبة) كان إجماليها كله صافياً بدون ضريبة
UPDATE purchase_returns SET subtotal = total WHERE subtotal = 0 AND total <> 0;

CREATE INDEX IF NOT EXISTS idx_purchase_returns_journal ON purchase_returns(journal_entry_id);

INSERT INTO schema_migrations (version) VALUES ('024_purchase_return_tax_journal')
ON CONFLICT (version) DO NOTHING;
