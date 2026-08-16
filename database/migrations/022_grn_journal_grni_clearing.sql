-- =========================================================
-- LEGEND D ERP — Migration 022: قيد الاستلام + حساب "بضاعة مستلمة غير مفوترة" (GR/IR)
--
-- الطريقة الأصح محاسبياً: المخزون يُرحَّل بالدفاتر لحظة الاستلام
-- الفعلي (GRN) وليس عند وصول فاتورة المورد، حتى تعكس القوائم المالية
-- البضاعة المستلمة فوراً حتى لو تأخرت فاتورة المورد:
--
--   عند الاستلام (GRN):    مدين المخزون (123) / دائن بضاعة مستلمة غير مفوترة (217)
--   عند وصول الفاتورة:      مدين بضاعة مستلمة غير مفوترة (217) [+ مدين ضريبة المشتريات]
--                            / دائن حساب المورد (211 وفروعه)
--
-- ملاحظة: الفاتورة المباشرة (بدون دورة شراء) تُنشئ إذن استلام تلقائياً
-- في نفس اللحظة، فلا توجد فجوة زمنية حقيقية بين الاستلام والفوترة —
-- لذلك تبقى على القيد المباشر بخطوة واحدة (مدين المخزون مباشرة / دائن
-- المورد) دون المرور بحساب "بضاعة مستلمة غير مفوترة"، تماشياً مع
-- الغرض من ميزة الفاتورة المباشرة أصلاً (إدخال سريع بخطوة واحدة).
--
-- Idempotent: safe to re-run.
-- =========================================================

INSERT INTO accounts (code, name_ar, name_en, account_type, parent_code, opening_balance)
VALUES ('217', 'بضاعة مستلمة غير مفوترة', 'Goods Received Not Invoiced (GR/IR)', 'liabilities', '21', 0)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS journal_entry_id INTEGER REFERENCES journal_entries(id);

CREATE INDEX IF NOT EXISTS idx_goods_receipts_journal ON goods_receipts(journal_entry_id);

INSERT INTO schema_migrations (version) VALUES ('022_grn_journal_grni_clearing')
ON CONFLICT (version) DO NOTHING;
