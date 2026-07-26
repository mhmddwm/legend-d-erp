-- =========================================================
-- LEGEND D ERP — Migration 011: مرفقات القيود المحاسبية
-- الأساس لدعم إرفاق مستندات (فواتير/صور/PDF) على أي قيد، عبر
-- Supabase Storage (يرفع الملف الفرونت إند مباشرة لمخزن Supabase،
-- ويُخزَّن هنا فقط رابط الملف الناتج + بياناته الوصفية).
-- Idempotent: safe to re-run.
-- =========================================================

CREATE TABLE IF NOT EXISTS journal_entry_attachments (
    id              SERIAL PRIMARY KEY,
    entry_id        INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    file_name       VARCHAR(255) NOT NULL,
    file_url        TEXT NOT NULL,
    file_type       VARCHAR(100),
    file_size       INTEGER,
    uploaded_by     VARCHAR(100),
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_journal_attachments_entry ON journal_entry_attachments(entry_id);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(50) PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('011_journal_attachments')
ON CONFLICT (version) DO NOTHING;
