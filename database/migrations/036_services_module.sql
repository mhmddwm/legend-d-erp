-- =========================================================
-- LEGEND D ERP — Migration 036: وحدة الخدمات (Service Master + فواتير الخدمات)
-- ---------------------------------------------------------
--  services               : بطاقة الخدمة (بيع/شراء/كلاهما) مع ربط حساب الإيراد/المصروف والضريبة
--  service_invoices       : فاتورة خدمات (direction = sales | purchase) تُرحَّل بقيد مزدوج
--  service_invoice_lines  : أسطر الفاتورة (الحساب مجمَّد بالسطر لحظة الترحيل)
--
-- Idempotent: safe to re-run.
-- =========================================================

CREATE TABLE IF NOT EXISTS services (
    code                  VARCHAR(30) PRIMARY KEY,
    name                  VARCHAR(200) NOT NULL,
    name_en               VARCHAR(200),
    description           TEXT,
    category              VARCHAR(100),
    service_type          VARCHAR(10) NOT NULL DEFAULT 'sales',
    unit                  VARCHAR(30) NOT NULL DEFAULT 'خدمة',
    sales_price           NUMERIC(18,4) NOT NULL DEFAULT 0,
    purchase_cost         NUMERIC(18,4) NOT NULL DEFAULT 0,
    tax_type_code         VARCHAR(20) REFERENCES tax_types(code),
    revenue_account_code  VARCHAR(20) REFERENCES accounts(code),
    expense_account_code  VARCHAR(20) REFERENCES accounts(code),
    cost_center_code      VARCHAR(20) REFERENCES cost_centers(code),
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ DEFAULT now(),
    updated_at            TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT ck_service_type    CHECK (service_type IN ('sales','purchase','both')),
    CONSTRAINT ck_service_amounts CHECK (sales_price >= 0 AND purchase_cost >= 0)
);
CREATE INDEX IF NOT EXISTS idx_services_active ON services(is_active);
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);

CREATE TABLE IF NOT EXISTS service_invoices (
    inv_number               VARCHAR(30) PRIMARY KEY,
    direction                VARCHAR(10) NOT NULL,
    inv_date                 DATE NOT NULL,
    party_code               VARCHAR(30) NOT NULL,
    party_inv_number         VARCHAR(60),
    payment_method           VARCHAR(10) NOT NULL DEFAULT 'credit',
    settlement_account_code  VARCHAR(20) REFERENCES accounts(code),
    tax_calc_method          VARCHAR(10) NOT NULL DEFAULT 'exclusive',
    discount_total           NUMERIC(18,2) NOT NULL DEFAULT 0,
    subtotal                 NUMERIC(18,2) NOT NULL DEFAULT 0,
    tax_amount               NUMERIC(18,2) NOT NULL DEFAULT 0,
    total                    NUMERIC(18,2) NOT NULL DEFAULT 0,
    status                   VARCHAR(10) NOT NULL DEFAULT 'posted',
    journal_entry_id         INTEGER REFERENCES journal_entries(id),
    cost_center_code         VARCHAR(20) REFERENCES cost_centers(code),
    notes                    TEXT,
    created_by               VARCHAR(100),
    cancelled_at             TIMESTAMPTZ,
    cancel_reason            TEXT,
    created_at               TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT ck_svc_inv_direction CHECK (direction IN ('sales','purchase')),
    CONSTRAINT ck_svc_inv_status    CHECK (status IN ('posted','cancelled')),
    CONSTRAINT ck_svc_inv_payment   CHECK (payment_method IN ('credit','cash','bank')),
    CONSTRAINT ck_svc_inv_taxcalc   CHECK (tax_calc_method IN ('exclusive','inclusive')),
    CONSTRAINT ck_svc_inv_total     CHECK (total >= 0 AND subtotal >= 0 AND tax_amount >= 0)
);
CREATE INDEX IF NOT EXISTS idx_svc_inv_dir_date ON service_invoices(direction, inv_date);
CREATE INDEX IF NOT EXISTS idx_svc_inv_party    ON service_invoices(party_code);
CREATE INDEX IF NOT EXISTS idx_svc_inv_journal  ON service_invoices(journal_entry_id);
-- رقم فاتورة المورد لا يتكرر لنفس المورد (الفواتير الملغاة مستثناة)
CREATE UNIQUE INDEX IF NOT EXISTS uq_svc_inv_party_ref
    ON service_invoices(party_code, party_inv_number)
    WHERE direction = 'purchase' AND status <> 'cancelled' AND party_inv_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS service_invoice_lines (
    id                SERIAL PRIMARY KEY,
    inv_number        VARCHAR(30) NOT NULL REFERENCES service_invoices(inv_number) ON DELETE CASCADE,
    line_no           INTEGER NOT NULL,
    service_code      VARCHAR(30) NOT NULL REFERENCES services(code),
    description       VARCHAR(300),
    qty               NUMERIC(18,4) NOT NULL,
    unit_price        NUMERIC(18,4) NOT NULL,
    discount_percent  NUMERIC(5,2) NOT NULL DEFAULT 0,
    discount_amount   NUMERIC(18,2) NOT NULL DEFAULT 0,
    net_amount        NUMERIC(18,2) NOT NULL,
    tax_type_code     VARCHAR(20) REFERENCES tax_types(code),
    tax_rate          NUMERIC(5,2),
    tax_amount        NUMERIC(18,2) NOT NULL DEFAULT 0,
    line_total        NUMERIC(18,2) NOT NULL,
    account_code      VARCHAR(20) NOT NULL REFERENCES accounts(code),
    CONSTRAINT ck_svc_line_qty CHECK (qty > 0 AND unit_price >= 0 AND discount_percent >= 0 AND discount_percent <= 100)
);
CREATE INDEX IF NOT EXISTS idx_svc_lines_inv     ON service_invoice_lines(inv_number);
CREATE INDEX IF NOT EXISTS idx_svc_lines_service ON service_invoice_lines(service_code);

INSERT INTO schema_migrations (version) VALUES ('036_services_module')
ON CONFLICT (version) DO NOTHING;
