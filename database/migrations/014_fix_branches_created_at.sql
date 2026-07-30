-- =========================================================
-- LEGEND D ERP — Migration 014: إصلاح جدول الفروع الناقص
-- جدول branches كان موجوداً مسبقاً بقاعدة البيانات قبل تشغيل migration 008
-- (بدون عمود created_at)، فتجاهله أمر CREATE TABLE IF NOT EXISTS تماماً
-- ولم يُضِف العمود الناقص. هذا الملف يضيفه مباشرة بأمان.
-- Idempotent: safe to re-run.
-- =========================================================

ALTER TABLE branches ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(50) PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('014_fix_branches_created_at')
ON CONFLICT (version) DO NOTHING;
