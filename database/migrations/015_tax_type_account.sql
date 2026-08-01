-- =========================================================
-- LEGEND D ERP — Migration 015: ربط أنواع الضرائب بحساب فعلي بدليل الحسابات
-- بدون هذا الربط، الضريبة تبقى مجرد "ملاحظة" على سطر المصروف ولا تُرحّل
-- كسطر قيد مستقل، فلا تظهر أبداً عند فتح حساب أستاذ الضريبة.
-- Idempotent: safe to re-run.
-- =========================================================

ALTER TABLE tax_types ADD COLUMN IF NOT EXISTS account_code VARCHAR(20) REFERENCES accounts(code);

CREATE INDEX IF NOT EXISTS idx_tax_types_account ON tax_types(account_code);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(50) PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('015_tax_type_account')
ON CONFLICT (version) DO NOTHING;
