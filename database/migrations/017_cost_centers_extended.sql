-- =========================================================
-- LEGEND D ERP — Migration 017: تطوير شاشة مراكز التكلفة
-- يضيف الهيكل الهرمي (مركز رئيسي/فرعي)، نوع المركز (تكلفة/ربحية)،
-- المسؤول، الموازنة التقديرية، والملاحظات — لدعم شاشة مراكز تكلفة
-- عصرية تصلح للشركات الصغيرة (بدون تفريع) والكبيرة (فروع/إدارات
-- متداخلة) على حد سواء.
-- Idempotent: safe to re-run.
-- =========================================================

ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS parent_code   VARCHAR(20) REFERENCES cost_centers(code);
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS cc_type       VARCHAR(20) NOT NULL DEFAULT 'cost';
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS manager_name  VARCHAR(150);
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS budget_amount NUMERIC(18,2) NOT NULL DEFAULT 0;
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS notes         TEXT;
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_cost_center_type') THEN
        ALTER TABLE cost_centers
            ADD CONSTRAINT ck_cost_center_type CHECK (cc_type IN ('cost','profit'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cost_centers_parent ON cost_centers(parent_code);

INSERT INTO schema_migrations (version) VALUES ('017_cost_centers_extended')
ON CONFLICT (version) DO NOTHING;
