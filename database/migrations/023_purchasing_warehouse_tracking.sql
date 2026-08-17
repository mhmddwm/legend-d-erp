-- =========================================================
-- LEGEND D ERP — Migration 023: تفعيل تتبع المستودعات فعلياً في المشتريات
--
-- الجداول warehouses / warehouse_locations / warehouse_stock معرَّفة
-- أصلاً بنماذج Python (models/warehouse.py, models/location.py,
-- models/warehouse_stock.py) وأشارت لها Migration 002 (ALTER)، لكن لم
-- يُعثر على أمر CREATE TABLE أساسي لها بأي ملف — فتُنشأ هنا دفاعياً
-- (IF NOT EXISTS) لضمان اتساق القاعدة بغض النظر عن حالتها الحالية.
--
-- الإضافة الجوهرية بهذه الهجرة: ربط "إذن الاستلام" (goods_receipts)
-- و"حركة المخزون" (stock_moves) بمستودع فعلي، وتحديث جدول
-- warehouse_stock تلقائياً من كود الشراء (بدل ما يبقى جدولاً فارغاً
-- غير مستخدم)، مع الإبقاء على Item.qty / Item.avg_cost كالمرجع
-- الإجمالي الوحيد لكل الحسابات والتكلفة والقيود المحاسبية —
-- warehouse_stock.quantity هو المصدر الحقيقي لرصيد كل مستودع على حدة،
-- بينما warehouse_stock.avg_cost يعكس نفس التكلفة المتوسطة العامة
-- للصنف (وليس تكلفة مستقلة لكل مستودع) حفاظاً على مصدر تكلفة واحد
-- متسق مع القيود المحاسبية المُرحَّلة فعلياً.
--
-- Idempotent: safe to re-run.
-- =========================================================

-- ---------- 1) الجداول الأساسية (دفاعياً، تحسباً لعدم وجودها) ----------
CREATE TABLE IF NOT EXISTS warehouses (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(30) UNIQUE NOT NULL,
    name        VARCHAR(200) NOT NULL,
    location    VARCHAR(200),
    manager     VARCHAR(100),
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warehouse_locations (
    id          SERIAL PRIMARY KEY,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    code        VARCHAR(60),
    name        VARCHAR(200) NOT NULL,
    zone        VARCHAR(60),
    rack        VARCHAR(60),
    bin         VARCHAR(60),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warehouse_stock (
    id            SERIAL PRIMARY KEY,
    warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    location_id   INTEGER REFERENCES warehouse_locations(id) ON DELETE SET NULL,
    item_id       INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity      NUMERIC(18,4) NOT NULL DEFAULT 0,
    avg_cost      NUMERIC(18,4) NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (warehouse_id, location_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_wstock_item ON warehouse_stock(item_id);
CREATE INDEX IF NOT EXISTS idx_wstock_wh ON warehouse_stock(warehouse_id);

-- ---------- 2) ربط الاستلام وحركة المخزون بمستودع فعلي ----------
ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES warehouses(id);
ALTER TABLE goods_receipts ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES warehouse_locations(id);
ALTER TABLE stock_moves ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES warehouses(id);

CREATE INDEX IF NOT EXISTS idx_grn_warehouse ON goods_receipts(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_moves_warehouse ON stock_moves(warehouse_id);

-- ---------- 3) مستودع افتراضي + موقع افتراضي (للتوافق مع البيانات القديمة) ----------
INSERT INTO warehouses (code, name, is_default, is_active)
SELECT 'MAIN', 'المستودع الرئيسي', TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM warehouses WHERE code = 'MAIN');

-- عمود is_default قد لا يكون موجوداً إن لم تُطبَّق Migration 002 مسبقاً
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE warehouses SET is_default = TRUE WHERE code = 'MAIN'
    AND NOT EXISTS (SELECT 1 FROM warehouses WHERE is_default = TRUE);

INSERT INTO warehouse_locations (warehouse_id, code, name)
SELECT w.id, 'GENERAL', 'موقع عام'
FROM warehouses w
WHERE w.code = 'MAIN'
  AND NOT EXISTS (
      SELECT 1 FROM warehouse_locations l WHERE l.warehouse_id = w.id AND l.code = 'GENERAL'
  );

-- ---------- 4) تعبئة البيانات القديمة على المستودع الافتراضي ----------
UPDATE goods_receipts SET warehouse_id = (SELECT id FROM warehouses WHERE code = 'MAIN')
    WHERE warehouse_id IS NULL;
UPDATE goods_receipts SET location_id = (SELECT id FROM warehouse_locations WHERE code = 'GENERAL' LIMIT 1)
    WHERE location_id IS NULL;
UPDATE stock_moves SET warehouse_id = (SELECT id FROM warehouses WHERE code = 'MAIN')
    WHERE warehouse_id IS NULL;

-- تجميع الرصيد الحالي لكل صنف بالكامل داخل المستودع الافتراضي (تقريب
-- معقول للبيانات التاريخية، بما أن تتبع المستودعات لم يكن مفعّلاً قبل هذه الهجرة)
INSERT INTO warehouse_stock (warehouse_id, location_id, item_id, quantity, avg_cost)
SELECT
    (SELECT id FROM warehouses WHERE code = 'MAIN'),
    (SELECT id FROM warehouse_locations WHERE code = 'GENERAL' LIMIT 1),
    i.id, i.qty, i.avg_cost
FROM items i
WHERE i.qty <> 0
  AND NOT EXISTS (
      SELECT 1 FROM warehouse_stock ws
      WHERE ws.item_id = i.id
        AND ws.warehouse_id = (SELECT id FROM warehouses WHERE code = 'MAIN')
  );

INSERT INTO schema_migrations (version) VALUES ('023_purchasing_warehouse_tracking')
ON CONFLICT (version) DO NOTHING;
