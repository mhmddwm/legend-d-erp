-- =========================================================
-- LEGEND D ERP — Migration 006: قيود متعددة الأسطر (Multi-line Journal Entries)
-- يحوّل شاشة القيود من نموذج "مدين واحد / دائن واحد" إلى نموذج احترافي
-- بعدد أسطر غير محدود لكل قيد (كما في Odoo/Oracle)، مع ترحيل بيانات القيود
-- القديمة تلقائياً إلى الشكل الجديد بدون فقدان أي بيانات.
-- Idempotent: safe to re-run.
-- =========================================================

-- 1) جدول أسطر القيد
CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id                SERIAL PRIMARY KEY,
    entry_id          INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    line_no           INTEGER NOT NULL DEFAULT 1,
    account_code      VARCHAR(20) NOT NULL REFERENCES accounts(code),
    debit             NUMERIC(18,2) NOT NULL DEFAULT 0,
    credit            NUMERIC(18,2) NOT NULL DEFAULT 0,
    line_description  TEXT,
    CONSTRAINT ck_line_amounts_nonneg CHECK (debit >= 0 AND credit >= 0),
    CONSTRAINT ck_line_single_side CHECK (debit = 0 OR credit = 0)
);

CREATE INDEX IF NOT EXISTS idx_lines_entry   ON journal_entry_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_lines_account ON journal_entry_lines(account_code);

-- 2) رأس القيد: السماح بعدم وجود مدين/دائن/مبلغ مباشر (تصبح هذه الحقول
--    تراثية/اختيارية بعد أن أصبحت التفاصيل في جدول الأسطر)
ALTER TABLE journal_entries ALTER COLUMN debit_account  DROP NOT NULL;
ALTER TABLE journal_entries ALTER COLUMN credit_account DROP NOT NULL;
ALTER TABLE journal_entries ALTER COLUMN amount         DROP NOT NULL;

-- عمود إجمالي القيد (لعرض/فرز/بحث سريع بدون تجميع الأسطر في كل استعلام)
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS total_amount NUMERIC(18,2);

-- 3) ترحيل القيود القديمة (مدين واحد/دائن واحد) إلى جدول الأسطر
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

-- 4) تعبئة إجمالي القيد لكل السجلات (قديمة وجديدة) من مجموع أسطرها
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

INSERT INTO schema_migrations (version) VALUES ('006_journal_multiline')
ON CONFLICT (version) DO NOTHING;
