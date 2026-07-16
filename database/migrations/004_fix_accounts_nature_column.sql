-- =========================================================
-- Migration 004: إصلاح عمود nature الناقص من جدول accounts
-- ---------------------------------------------------------
-- المشكلة: نموذج SQLAlchemy (Account.nature) والراوتر accounting.py
-- يفترضان وجود عمود "nature" (مدين/دائن) في جدول accounts، لكن هذا
-- العمود لم يُنشأ أبداً لا في schema.sql ولا في أي migration سابق.
-- هذا يجعل GET /api/accounts يفشل بخطأ SQL (500) دائماً، ولذلك
-- يظهر دليل الحسابات فارغاً في الواجهة رغم وجود بياناته بالفعلي.
--
-- آمن للتشغيل أكثر من مرة (IF NOT EXISTS).
-- =========================================================

-- 1) إضافة العمود بقيمة افتراضية مؤقتة
ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS nature VARCHAR(10) NOT NULL DEFAULT 'مدين'
    CHECK (nature IN ('مدين','دائن'));

-- 2) تصحيح القيمة لكل حساب موجود مسبقاً حسب طبيعته المحاسبية الصحيحة
--    (نفس المنطق المستخدم في backend/app/services.py):
--    الأصول والمصروفات => مدين | الخصوم وحقوق الملكية والإيرادات => دائن
UPDATE accounts
SET nature = CASE
    WHEN account_type IN ('assets', 'expenses') THEN 'مدين'
    ELSE 'دائن'
END;

-- 3) (اختياري لكن مهم للاحترافية) جدول تتبع تنفيذ الـ migrations
--    حتى لا يعتمد تطبيقها على الذاكرة/الترتيب اليدوي مستقبلاً
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(50) PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('004_fix_accounts_nature_column')
ON CONFLICT (version) DO NOTHING;
