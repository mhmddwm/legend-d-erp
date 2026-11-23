-- =========================================================
-- LEGEND D ERP — Migration 037: قوالب وحدات متعددة المستويات
-- ---------------------------------------------------------
-- القالب كان يحمل وحدة أعلى واحدة فقط (حبة ← كرتون). الآن يحمل عدة مستويات:
--   حبة ← شدة (تحوي 12 حبة) ← كرتون (يحوي 6 شدات = 72 حبة)
-- كل مستوى: اسم الوحدة + كم يحوي من الوحدة السابقة (per_parent) + المعامل التراكمي بالنسبة
-- للوحدة الأساسية (factor). تبقى أعمدة unit_templates.higher_unit/factor تعكس
-- أكبر مستوى (توافق مع الشاشات والتقارير القديمة).
--
-- Idempotent: safe to re-run.
-- =========================================================

CREATE TABLE IF NOT EXISTS unit_template_levels (
    id             SERIAL PRIMARY KEY,
    template_code  VARCHAR(30) NOT NULL REFERENCES unit_templates(code) ON DELETE CASCADE,
    level_no       INTEGER NOT NULL,
    unit_name      VARCHAR(50) NOT NULL,
    per_parent     NUMERIC(18,4) NOT NULL,
    factor         NUMERIC(18,4) NOT NULL,
    CONSTRAINT uq_utl_code_level UNIQUE (template_code, level_no),
    CONSTRAINT ck_utl_factors CHECK (per_parent > 1 AND factor > 1)
);
CREATE INDEX IF NOT EXISTS idx_utl_template ON unit_template_levels(template_code);

-- القوالب الحالية (وحدة أعلى واحدة) تصبح مستوى أول
INSERT INTO unit_template_levels (template_code, level_no, unit_name, per_parent, factor)
SELECT t.code, 1, t.higher_unit, t.factor, t.factor
FROM unit_templates t
WHERE t.higher_unit IS NOT NULL AND t.higher_unit <> '' AND t.factor > 1
  AND NOT EXISTS (SELECT 1 FROM unit_template_levels l WHERE l.template_code = t.code);

INSERT INTO schema_migrations (version) VALUES ('037_unit_template_levels')
ON CONFLICT (version) DO NOTHING;
