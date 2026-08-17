-- =========================================================
-- LEGEND D ERP — Migration 027: تصنيفات وماركات حقيقية + إثراء بيانات الصنف
--
-- الشاشات "التصنيفات"/"الماركات" وحقول نموذج "إضافة منتج" (اسم إنجليزي،
-- وصف، تصنيف، ماركة، مورد، كود عند المورد...) كانت موجودة بالواجهة
-- فقط دون أي جدول حقيقي بقاعدة البيانات — أي حفظ لهذه الحقول كان
-- يُفقَد بصمت أو يبقى محلياً بالمتصفح فقط. هذه الهجرة تُنشئ الجداول
-- الحقيقية وتربط الصنف بها فعلياً، وتضيف حقلي "المستودع الافتراضي"
-- و"الموقع الفرعي" (رف/منطقة) لتخزين الصنف.
--
-- Idempotent: safe to re-run.
-- =========================================================

CREATE TABLE IF NOT EXISTS categories (
    code         VARCHAR(30) PRIMARY KEY,
    name_ar      VARCHAR(200) NOT NULL,
    name_en      VARCHAR(200),
    parent_code  VARCHAR(30) REFERENCES categories(code),
    description  TEXT,
    image_url    VARCHAR(300),
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS brands (
    code         VARCHAR(30) PRIMARY KEY,
    name_ar      VARCHAR(200) NOT NULL,
    name_en      VARCHAR(200),
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE items ADD COLUMN IF NOT EXISTS name_en VARCHAR(200);
ALTER TABLE items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS barcode VARCHAR(80);
ALTER TABLE items ADD COLUMN IF NOT EXISTS category_code VARCHAR(30) REFERENCES categories(code);
ALTER TABLE items ADD COLUMN IF NOT EXISTS brand_code VARCHAR(30) REFERENCES brands(code);
ALTER TABLE items ADD COLUMN IF NOT EXISTS supplier_code VARCHAR(30) REFERENCES suppliers(code);
ALTER TABLE items ADD COLUMN IF NOT EXISTS supplier_item_code VARCHAR(80);
ALTER TABLE items ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

-- أين يُخزَّن الصنف افتراضياً: مستودع + موقع فرعي (رف/منطقة) داخله
ALTER TABLE items ADD COLUMN IF NOT EXISTS default_warehouse_id INTEGER REFERENCES warehouses(id);
ALTER TABLE items ADD COLUMN IF NOT EXISTS default_location_id INTEGER REFERENCES warehouse_locations(id);

CREATE INDEX IF NOT EXISTS idx_items_category ON items(category_code);
CREATE INDEX IF NOT EXISTS idx_items_brand ON items(brand_code);
CREATE INDEX IF NOT EXISTS idx_items_barcode ON items(barcode);

INSERT INTO schema_migrations (version) VALUES ('027_categories_brands_item_enrichment')
ON CONFLICT (version) DO NOTHING;
