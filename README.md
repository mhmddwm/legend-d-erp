# نظام ERP — تعليمات التثبيت والتشغيل

## المتطلبات
- Python 3.10 أو أحدث
- PostgreSQL 14 أو أحدث
- متصفح ويب حديث

---

## الخطوة 1: تثبيت PostgreSQL وإنشاء قاعدة البيانات

### على Windows:
1. حمّل PostgreSQL من: https://www.postgresql.org/download/windows/
2. ثبّته واحتفظ بكلمة مرور المستخدم `postgres`
3. افتح **pgAdmin** أو **psql** ونفّذ:

```sql
CREATE DATABASE erp_db;
CREATE USER erp_user WITH PASSWORD 'erp_password';
GRANT ALL PRIVILEGES ON DATABASE erp_db TO erp_user;
```

### على macOS:
```bash
brew install postgresql
brew services start postgresql
psql postgres -c "CREATE DATABASE erp_db;"
psql postgres -c "CREATE USER erp_user WITH PASSWORD 'erp_password';"
psql postgres -c "GRANT ALL PRIVILEGES ON DATABASE erp_db TO erp_user;"
```

### على Ubuntu/Linux:
```bash
sudo apt install postgresql postgresql-contrib
sudo -u postgres psql -c "CREATE DATABASE erp_db;"
sudo -u postgres psql -c "CREATE USER erp_user WITH PASSWORD 'erp_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE erp_db TO erp_user;"
```

---

## الخطوة 2: تحميل مخطط قاعدة البيانات

```bash
# Windows (psql في مجلد التثبيت، عادةً C:\Program Files\PostgreSQL\16\bin)
psql -U erp_user -d erp_db -f database/schema.sql

# macOS / Linux
psql -U erp_user -d erp_db -f database/schema.sql
```

> ملاحظة: هذا يُنشئ كل الجداول ويُدخل بيانات دليل الحسابات الافتراضية تلقائياً.

---

## الخطوة 3: إعداد Backend Python

```bash
cd backend

# إنشاء بيئة Python افتراضية
python -m venv venv

# تفعيل البيئة
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# تثبيت المكتبات
pip install -r requirements.txt

# نسخ ملف الإعدادات وتعديله
cp .env.example .env
```

افتح ملف `.env` وتأكد من صحة بيانات الاتصال:
```
DATABASE_URL=postgresql://erp_user:erp_password@localhost:5432/erp_db
CORS_ORIGINS=*
```

---

## الخطوة 4: تشغيل الخادم

```bash
# تأكد أنك داخل مجلد backend وأن البيئة الافتراضية مفعّلة
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

ستظهر رسالة مثل:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Application startup complete.
```

---

## الخطوة 5: فتح الواجهة

افتح المتصفح على العنوان:
```
http://localhost:8000
```

ستجد النظام يعمل مع شريط اتصال أخضر يؤكد الاتصال بقاعدة البيانات.

---

## هيكل المجلدات

```
erp-real/
├── database/
│   └── schema.sql          ← مخطط قاعدة البيانات (نفّذه مرة واحدة)
├── backend/
│   ├── requirements.txt    ← مكتبات Python
│   ├── .env.example        ← نموذج إعدادات البيئة
│   └── app/
│       ├── main.py         ← نقطة بداية التطبيق
│       ├── database.py     ← الاتصال بقاعدة البيانات
│       ├── services.py     ← دوال مساعدة (أرقام تسلسلية، أرصدة)
│       ├── models/         ← نماذج SQLAlchemy
│       ├── schemas/        ← نماذج Pydantic للتحقق
│       └── routers/        ← نقاط API لكل موديول
│           ├── accounting.py   ← دليل الحسابات والقيود
│           ├── inventory.py    ← الأصناف والمخزون والموردين
│           └── purchasing.py   ← طلبات الشراء والاستلام والفواتير والمرتجعات
└── frontend/
    └── index.html          ← الواجهة الكاملة (HTML/JS)
```

---

## API Documentation

بعد تشغيل الخادم يمكنك الاطلاع على توثيق الـ API التفاعلي على:
```
http://localhost:8000/docs
```

---

## نقاط API الرئيسية

| الوصف | النقطة |
|---|---|
| دليل الحسابات | GET/POST /api/accounts |
| تعديل/حذف حساب | PUT/DELETE /api/accounts/{code} |
| القيود اليومية | GET/POST /api/journal |
| الأصناف | GET/POST /api/items |
| حركات المخزون | GET /api/stock-moves |
| الموردون | GET/POST /api/suppliers |
| طلبات الشراء | GET/POST /api/purchase-orders |
| الاستلام (GRN) | GET/POST /api/goods-receipts |
| فواتير المشتريات | GET/POST /api/purchase-invoices |
| مرتجعات المشتريات | GET/POST /api/purchase-returns |

---

## استمرارية المشروع للمستقبل

كل التعديلات والبيانات التي تُدخلها محفوظة في قاعدة بيانات PostgreSQL على جهازك.
لإكمال المشروع لاحقاً (إضافة موديول المبيعات مثلاً)، شارك هذا المجلد مع Claude أو صف ما تريد إضافته وسيُكمل على نفس البنية.

---

## حل المشاكل الشائعة

**خطأ: `psycopg2 not found`**
```bash
pip install psycopg2-binary
```

**خطأ: `connection refused` عند الاتصال بـ PostgreSQL**
- تأكد من أن PostgreSQL يعمل
- تحقق من بيانات الاتصال في `.env`

**الواجهة لا تتصل بالخادم**
- تأكد من تشغيل `uvicorn` على المنفذ 8000
- افتح المتصفح على `http://localhost:8000` وليس عبر فتح الملف مباشرة
