-- =========================================================
-- LEGEND D ERP — Migration 024: تأكيد إمكانية إفراغ أعمدة القيد
-- التراثية (debit_account / credit_account / amount)
-- ---------------------------------------------------------
-- المشكلة: migration 006 كان من المفترض أن يجعل هذه الأعمدة الثلاثة
-- اختيارية (DROP NOT NULL) بعد التحوّل لنموذج الأسطر المتعددة
-- (journal_entry_lines)، لكن على بعض قواعد البيانات لم يُطبَّق هذا
-- الجزء فعلياً (سواء لعدم تشغيل migration 006 بالكامل، أو لتوقفه عند
-- خطأ سابق)، فبقيت amount خصوصاً NOT NULL — ما يجعل أي محاولة لترحيل
-- قيد متعدد الأسطر (فاتورة مشتريات، إذن استلام، أو أي قيد يدوي بعد
-- migration 006) تفشل بخطأ:
--   null value in column "amount" of relation "journal_entries"
--   violates not-null constraint
--
-- الحل هنا معزول ومستقل عن ترتيب/اكتمال migration 006 السابق —
-- تنفيذ DROP NOT NULL صراحة على الأعمدة الثلاثة. آمن تماماً للتنفيذ
-- حتى لو كانت الأعمدة NULL-able بالفعل (لا تأثير/لا خطأ في هذه الحالة).
-- =========================================================

ALTER TABLE journal_entries ALTER COLUMN debit_account  DROP NOT NULL;
ALTER TABLE journal_entries ALTER COLUMN credit_account DROP NOT NULL;
ALTER TABLE journal_entries ALTER COLUMN amount         DROP NOT NULL;

INSERT INTO schema_migrations (version) VALUES ('024_ensure_journal_legacy_columns_nullable')
ON CONFLICT (version) DO NOTHING;
