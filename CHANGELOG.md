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
