# CHANGELOG

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

## ACC-PUR-006 — Inventory posting moved to Goods Receipt (GRNI accrual)
- Chart of Accounts: added a new system account `217` — بضاعة مستلمة غير مفوترة / Goods Received Not Invoiced (GRNI) — as a liability sub-account under Current Liabilities (`21`), protected from deletion like the other system accounts (migration `022_grn_journal_grni_account.sql`).
- Goods Receipt (GRN): creating a GRN now posts its own automatic journal entry — debit Inventory (`123`) / credit GRNI (`217`) — for the received value. This is now the first accounting entry posted in the purchase cycle (previously the GRN screen posted no journal entry at all). `goods_receipts` gained a `journal_entry_id` column, mirroring how `purchase_invoices.journal_entry_id` already worked.
- Purchase Invoice: the automatic journal entry posted on invoicing no longer debits Inventory a second time. It now debits GRNI (`217`) to clear the accrual raised at receipt [+ debit the purchase-tax account when applicable] / credit the supplier's payable account — so inventory is only ever debited once, at receipt.
- Cancelling a posted purchase invoice still only cancels the invoice's own journal entry (the GRNI-clearing/payable entry); the GRN's inventory/GRNI entry is untouched, which correctly re-opens the GRNI accrual until the GRN is invoiced again.
- Frontend: updated the purchase invoice detail view's auto-posting hint to describe the new GRNI-clearing entry instead of the old (now inaccurate) "debit inventory" wording.
