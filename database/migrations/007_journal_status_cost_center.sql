-- =========================================================
-- LEGEND D ERP — Migration 007: حالة القيد ومراكز التكلفة
-- يضيف حقل حالة القيد (مرحّل/ملغي) ومراكز التكلفة لدعم شاشة
-- البحث المتقدم الجديدة في القيود اليومية.
-- Idempotent: safe to re-run.
-- =========================================================

-- 1) جدول مراكز التكلفة
CREATE TABLE IF NOT EXISTS cost_centers (
    code            VARCHAR(20) PRIMARY KEY,
    name_ar         VARCHAR(200) NOT NULL,
    name_en         VARCHAR(200),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) أعمدة جديدة على رأس القيد
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'posted';
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS cost_center_code VARCHAR(20) REFERENCES cost_centers(code);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_journal_status') THEN
        ALTER TABLE journal_entries
            ADD CONSTRAINT chk_journal_status CHECK (status IN ('posted','cancelled'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_journal_status       ON journal_entries(status);
CREATE INDEX IF NOT EXISTS idx_journal_cost_center  ON journal_entries(cost_center_code);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(50) PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('007_journal_status_cost_center')
ON CONFLICT (version) DO NOTHING;
