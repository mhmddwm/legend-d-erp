-- =========================================================
-- LEGEND D ERP — Migration 019: منع تكرار رقم فاتورة المورد بالقيود
-- يضمن عدم تسجيل نفس رقم فاتورة المورد أكثر من مرة لنفس المورد على
-- مستوى قاعدة البيانات (طبقة حماية إضافية خلف تحقق الـ API)، أسوة
-- بمنطق منع تكرار فواتير الموردين بأودو/ساب.
-- Idempotent: safe to re-run.
-- =========================================================

-- فهرس فريد جزئي: يُطبَّق فقط عندما يكون كل من المورد ورقم الفاتورة
-- محددين معاً (الحقلان اختياريان)، ويستثني القيود الملغاة حتى يمكن
-- إعادة استخدام نفس رقم الفاتورة بعد إلغاء قيد خاطئ.
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_supplier_invoice_number
    ON journal_entries (supplier_code, invoice_number)
    WHERE supplier_code IS NOT NULL
      AND invoice_number IS NOT NULL
      AND status <> 'cancelled';

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(50) PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('019_journal_invoice_number_unique')
ON CONFLICT (version) DO NOTHING;
