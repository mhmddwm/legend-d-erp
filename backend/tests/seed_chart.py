"""يبني دليل الحسابات الحقيقي من ملفات الهجرة (003 + 018 + 022 + 035) لاستخدامه في الاختبارات."""
import re, pathlib
MIG = pathlib.Path(__file__).resolve().parents[2] / "database" / "migrations"
NATURE = {"assets": "مدين", "expenses": "مدين"}

def seed_chart():
    accs = {}
    t = (MIG / "003_default_chart_of_accounts.sql").read_text(encoding="utf-8")
    for m in re.finditer(r"\('(\d+)',\s*'([^']*)',\s*'([^']*)',\s*'(\w+)',\s*(NULL|'\d+'),", t):
        code, ar, en, typ, parent = m.groups()
        accs[code] = dict(code=code, name_ar=ar, name_en=en, account_type=typ,
                          nature=NATURE.get(typ, "دائن"), parent_code=None if parent == "NULL" else parent.strip("'"),
                          is_active=True, is_system=False)
    # حسابات أضافتها هجرات أخرى / موجودة مسبقاً
    extra = [("123", "المخزون", "Inventory", "assets", "مدين", "12"),
             ("211", "الموردون", "Accounts Payable", "liabilities", "دائن", "21"),
             ("2111", "موردون - نشاط الشركة الأساسي", "Suppliers - Core Business Activity", "liabilities", "دائن", "211"),
             ("2112", "موردون - أنشطة أخرى", "Suppliers - Other Activities", "liabilities", "دائن", "211"),
             ("217", "بضاعة مستلمة غير مفوترة", "Goods Received Not Invoiced (GRNI)", "liabilities", "دائن", "21"),
             ("34", "أرصدة افتتاحية — مخزون", "Opening Stock Balances", "equity", "دائن", "3")]
    for code, ar, en, typ, nat, par in extra:
        accs[code] = dict(code=code, name_ar=ar, name_en=en, account_type=typ, nature=nat,
                          parent_code=par, is_active=True, is_system=code in ("211", "2111", "2112", "217", "34"))
    return list(accs.values())
