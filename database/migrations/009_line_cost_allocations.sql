-- =========================================================
-- LEGEND D ERP — Migration 009: توزيع مركز التكلفة على مستوى سطر القيد
-- بدلاً من مركز تكلفة واحد لكامل القيد، أصبح كل سطر يمكن توزيعه على أكثر
-- من مركز تكلفة بنسب مئوية (تجمع 100% لكل سطر يُوزَّع).
-- Idempotent: safe to re-run.
-- =========================================================

CREATE TABLE IF NOT EXISTS line_cost_allocations (
    id                SERIAL PRIMARY KEY,
    line_id           INTEGER NOT NULL REFERENCES journal_entry_lines(id) ON DELETE CASCADE,
    cost_center_code  VARCHAR(20) NOT NULL REFERENCES cost_centers(code),
    percentage        NUMERIC(5,2) NOT NULL,
    CONSTRAINT ck_lca_percentage CHECK (percentage > 0 AND percentage <= 100)
);

CREATE INDEX IF NOT EXISTS idx_lca_line ON line_cost_allocations(line_id);

-- ترحيل أي مراكز تكلفة كانت مسجّلة على مستوى القيد بالكامل (النظام القديم)
-- إلى توزيع 100% على كل أسطر ذلك القيد، حتى لا تُفقد البيانات القديمة.
INSERT INTO line_cost_allocations (line_id, cost_center_code, percentage)
SELECT jel.id, je.cost_center_code, 100
FROM journal_entries je
JOIN journal_entry_lines jel ON jel.entry_id = je.id
WHERE je.cost_center_code IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM line_cost_allocations lca WHERE lca.line_id = jel.id);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(50) PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('009_line_cost_allocations')
ON CONFLICT (version) DO NOTHING;
