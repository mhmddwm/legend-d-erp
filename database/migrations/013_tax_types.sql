-- =========================================================
-- LEGEND D ERP — Migration 013: أنواع الضرائب المسجلة بالنظام
-- بدل إدخال نسبة الضريبة يدوياً بكل سطر، يختار المستخدم من قائمة
-- أنواع ضرائب مسجلة مسبقاً بالنظام (مثل: ضريبة قيمة مضافة 15%،
-- معفى، صفري)، وتُحسب القيمة تلقائياً.
-- Idempotent: safe to re-run.
-- =========================================================

CREATE TABLE IF NOT EXISTS tax_types (
    code            VARCHAR(20) PRIMARY KEY,
    name_ar         VARCHAR(100) NOT NULL,
    name_en         VARCHAR(100),
    rate            NUMERIC(5,2) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ربط سطر القيد بنوع الضريبة المختار (نسبة السطر tax_rate تبقى نسخة
-- مجمّدة وقت إنشاء القيد، حتى لو تغيّرت نسبة نوع الضريبة لاحقاً)
ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS tax_type_code VARCHAR(20) REFERENCES tax_types(code);

-- بيانات ابتدائية شائعة (يمكن تعديلها أو إضافة المزيد لاحقاً)
INSERT INTO tax_types (code, name_ar, name_en, rate) VALUES
    ('VAT15', 'ضريبة القيمة المضافة 15%', 'VAT 15%', 15.00),
    ('VAT0',  'ضريبة صفرية 0%', 'Zero-rated 0%', 0.00),
    ('EXEMPT','معفى من الضريبة', 'Tax Exempt', 0.00)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(50) PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('013_tax_types')
ON CONFLICT (version) DO NOTHING;
