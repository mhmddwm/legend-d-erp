-- =========================================================
-- LEGEND D ERP — Migration 025: سجل نشاط حقيقي لفاتورة المشتريات + ملاحظات
--
-- خدمة AuditService الحالية بالكود (core/audit/audit_service.py) هيكل
-- فارغ بدون تخزين فعلي ("Persistence will be connected in a later
-- sprint"). هذه الهجرة تنشئ الجدول الفعلي وتربطه بفاتورة المشتريات
-- تحديداً: كل عملية إنشاء/تعديل/إلغاء/ملاحظة/تعيين مركز تكلفة تُسجَّل
-- بالمستخدم والتوقيت الفعلي (دقيقة/ثانية).
-- Idempotent: safe to re-run.
-- =========================================================

CREATE TABLE IF NOT EXISTS audit_log (
    id          SERIAL PRIMARY KEY,
    entity_type VARCHAR(40) NOT NULL,   -- مثال: purchase_invoice
    entity_id   VARCHAR(40) NOT NULL,   -- مثال: رقم الفاتورة
    action      VARCHAR(40) NOT NULL,   -- created / edited / cancelled / note_added / cost_center_assigned ...
    actor       VARCHAR(120),
    details     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id, created_at);

ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS notes TEXT;

INSERT INTO schema_migrations (version) VALUES ('025_purchase_invoice_activity_log')
ON CONFLICT (version) DO NOTHING;
