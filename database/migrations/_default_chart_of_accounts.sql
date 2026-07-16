-- =========================================================
-- LEGEND D ERP — Migration 003: دليل الحسابات القياسي (Default COA)
-- الحسابات الرئيسية والفرعية الأساسية لنشاط تجاري/تجزئة عام،
-- مع مراعاة أكواد موجودة مسبقاً بالنظام (123 = المخزون، 211 = الموردون،
-- 124 و 52 المضافة بمديول المستودعات).
--
-- آمن للتشغيل أكثر من مرة: كل حساب يُضاف فقط إذا لم يكن كوده موجوداً
-- مسبقاً (ON CONFLICT DO NOTHING) — لا يمس أي تعديل سواه المستخدم على
-- الحسابات الموجودة، ولا يغيّر آلية استخدامها الحالية بالنظام.
-- =========================================================

INSERT INTO accounts (code, name_ar, name_en, account_type, parent_code, opening_balance) VALUES

-- ========== 1) الأصول ==========
('1',    'الأصول',                          'Assets',                    'assets', NULL, 0),
('11',   'الأصول المتداولة',                 'Current Assets',            'assets', '1',  0),
('111',  'النقدية وما في حكمها',             'Cash & Cash Equivalents',   'assets', '11', 0),
('1111', 'الصندوق',                          'Cash on Hand',              'assets', '111',0),
('1112', 'البنك',                            'Bank',                      'assets', '111',0),
('112',  'الذمم المدينة',                    'Accounts Receivable',       'assets', '11', 0),
('1121', 'عملاء',                            'Customers',                 'assets', '112',0),
('1122', 'أوراق قبض',                        'Notes Receivable',          'assets', '112',0),
('1123', 'دفعات مقدمة لموردين',              'Advances to Suppliers',     'assets', '112',0),
-- '123' = المخزون (موجود مسبقاً، تُستخدم بالترحيل الآلي من المشتريات/المستودعات)
-- '124' = مخزون بضاعة في الطريق (تحويل) (أُضيف بمديول المستودعات)
('125',  'ضريبة القيمة المضافة القابلة للخصم','VAT Recoverable',          'assets', '11', 0),
('12',   'الأصول الثابتة',                   'Fixed Assets',              'assets', '1',  0),
('121',  'أراضي ومباني',                     'Land & Buildings',          'assets', '12', 0),
('122',  'أثاث ومعدات مكتبية',                'Furniture & Office Equip.', 'assets', '12', 0),
('1221', 'مجمع إهلاك الأثاث والمعدات',        'Accum. Depreciation — Furn.','assets','122', 0),
('126',  'سيارات ووسائل نقل',                'Vehicles',                  'assets', '12', 0),

-- ========== 2) الخصوم ==========
('2',    'الخصوم',                          'Liabilities',                'liabilities', NULL, 0),
('21',   'الخصوم المتداولة',                 'Current Liabilities',        'liabilities', '2',  0),
-- '211' = الموردون (موجود مسبقاً، يُستخدم بالترحيل الآلي من المشتريات)
('212',  'أوراق دفع',                        'Notes Payable',              'liabilities', '21', 0),
('213',  'مصروفات مستحقة',                   'Accrued Expenses',           'liabilities', '21', 0),
('214',  'ضريبة القيمة المضافة المستحقة',    'VAT Payable',                'liabilities', '21', 0),
('215',  'دفعات مقدمة من عملاء',             'Customer Advances',          'liabilities', '21', 0),
('216',  'رواتب مستحقة الدفع',               'Accrued Salaries',           'liabilities', '21', 0),
('22',   'الخصوم طويلة الأجل',               'Long-term Liabilities',      'liabilities', '2',  0),
('221',  'قروض طويلة الأجل',                 'Long-term Loans',            'liabilities', '22', 0),

-- ========== 3) حقوق الملكية ==========
('3',    'حقوق الملكية',                     'Equity',                     'equity', NULL, 0),
('31',   'رأس المال',                        'Capital',                    'equity', '3',  0),
('32',   'الأرباح (الخسائر) المرحلة',        'Retained Earnings',          'equity', '3',  0),
('33',   'مسحوبات الشريك/المالك',            'Owner Drawings',             'equity', '3',  0),

-- ========== 4) الإيرادات ==========
('4',    'الإيرادات',                        'Revenue',                    'revenue', NULL, 0),
('41',   'إيرادات المبيعات',                 'Sales Revenue',              'revenue', '4',  0),
('42',   'مردودات ومسموحات المبيعات',        'Sales Returns & Allowances', 'revenue', '4',  0),
('43',   'إيرادات أخرى',                     'Other Revenue',              'revenue', '4',  0),

-- ========== 5) المصروفات ==========
('5',    'المصروفات',                        'Expenses',                   'expenses', NULL, 0),
('51',   'تكلفة البضاعة المباعة',            'Cost of Goods Sold',         'expenses', '5',  0),
-- '52' = فروقات جرد ومخزون تالف/متقادم (أُضيف بمديول المستودعات)
('53',   'مصروفات تشغيلية',                  'Operating Expenses',         'expenses', '5',  0),
('531',  'رواتب وأجور',                      'Salaries & Wages',           'expenses', '53', 0),
('532',  'إيجارات',                          'Rent',                       'expenses', '53', 0),
('533',  'كهرباء وماء',                      'Utilities',                  'expenses', '53', 0),
('534',  'نقل وشحن',                         'Transportation & Freight',   'expenses', '53', 0),
('535',  'صيانة',                            'Maintenance',                'expenses', '53', 0),
('536',  'اتصالات وإنترنت',                  'Telecom & Internet',         'expenses', '53', 0),
('54',   'مصروفات إدارية وعمومية',           'General & Admin Expenses',   'expenses', '5',  0),
('541',  'أتعاب مهنية',                      'Professional Fees',          'expenses', '54', 0),
('542',  'رسوم حكومية وتراخيص',              'Government Fees & Licenses', 'expenses', '54', 0),
('55',   'مصروفات تسويقية وإعلانية',         'Marketing & Advertising',    'expenses', '5',  0),
('56',   'مصروفات تمويلية',                  'Finance Costs',              'expenses', '5',  0),
('561',  'فوائد وعمولات بنكية',              'Bank Interest & Fees',       'expenses', '56', 0)

ON CONFLICT (code) DO NOTHING;
