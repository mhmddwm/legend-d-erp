-- =========================================================
-- LEGEND D ERP — Migration 010: تصحيح القيود القديمة غير المرحّلة لجدول الأسطر
-- بسبب التبديل المتكرر اليوم بين نظام القيد البسيط والمركب، بعض القيود
-- القديمة انحفظت بأعمدة debit_account/credit_account/amount مباشرة على
-- journal_entries بدون أسطر مقابلة بجدول journal_entry_lines — فصارت
-- تظهر فارغة (أو ما تظهر) بشاشة القيود التي تعتمد الآن على الأسطر فقط.
-- هذا الملف يكرر نفس منطق الترحيل من migration 006 لالتقاط أي قيود
-- جديدة انحفظت بالشكل القديم منذ ذلك الحين. Idempotent: safe to re-run.
-- =========================================================

INSERT INTO journal_entry_lines (entry_id, line_no, account_code, debit, credit, line_description)
SELECT je.id, 1, je.debit_account, je.amount, 0, je.description
FROM journal_entries je
WHERE je.debit_account IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM journal_entry_lines l WHERE l.entry_id = je.id AND l.line_no = 1);

INSERT INTO journal_entry_lines (entry_id, line_no, account_code, debit, credit, line_description)
SELECT je.id, 2, je.credit_account, 0, je.amount, je.description
FROM journal_entries je
WHERE je.credit_account IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM journal_entry_lines l WHERE l.entry_id = je.id AND l.line_no = 2);

-- تعبئة إجمالي القيد لأي سجل ناقص من مجموع أسطره الفعلية
UPDATE journal_entries je
SET total_amount = sub.total
FROM (
    SELECT entry_id, SUM(debit) AS total
    FROM journal_entry_lines
    GROUP BY entry_id
) sub
WHERE sub.entry_id = je.id
  AND (je.total_amount IS NULL OR je.total_amount <> sub.total);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(50) PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('010_backfill_legacy_journal_lines')
ON CONFLICT (version) DO NOTHING;
