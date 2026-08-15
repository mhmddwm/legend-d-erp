-- =========================================================
-- LEGEND D ERP — Migration 020: فترة السماح ومركز التكلفة بفاتورة المشتريات
-- يضيف فترة سماح افتراضية لكل مورد (بالأيام) تُستخدم لتعبئة فترة سماح
-- فاتورة الشراء تلقائياً عند اختيار المورد، مع إبقائها قابلة للتعديل
-- اليدوي على مستوى كل فاتورة. تاريخ الاستحقاق (لاستخدامه لاحقاً في
-- تقارير أعمار الديون) يُحسب من تاريخ الفاتورة + فترة السماح ولا
-- يُخزَّن كعمود منفصل. كما يضيف حقل مركز التكلفة الاختياري لتحليل
-- تكاليف المشتريات حسب الإدارة/الفرع.
-- Idempotent: safe to re-run.
-- =========================================================

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER NOT NULL DEFAULT 0;

ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS cost_center_code VARCHAR(20) REFERENCES cost_centers(code);

CREATE INDEX IF NOT EXISTS idx_purchase_invoices_cost_center ON purchase_invoices(cost_center_code);

INSERT INTO schema_migrations (version) VALUES ('020_purchase_invoice_terms_costcenter')
ON CONFLICT (version) DO NOTHING;
