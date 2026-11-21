# CHANGELOG

## PF-01.7.1 — قالب وحدات بوحدة واحدة (حبة / كرتون) بلا معامل تحويل
### Fixed
- كان إدخال وحدة في «الوحدة الأعلى» بلا معامل يُرفض دائماً. الآن: قالب بوحدة واحدة (الوحدة الأساسية فقط، أو الاسم فقط، أو الأعلى = الأساسية) يُحفظ بلا وحدة أعلى ومعامل 1.
- قالب بوحدتين يبقى يتطلب معامل تحويل أكبر من 1، برسالة تشرح الفرق.
- الخادم يفرض نفس القاعدة عند الإضافة والتعديل (مسح الوحدة الأعلى يعيد المعامل إلى 1).
- نص إرشادي في نموذج القالب، وحقول الوحدة الأعلى اختيارية.

## PF-01.7.0 — إذن إضافة تلقائي للرصيد الافتتاحي
### Added
- `database/migrations/035_opening_stock_receipts.sql`: المورد اختياري في `goods_receipts`، وحساب نظامي `34` «أرصدة افتتاحية — مخزون». **طبّقها قبل نشر الكود.**
- `backend/app/opening_stock.py`: عند إضافة صنف برصيد افتتاحي يُنشأ إذن إضافة تلقائياً (إذن استلام بلا مورد، حالته `opening`) وحركة مخزون «افتتاحي» مرتبطة به، وقيد: مدين المخزون 123 / دائن 34 (إذا كانت التكلفة أكبر من صفر).
- `GET /api/items/{code}/delete-preview`: معاينة الحذف (هل يُحذف؟ وما الذي سيُحذف معه؟ وأي مستندات تمنعه بالاسم).
- فحص جديد في `check_integrity.py`: «أذون الرصيد الافتتاحي».
### Changed
- حذف الصنف: يُسمح فقط لما رصيده الافتتاحي وحده، بعد تأكيد المستخدم، ويُحذف معه إذن الإضافة وقيده وحركته وإدراجه في قوائم الأسعار. أي صنف عليه شراء/بيع/مرتجع/عرض سعر/حركة مخزون أخرى لا يُحذف أبداً، وتذكر الرسالة المستندات التي تمنعه.
- إذن الرصيد الافتتاحي لا يُعدَّل ولا يُفوتر، ولا يظهر ضمن الأذون القابلة للفوترة.
### Notes
- فاتورة الشراء المباشرة كانت تُنشئ إذن استلام تلقائياً من قبل؛ لم يتغير ذلك.
- الأرصدة الافتتاحية الأقدم من هذه النسخة تبقى بلا إذن وبلا قيد؛ يعرضها فحص السلامة.

## PF-01.6.3 — حذف الأصناف ذات الرصيد الافتتاحي + شاشة قوالب الوحدات
### Changed
- `DELETE /api/items/{code}`: يُسمح بحذف صنف حركته الوحيدة «افتتاحي» (تُحذف الحركة وصف مخزون المستودع معه)، ويُمنع إن وُجدت أي حركة أخرى أو تغيّر الرصيد أو كان الصنف مستخدماً في مستندات.
- شاشة قوالب الوحدات: قائمة وحدات جاهزة (حبة، كرتون، علبة...) تتسع بالوحدات المستخدمة فعلاً، ورسائل واضحة عند نقص البيانات، ورسالة نجاح عند الحفظ، وتفريغ النموذج بعد الحفظ.

## PF-01.6.2 — ربط الأصناف بقوالب الوحدات ومنع تكرار المشكلة
### Added
- `scripts/link_item_templates.py`: `report` / `export` / `apply` لربط الأصناف المحفوظة بقوالبها دفعة واحدة عبر ملف CSV (تجربة افتراضياً، و`--commit` للتنفيذ في معاملة واحدة).
- فحص جديد في `scripts/check_integrity.py`: «ارتباط الأصناف بالقوالب» (قالب غير موجود، أو وحدة لا تطابق، أو صنف بلا قالب وأكثر من قالب يناسبه).
- `tests/test_item_templates.py`.
### Changed (الخادم — `backend/app/routers/inventory.py`)
- إضافة/تعديل صنف: القالب المُرسَل يجب أن يكون موجوداً وأن تطابق وحدته الأساسية وحدة الصنف.
- صنف بلا قالب: يُربط تلقائياً إن وُجد قالب واحد يناسب وحدته، ويُرفض الحفظ إن وُجد أكثر من قالب (رسالة تذكر القوالب)، ويبقى بلا قالب إن لم يوجد قالب أصلاً.
- تعديل صنف لا يمس `unit` أو `unit_template` (سعر، حالة...) لا يخضع لهذا الفحص.
- قوالب الوحدات: اسم فريد، وإعادة تسمية القالب تُحدّث الأصناف المرتبطة به تلقائياً، ومنع تغيير الوحدة الأساسية أو حذف قالب مرتبط بأصناف (409).

## PF-01.6.1 — Fix: المنتجات وقوالب الوحدات
### Fixed
- حسم تعارضات الدمج في `scripts/migrate.py` و`README.md` و`CHANGELOG.md` (كان `migrate.py` لا يعمل بسبب علامات التعارض).
- `backend/app/schema_check.py`: عند تشغيل الخادم يقارن أعمدة الموديلات بقاعدة البيانات ويكتب تحذيراً واضحاً بالجداول/الأعمدة الناقصة (مثل `items.unit_template` أو جدول `unit_templates`) مع أمر الهجرة المطلوب.
- الواجهة: عند فشل تحميل الأصناف أو قوالب الوحدات يظهر شريط تنبيه مرئي بدل قائمة فارغة صامتة.
- `tests/test_schema_check.py`.
### Notes
- السبب الأرجح لاختفاء المنتجات: الهجرات 027 و028 و034 غير مطبَّقة على القاعدة المنشورة، فيفشل `GET /api/items` بخطأ 500. الحل: `python ../scripts/migrate.py status` ثم `apply`.

## PF-01.4 — Migrations
### Added
- `scripts/migrate.py`: مُشغِّل هجرات (`check` / `status` / `apply [--dry-run]` / `baseline`) مع تتبع ببصمة checksum وقفل ضد التشغيل المتزامن وتوقف عند أول فشل.
- فحص للملفات: تسمية موحّدة، منع أرقام مكررة جديدة، ورفض الأوامر المدمّرة بلا علامة صريحة.
- اختبارات `tests/test_migrate.py` على Postgres مؤقت (تعتمد `pgserver`).
- `docs/MIGRATIONS.md` وCI جديد `backend-checks.yml` يشغّل الفحص والاختبارات.
### Notes
- الأرقام المكررة القديمة 022/023/024 لم تُعاد تسميتها (أسماؤها مسجَّلة في القاعدة).
- فجوة معروفة: لا يمكن التركيب من الصفر لغياب لقطة بنية القاعدة الأساسية (انظر MIGRATIONS.md).

## PF-01.3 — Security Hardening
### Added
- تسجيل دخول حقيقي بـ JWT: `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password` + شاشة `login.html` و`auth.js` (إضافة الرمز تلقائياً لكل طلب، وتحويل لصفحة الدخول عند انتهاء الجلسة، وزر تسجيل الخروج في الهيدر).
- فرض صلاحيات مركزي على كل الراوترات (`enforce_route_permission`): وحدة + إجراء من المسار ونوع الطلب. القراءة من البيانات المرجعية (أصناف، عملاء، حسابات...) تتطلب تسجيل دخول فقط؛ الكتابة تتطلب صلاحية الوحدة. أي مسار غير مصنَّف مغلق لغير المدير.
- `POST /api/system/reset-transactions` لمدير النظام فقط.
- حد محاولات الدخول الفاشلة (5 محاولات ← قفل 5 دقائق).
- إنشاء المدير الأول تلقائياً من `ADMIN_EMAIL/ADMIN_PASSWORD` + `scripts/create_admin.py`.
- اختبارات `tests/test_auth.py` (15 اختباراً).
- `.gitignore` و`backend/.env.example`.
### Changed
- أُزيلت ترويسة `X-User-Id` غير الآمنة.
- CORS: لم يعد `*`؛ يُسمح بـ localhost/127.0.0.1 للتطوير + ما يُضبط في `CORS_ORIGINS`.
- رسائل الأخطاء الداخلية لا تكشف التفاصيل إلا مع `DEBUG=1`.
### Removed
- `backend/.env` و`__pycache__` من المشروع (كانت متتبَّعة في git).
### ⚠ مطلوب منك
- غيّر كلمة مرور قاعدة البيانات في Supabase (كانت ضمن تاريخ git)، وأنشئ `.env` جديداً، واضبط `JWT_SECRET`.

## PF-01.1 — Platform Foundation

### Added
- Added `docs/`, `vision/`, `deployment/`, `scripts/`, `tests/`, and `config/` folders.
- Added `LEGENDD.manifest.json` as the platform identity file.
- Added Engineering Constitution and Architecture Blueprint.
- Added first AI Roadmap and Platform Vision documents.
- Added backend core-engine skeleton folders and starter Python interfaces.
- Added deployment templates for Netlify, Cloudflare Pages, Docker, and GitHub Actions.
- Added basic run scripts for local development.

### Notes
- Existing `frontend/`, `backend/`, and `database/` folders were preserved.
- No business screen was intentionally removed or replaced.


## RFQ-001 – إصلاح وحدات المنتجات والضرائب في طلب عرض السعر
- حقل الوحدة في منتجات RFQ أصبح قائمة من وحدات المنتج/قالب الوحدات بدل إدخال يدوي.
- اختيار المنتج المضاف يدويًا في RFQ يجلب وحداته تلقائيًا.
- ضريبة عرض المورد أصبحت قائمة من إعدادات الضرائب مع ضريبة القيمة المضافة كافتراضي.
- تحسين تناسق جدول إدخال أسعار المورد ومحاذاة الهيدر مع الأعمدة.
- تحويل حقول الأسعار والخصم والشحن ومدة التوريد إلى إدخال نص رقمي بدون أسهم جانبية.

## RFQ-002 — RFQ workflow, font, and localization polish
- Added "Send for RFQ" action to saved Purchase Request rows.
- RFQ can now be opened directly from a Purchase Request and auto-links the PR reference.
- Improved RFQ source display with linked PR summary.
- Fixed PR reference dropdown population from saved purchase requests.
- Adopted Cairo for Arabic UI and Inter for English UI with consistent form/table rendering.
- Improved RFQ supplier offer table alignment.
- Added extra localization coverage for main modules and purchase/accounting/inventory menus.

## RFQ-004 — PR Sync, Partial AI Comparison, Supplier Contracts
- Added automatic sync when RFQ adds a product not found in the linked Purchase Request.
- New RFQ lines added after PR creation are marked with a note and saved back to PR lines with revision metadata.
- Added partial AI comparison for commonly priced items across suppliers when one supplier quotation is incomplete.
- Added supplier contract section to supplier form to track quarterly/annual contracts, targets, incentives, and active/expired status.

## RFQ-005 — Smart Purchasing Decision
- Fixed RFQ supplier offer total styling so header and footer totals follow the same visual system.
- Added AI recommendation approval and Create Purchase Order action in RFQ comparison.
- Added Purchase Intelligence Panel in RFQ comparison with last purchase price, average net price, average price including tax, current best quote, and last 3 purchase prices.
- Added clickable product rows in the comparison table to inspect historical purchase price context.
- Added demo purchase order generation from the approved/recommended RFQ supplier.

## ACC-CC-001 — Cost Centers screen (complete build)
- Replaced the "جاهزة للتطوير" placeholder with a full Cost Centers (مراكز التكلفة) screen: KPI summary cards, hierarchical (parent/child) or flat table view, search and filters (type, status), and an inline add/edit form.
- Backend: extended `cost_centers` with hierarchy (`parent_code`), type (`cost`/`profit`), manager, budget, and notes (migration `017_cost_centers_extended.sql`).
- Backend: added update, activate/deactivate, and delete endpoints; delete is blocked for centers with sub-centers and auto-deactivates centers already referenced by posted journal entries instead of hard-deleting, preserving historical report integrity.
- Backend: list/detail responses now include computed `actual_amount` and `entries_count` aggregated live from posted journal entry cost allocations, so budget-vs-actual is always driven by real ledger data.
- Frontend: budget consumption bar with over/near-budget highlighting, cycle-safe parent selector, CSV export, and automatic refresh of every cost-center dropdown across the system (journal entry lines, filters) after any change.

## ACC-COA-002 — Chart of Accounts export + professional Suppliers control account
- Chart of Accounts screen: added "تصدير Excel" and "تصدير PDF" buttons at the top of the screen. Excel export is a UTF-8 CSV preserving the tree order/indentation; PDF export opens a clean, print-ready report (LEGEND D letterhead, generation date, totals) via the browser print dialog — "Save as PDF".
- Accounts gained an `is_system` flag; system/foundational accounts (Suppliers 211 and its two new sub-accounts) show a "🔒 نظامي" badge in the tree and are protected from deletion and from being moved elsewhere in the hierarchy, both in the UI and the API.
- New fixed foundational sub-accounts under the Suppliers control account (211), matching Odoo/SAP default-payable-account practice:
  - `2111` — موردون - نشاط الشركة الأساسي (default for every new supplier)
  - `2112` — موردون - أنشطة أخرى
- Suppliers now carry an `account_code` linking them to one of these (or any other sub-account of 211 created later); the supplier form has a new "حساب المورد بدليل الحسابات" field, dynamically populated from the live chart of accounts and defaulting to `2111`. The API validates that a supplier's account is always a descendant of 211.
- Migration `018_supplier_accounts.sql`: adds `accounts.is_system`, seeds the two sub-accounts, adds `suppliers.account_code`, and backfills existing suppliers to `2111`.

## ACC-JRN-003 — Journal entry tax/supplier UX fixes
- Journal entries: the same tax type can no longer be applied to more than one line within the same entry — blocked both in the UI (duplicate option disabled in the per-line tax dropdown, plus a clear alert if attempted) and on the backend (`POST`/`PUT /api/journal` now reject a duplicate `tax_type_code` across an entry's lines with a 400 error), since duplicating a tax within one entry double-counts it.
- Journal entry form: "المورد" and "رقم فاتورة المورد" are now hidden by default and only appear once a line's tax panel is opened or a tax is actually applied to a line (or when editing an entry that already has one of them set) — keeping the form clean for entries that have nothing to do with VAT/suppliers.
- Confirmed the per-line tax type dropdown is already sourced live from the registered Tax Settings list (`/api/tax-types`), not a hardcoded list.

## ACC-JRN-004 — Explicit VAT toggle button in journal entry form
- Added a clearly-labeled "🧾 ضريبة القيمة المضافة" button above the journal entry lines table; clicking it explicitly reveals/hides the "المورد" and "رقم فاتورة المورد" fields — in addition to them still auto-revealing when a tax is applied to any line, or when editing an entry that already has one of them set.
- The button highlights (active state) whenever the supplier/invoice fields are currently visible, so it's obvious how to get back to them.

## ACC-JRN-005 — Tax amount number formatting + cache-busting
- Journal entry line tax panel: the "قيمة الضريبة" (tax amount) field now uses the same text-based numeric formatting as the debit/credit fields (comma-grouped Western digits) instead of a native `<input type="number">`, which was rendering as Arabic-Indic numerals and getting visually truncated in some browser/OS locale settings.
- Added a cache-busting version query string to script.js/i18n.js/users_roles.js so browsers and any CDN/proxy in front of the app reliably pick up new frontend code after each deployment instead of serving a stale cached copy — relevant since the last couple of fixes reportedly weren't showing up immediately.
