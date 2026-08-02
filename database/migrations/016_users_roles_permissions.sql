-- =========================================================
-- LEGEND D ERP — Migration 016: المستخدمون والأدوار والصلاحيات
-- يوسّع جدول roles (المُنشأ بمهاجرة 002) بمصفوفة صلاحيات JSON،
-- ويربط users بـ roles عبر role_id، ويهيّئ أدواراً افتراضية جاهزة
-- (مدير نظام بصلاحيات كاملة، مطّلع بعرض فقط، وباقي الأدوار الوظيفية
-- الموجودة أصلاً بصلاحيات مبدئية معقولة يمكن تعديلها لاحقاً من الواجهة).
-- Idempotent: safe to re-run.
-- =========================================================

-- ---------- 1) توسعة جدول roles ----------
ALTER TABLE roles ADD COLUMN IF NOT EXISTS description VARCHAR(255);
ALTER TABLE roles ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- دور "مدير النظام": صلاحيات كاملة على كل الوحدات + محمي من الحذف/الإيقاف
UPDATE roles SET
    is_system = TRUE,
    description = COALESCE(description, 'وصول كامل لكل وحدات النظام — دور محمي لا يمكن حذفه'),
    permissions = (
        SELECT jsonb_object_agg(m, to_jsonb(ARRAY['view','create','edit','delete','export','approve']))
        FROM unnest(ARRAY['dashboard','accounts','purchasing','sales','pos','customers',
                           'finance','assets','inventory','reports','print_templates',
                           'general_settings','users_permissions']) AS m
    )
WHERE code = 'admin' AND permissions = '{}'::jsonb;

-- دور "مطّلع": عرض فقط على كل الوحدات
UPDATE roles SET
    description = COALESCE(description, 'عرض فقط بدون أي تعديل — مناسب للتدقيق والمتابعة'),
    permissions = (
        SELECT jsonb_object_agg(m, to_jsonb(ARRAY['view']))
        FROM unnest(ARRAY['dashboard','accounts','purchasing','sales','pos','customers',
                           'finance','assets','inventory','reports','print_templates',
                           'general_settings']) AS m
    )
WHERE code = 'viewer' AND permissions = '{}'::jsonb;

-- دور "محاسب"
UPDATE roles SET
    description = COALESCE(description, 'إدارة الحسابات والقيود والتقارير المالية'),
    permissions = '{
        "dashboard": ["view"],
        "accounts": ["view","create","edit","delete","export","approve"],
        "finance": ["view","create","edit","export","approve"],
        "reports": ["view","export"],
        "customers": ["view"],
        "purchasing": ["view"]
    }'::jsonb
WHERE code = 'accountant' AND permissions = '{}'::jsonb;

-- دور "مسؤول المشتريات"
UPDATE roles SET
    description = COALESCE(description, 'إدارة دورة المشتريات من الطلب حتى الفاتورة'),
    permissions = '{
        "dashboard": ["view"],
        "purchasing": ["view","create","edit","delete","export","approve"],
        "inventory": ["view"],
        "reports": ["view","export"]
    }'::jsonb
WHERE code = 'purchasing_officer' AND permissions = '{}'::jsonb;

-- دور "مدير المستودع"
UPDATE roles SET
    description = COALESCE(description, 'إدارة المستودعات والمخزون والتحويلات'),
    permissions = '{
        "dashboard": ["view"],
        "inventory": ["view","create","edit","delete","export","approve"],
        "purchasing": ["view"],
        "reports": ["view","export"]
    }'::jsonb
WHERE code = 'warehouse_manager' AND permissions = '{}'::jsonb;

-- دور "أمين المستودع"
UPDATE roles SET
    description = COALESCE(description, 'استلام وصرف واعتماد حركات المخزون بالمستودع'),
    permissions = '{
        "dashboard": ["view"],
        "inventory": ["view","create","edit","approve"]
    }'::jsonb
WHERE code = 'warehouse_keeper' AND permissions = '{}'::jsonb;

-- دور "كاشير"
UPDATE roles SET
    description = COALESCE(description, 'إتمام عمليات البيع بنقاط البيع فقط'),
    permissions = '{
        "dashboard": ["view"],
        "pos": ["view","create"],
        "customers": ["view","create"]
    }'::jsonb
WHERE code = 'cashier' AND permissions = '{}'::jsonb;

-- ---------- 2) ربط المستخدمين بالأدوار ----------
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES roles(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- تهجير القيمة النصية القديمة role ('admin' -> admin، غير ذلك -> viewer)
UPDATE users u
SET role_id = (
    SELECT id FROM roles
    WHERE code = CASE WHEN u.role = 'admin' THEN 'admin' ELSE 'viewer' END
)
WHERE u.role_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);

-- ---------- 3) تتبع المهاجرة ----------
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(50) PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('016_users_roles_permissions')
ON CONFLICT (version) DO NOTHING;
