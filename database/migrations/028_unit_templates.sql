-- =========================================================
-- LEGEND D ERP — Migration 028: قوالب الوحدات (المرحلة 2)
--
-- يطابق الشكل الذي يتوقعه منطق تحويل الوحدات الموجود أصلاً بالفرونت
-- إند (getItemUnitFactor / getTemplateUnitsForItem): وحدة أساسية +
-- وحدة أعلى اختيارية بمعامل تحويل واحد (مثال: قطعة ← كرتون ×12)،
-- مع سعر أدنى/أعلى اختياري لكل مستوى وحدة.
--
-- ملاحظة: هذه الهجرة تضيف الجدول فقط. ربط شاشة المنتجات والفرونت إند
-- بها مؤجَّل لجلسة لاحقة بميزانية كاملة (تم إيقاف العمل هنا عمداً
-- عند حد آمن حتى لا تُترك شاشات موجودة في حالة عمل جزئي).
--
-- Idempotent: safe to re-run.
-- =========================================================

CREATE TABLE IF NOT EXISTS unit_templates (
    code         VARCHAR(30) PRIMARY KEY,
    name         VARCHAR(200) NOT NULL,
    base_unit    VARCHAR(50) NOT NULL,
    higher_unit  VARCHAR(50),
    factor       NUMERIC(18,4) NOT NULL DEFAULT 1,
    min_price    NUMERIC(18,4),
    max_price    NUMERIC(18,4),
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('028_unit_templates')
ON CONFLICT (version) DO NOTHING;
