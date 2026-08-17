-- =========================================================
-- LEGEND D ERP — Migration 029: قوائم الأسعار (المرحلة 3)
--
-- قائمة أسعار مسمّاة (مثال: "أسعار الجملة"، "أسعار التجزئة") تحمل
-- سعراً مخصَّصاً لكل صنف يتجاوز السعر الافتراضي بجدول الأصناف.
--
-- ملاحظة: هذه الهجرة تضيف الجداول فقط. ربط شاشة المنتجات/المبيعات
-- والفرونت إند بها مؤجَّل لجلسة لاحقة بميزانية كاملة (نفس نهج
-- Migration 028 لقوالب الوحدات — إيقاف عمدي عند حد آمن).
--
-- Idempotent: safe to re-run.
-- =========================================================

CREATE TABLE IF NOT EXISTS price_lists (
    code         VARCHAR(30) PRIMARY KEY,
    name         VARCHAR(200) NOT NULL,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_list_items (
    id              SERIAL PRIMARY KEY,
    price_list_code VARCHAR(30) NOT NULL REFERENCES price_lists(code) ON DELETE CASCADE,
    item_id         INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    price           NUMERIC(18,4) NOT NULL DEFAULT 0,
    UNIQUE (price_list_code, item_id)
);

CREATE INDEX IF NOT EXISTS idx_price_list_items_list ON price_list_items(price_list_code);
CREATE INDEX IF NOT EXISTS idx_price_list_items_item ON price_list_items(item_id);

INSERT INTO schema_migrations (version) VALUES ('029_price_lists')
ON CONFLICT (version) DO NOTHING;
