-- =========================================================
-- LEGEND D ERP — Migration 022: ترحيل قيد المخزون عند الاستلام (GRN)
-- + حساب "بضاعة مستلمة غير مفوترة" (GRNI) الوسيط
-- ---------------------------------------------------------
-- يعيد ترتيب توقيت ترحيل قيد المخزون بحيث يحصل عند تأكيد استلام
-- البضاعة (GRN) بدلاً من انتظار وصول فاتورة المورد، أسوة بأودو/ساب:
--   • عند الاستلام:  مدين المخزون (123) / دائن "بضاعة مستلمة غير
--     مفوترة" (217) — كحساب وسيط مؤقت يمثل التزاماً غير مفوتر بعد.
--   • عند الفاتورة:  مدين "بضاعة مستلمة غير مفوترة" (217) لتصفيته
--     [+ مدين ضريبة المشتريات إن وُجدت] / دائن حساب المورد (211 أو
--     فرعه)، دون أي مساس بحساب المخزون مرة ثانية.
--
-- Idempotent: safe to re-run.
-- =========================================================

-- تأكيد وجود سلسلة الخصوم المتداولة (2 -> 21) قبل إضافة الحساب الوسيط،
-- بنفس احتياط migration 018 لقواعد البيانات التي لم يُطبَّق عليها بذر
-- الحسابات الافتراضي من schema.sql.
INSERT INTO accounts (code, name_ar, name_en, account_type, nature, parent_code, opening_balance) VALUES
('2',  'الخصوم',              'Liabilities',         'liabilities', 'دائن', NULL, 0),
('21', 'الخصوم المتداولة',     'Current Liabilities', 'liabilities', 'دائن', '2',  0)
ON CONFLICT (code) DO NOTHING;

-- الحساب الوسيط: بضاعة مستلمة غير مفوترة (Goods Received Not Invoiced)
-- حساب نظامي — الكود 217 مستخدم صراحة بمنطق الترحيل الآلي بالكود، لذا
-- يُعلَّم is_system حتى لا يُحذف بالخطأ من شاشة دليل الحسابات (نفس
-- منطق حساب المخزون 123 وحساب الموردين 211).
INSERT INTO accounts (code, name_ar, name_en, account_type, nature, parent_code, opening_balance, is_system) VALUES
('217', 'بضاعة مستلمة غير مفوترة', 'Goods Received Not Invoiced (GRNI)', 'liabilities', 'دائن', '21', 0, TRUE)
ON CONFLICT (code) DO NOTHING;

UPDATE accounts SET is_system = TRUE WHERE code = '217';

-- القيد المحاسبي المُرحَّل تلقائياً عند إنشاء إذن الاستلام (أول قيد
-- محاسبي بدورة الشراء الآن)، أسوة بـ purchase_invoices.journal_entry_id
-- المُضاف بـ migration 021.
ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS journal_entry_id INTEGER REFERENCES journal_entries(id);

CREATE INDEX IF NOT EXISTS idx_goods_receipts_journal ON goods_receipts(journal_entry_id);

INSERT INTO schema_migrations (version) VALUES ('022_grn_journal_grni_account')
ON CONFLICT (version) DO NOTHING;
