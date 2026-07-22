-- =========================================================
-- LEGEND D ERP — Migration 008: الفروع (Branches)
-- ينشئ جدول الفروع فعلياً (كان الموديل والراوتر موجودين بدون جدول)،
-- ويربط القيود اليومية بالفرع لدعم فلترة أرصدة دليل الحسابات حسب الفرع.
-- Idempotent: safe to re-run.
-- =========================================================

CREATE TABLE IF NOT EXISTS branches (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(20) UNIQUE NOT NULL,
    name_ar     VARCHAR(200) NOT NULL,
    name_en     VARCHAR(200),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- فرع افتراضي حتى لا تنكسر القيود الحالية (تُنسب كلها للفرع الرئيسي تلقائياً)
INSERT INTO branches (code, name_ar, name_en)
VALUES ('MAIN', 'الفرع الرئيسي', 'Main Branch')
ON CONFLICT (code) DO NOTHING;

-- ربط القيود اليومية بالفرع (Integer FK يطابق ما هو مُعرَّف بالفعل بنموذج JournalEntry)
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id);

UPDATE journal_entries je
SET branch_id = (SELECT id FROM branches WHERE code = 'MAIN')
WHERE je.branch_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_journal_branch ON journal_entries(branch_id);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(50) PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('008_branches')
ON CONFLICT (version) DO NOTHING;
