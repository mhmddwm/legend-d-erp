-- =========================================================
-- LEGEND D ERP — Migration 005: حقول بحث القيود اليومية
-- إضافة "منشئ القيد" و"تاريخ الإنشاء" لدعم شاشة البحث المتقدم.
-- Idempotent: safe to re-run.
-- =========================================================

ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS created_by_name VARCHAR(100);
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_journal_entry_date ON journal_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_journal_created_at ON journal_entries(created_at);
CREATE INDEX IF NOT EXISTS idx_journal_amount ON journal_entries(amount);
