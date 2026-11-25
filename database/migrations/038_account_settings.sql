-- =========================================================
-- LEGEND D ERP — Migration 038: إعدادات الحسابات (الحسابات الافتراضية)
-- ---------------------------------------------------------
-- كانت أكواد حسابات الترحيل التلقائي (المخزون 123، العملاء 1121، الموردون 211،
-- الإيراد 41، التكلفة 51، GRNI 217، الأرصدة الافتتاحية 34) مكتوبة داخل الكود.
-- هذا الجدول يتيح تغييرها من شاشة «إعدادات الحسابات» دون تعديل الكود.
--
-- المفاتيح:  default.<role>  (inventory, grni, payable, receivable, sales_revenue, cogs, opening_equity)
--            erp_profile     (generic | odoo | sap | oracle)
-- غياب المفتاح = استخدام الكود التقليدي، فلا يتغير سلوك أي نظام قائم.
--
-- Idempotent: safe to re-run.
-- =========================================================

CREATE TABLE IF NOT EXISTS account_settings (
    key        VARCHAR(60)  PRIMARY KEY,
    value      VARCHAR(100),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);
