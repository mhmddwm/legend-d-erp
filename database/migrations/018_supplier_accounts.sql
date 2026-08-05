-- =========================================================
-- LEGEND D ERP — Migration 018: حساب الموردين الاحترافي بدليل الحسابات
-- يضيف تحت حساب الموردين الرئيسي (211) فرعين ثابتين من أساسيات
-- النظام: موردون - نشاط الشركة الأساسي / موردون - أنشطة أخرى،
-- بنفس منطق أودو وساب (Default Payable Account لكل مورد)، ويربط كل
-- مورد موجود مسبقاً بحساب "نشاط الشركة الأساسي" افتراضياً.
-- Idempotent: safe to re-run.
-- =========================================================

-- علامة "حساب نظامي" حتى لا يُحذف بالخطأ من شاشة دليل الحسابات
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;

-- الحسابات الفرعية الثابتة تحت حساب الموردين (211)
INSERT INTO accounts (code, name_ar, name_en, account_type, nature, parent_code, opening_balance, is_system) VALUES
('2111', 'موردون - نشاط الشركة الأساسي', 'Suppliers - Core Business Activity', 'liabilities', 'دائن', '211', 0, TRUE),
('2112', 'موردون - أنشطة أخرى',          'Suppliers - Other Activities',       'liabilities', 'دائن', '211', 0, TRUE)
ON CONFLICT (code) DO NOTHING;

-- تحديد حساب الموردين الرئيسي وفروعه كحسابات نظامية غير قابلة للحذف
UPDATE accounts SET is_system = TRUE WHERE code IN ('211','2111','2112');

-- ربط الموردين بالحساب المحاسبي المناسب
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS account_code VARCHAR(20) REFERENCES accounts(code);

-- أي مورد موجود مسبقاً بلا حساب محدد يُربط تلقائياً بحساب "نشاط الشركة الأساسي"
UPDATE suppliers SET account_code = '2111' WHERE account_code IS NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_account ON suppliers(account_code);

INSERT INTO schema_migrations (version) VALUES ('018_supplier_accounts')
ON CONFLICT (version) DO NOTHING;
