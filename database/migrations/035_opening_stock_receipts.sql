-- =========================================================
-- LEGEND D ERP — Migration 035: إذن إضافة تلقائي للرصيد الافتتاحي
-- ---------------------------------------------------------
-- عند إضافة صنف برصيد افتتاحي ينشئ النظام إذن إضافة (إذن استلام بلا مورد،
-- حالته invoice_status = 'opening') مع قيد: مدين المخزون (123) / دائن
-- أرصدة افتتاحية — مخزون (34).
--
-- 1) المورد اختياري في أذون الاستلام (إذن الرصيد الافتتاحي لا مورد له).
-- 2) حساب حقوق ملكية نظامي للطرف الدائن: 34.
--
-- Idempotent: safe to re-run.
-- =========================================================

ALTER TABLE goods_receipts ALTER COLUMN supplier_code DROP NOT NULL;

INSERT INTO accounts (code, name_ar, name_en, account_type, nature, parent_code, opening_balance) VALUES
('3', 'حقوق الملكية', 'Equity', 'equity', 'دائن', NULL, 0)
ON CONFLICT (code) DO NOTHING;

INSERT INTO accounts (code, name_ar, name_en, account_type, nature, parent_code, opening_balance, is_system) VALUES
('34', 'أرصدة افتتاحية — مخزون', 'Opening Stock Balances', 'equity', 'دائن', '3', 0, TRUE)
ON CONFLICT (code) DO NOTHING;

UPDATE accounts SET is_system = TRUE WHERE code = '34';

INSERT INTO schema_migrations (version) VALUES ('035_opening_stock_receipts')
ON CONFLICT (version) DO NOTHING;
