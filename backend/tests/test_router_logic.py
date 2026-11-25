"""
اختبار دوال راوتر إعدادات الحسابات الفعلية بدون fastapi/sqlalchemy:
نحقن بدائل خفيفة (stubs) + قاعدة بيانات في الذاكرة، ثم نشغّل الكود الحقيقي للراوتر و get_default_account.
"""
import sys, types, pathlib, unittest, contextlib
HERE = pathlib.Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent)]
from seed_chart import seed_chart


# ---------- بدائل خفيفة
class HTTPException(Exception):
    def __init__(self, status_code, detail=None):
        self.status_code, self.detail = status_code, detail


class _Router:
    def __init__(self, *a, **k): pass
    def _d(self, *a, **k): return lambda f: f
    get = post = put = delete = patch = _d


class Col:
    def __init__(self, model, name): self.model, self.name = model, name
    def __eq__(self, other): return lambda row: getattr(row, self.name) == other
    __hash__ = object.__hash__


class Meta(type):
    def __getattr__(cls, n):
        if n in getattr(cls, "_cols", ()): return Col(cls, n)
        raise AttributeError(n)


class Account(metaclass=Meta):
    _cols = ("code", "name_ar")
    def __init__(self, **kw): self.__dict__.update(kw)


class AccountSetting(metaclass=Meta):
    _cols = ("key", "value")
    def __init__(self, **kw): self.__dict__.update(kw)


class Q:
    def __init__(self, rows, cols=None): self.rows, self.cols = rows, cols
    def filter(self, pred): return Q([r for r in self.rows if pred(r)], self.cols)
    def first(self): return self.all()[0] if self.all() else None
    def all(self):
        if self.cols is not None:
            return [types.SimpleNamespace(**{self.cols.name: getattr(r, self.cols.name)}) for r in self.rows]
        return list(self.rows)


class FakeDB:
    def __init__(self, accounts):
        self.t = {Account: [Account(**a) for a in accounts], AccountSetting: []}
        self.commits = 0
    def query(self, m):
        if isinstance(m, Col): return Q(self.t[m.model], m)
        return Q(self.t[m])
    def add(self, o): self.t[type(o)].append(o)
    def delete(self, o): self.t[type(o)].remove(o)
    def flush(self): pass
    def commit(self): self.commits += 1
    @contextlib.contextmanager
    def begin_nested(self): yield


def _install_stubs():
    fa = types.ModuleType("fastapi"); fa.APIRouter = _Router; fa.Depends = lambda f=None: f; fa.HTTPException = HTTPException
    pd = types.ModuleType("pydantic")
    class BaseModel:
        def __init__(self, **kw):
            for k, v in self.__class__.__dict__.items():
                if not k.startswith("_") and not callable(v): setattr(self, k, v)
            self.__dict__.update(kw)
    pd.BaseModel = BaseModel
    sa = types.ModuleType("sqlalchemy"); so = types.ModuleType("sqlalchemy.orm"); so.Session = object
    dbm = types.ModuleType("app.database"); dbm.get_db = lambda: None
    mm = types.ModuleType("app.models.models"); mm.Account = Account; mm.AccountSetting = AccountSetting
    mpkg = types.ModuleType("app.models"); mpkg.models = mm
    for n, m in (("fastapi", fa), ("pydantic", pd), ("sqlalchemy", sa), ("sqlalchemy.orm", so),
                 ("app.database", dbm), ("app.models", mpkg), ("app.models.models", mm)):
        sys.modules[n] = m

_install_stubs()
import importlib, importlib.util
_spec = importlib.util.spec_from_file_location("account_settings_router", HERE.parent / "app" / "routers" / "account_settings.py")
R = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(R)
D = importlib.import_module("app.account_defaults")


def new_db():
    accs = seed_chart()
    for a in accs: a.setdefault("opening_balance", 0)
    return FakeDB(accs)


class RouterLogic(unittest.TestCase):
    def test_get_state_defaults(self):
        st = R.get_settings(new_db())
        self.assertEqual(len(st["roles"]), 7)
        self.assertEqual(st["score"], 100)
        inv = next(r for r in st["roles"] if r["key"] == "inventory")
        self.assertEqual((inv["code"], inv["source"], inv["status"]), ("123", "default", "ok"))
        self.assertEqual(inv["account"]["name"], "المخزون")
        self.assertTrue(st["options"])

    def test_put_validation_collects_all_problems(self):
        db = new_db()
        with self.assertRaises(HTTPException) as cx:
            R.save_settings(R.SettingsIn(defaults={"inventory": "999", "cogs": "41", "zzz": "1"}, erp_profile="nope"), db)
        d = cx.exception.detail
        self.assertEqual(cx.exception.status_code, 400)
        for frag in ("999", "نوع", "دور غير معروف", "نمط ERP"):
            self.assertIn(frag, d)
        self.assertEqual(db.t[AccountSetting], [])             # لم يُحفظ شيء

    def test_put_saves_and_get_default_account_reads_it(self):
        db = new_db()
        # حساب مخزون بديل
        db.t[Account].append(Account(code="1231", name_ar="مخزون بضاعة تامة", name_en="", account_type="assets",
                                     nature="مدين", parent_code="123", is_active=True, is_system=False, opening_balance=0))
        self.assertEqual(D.get_default_account(db, "inventory"), "123")            # قبل الإعداد
        st = R.save_settings(R.SettingsIn(defaults={"inventory": "1231"}, erp_profile="sap"), db)
        self.assertEqual(D.get_default_account(db, "inventory"), "1231")           # بعد الإعداد
        self.assertEqual(st["profile"], "sap")
        inv = next(r for r in st["roles"] if r["key"] == "inventory")
        self.assertEqual((inv["code"], inv["source"]), ("1231", "custom"))
        # تحديث ثم إرجاع للافتراضي
        R.save_settings(R.SettingsIn(defaults={"inventory": ""}), db)
        self.assertEqual(D.get_default_account(db, "inventory"), "123")
        self.assertEqual([r.key for r in db.t[AccountSetting]], ["erp_profile"])

    def test_get_default_account_legacy_param_and_fallback_on_error(self):
        db = new_db()
        self.assertEqual(D.get_default_account(db, "payable", "2111"), "2111")      # legacy مُمرَّر
        self.assertEqual(D.get_default_account(db, "payable"), "211")
        class Broken(FakeDB):
            def query(self, m): raise RuntimeError("relation account_settings does not exist")
        self.assertEqual(D.get_default_account(Broken([]), "cogs"), "51")           # الهجرة لم تُطبَّق
        self.assertEqual(D.load_role_settings(Broken([])), {})

    def test_state_flags_invalid_saved_role(self):
        db = new_db()
        db.t[AccountSetting].append(AccountSetting(key="default.inventory", value="777"))
        st = R.get_settings(db)
        inv = next(r for r in st["roles"] if r["key"] == "inventory")
        self.assertEqual(inv["status"], "error")
        self.assertIsNone(inv["account"])
        self.assertLess(st["score"], 100)

    def test_suggest_and_audit_endpoints(self):
        db = new_db()
        s = R.suggest(db)
        self.assertEqual(len(s["suggestions"]), 7)
        self.assertTrue(all(not x["differs"] for x in s["suggestions"]))
        a = R.audit(db)
        self.assertEqual(a["score"], 100)

    def test_export_endpoint_validation(self):
        db = new_db()
        self.assertEqual(R.export("odoo", "left", False, db)["format"], "odoo")
        with self.assertRaises(HTTPException): R.export("excel", "left", False, db)
        with self.assertRaises(HTTPException): R.export("sap", "weird", False, db)

    def test_import_preview_and_commit_flow(self):
        db = new_db()
        before = len(db.t[Account])
        csv_text = ("code,name,account_type\n"
                    "5100,رواتب الموظفين,\n"            # نوع مُستنتج (AI)
                    "5110,رواتب إدارية,expense\n"       # نوع من الملف (Odoo)
                    "123,مخزون مكرر,asset_current\n"    # موجود
                    ",بدون كود,asset_current\n")        # خطأ
        pv = R.import_preview(R.ImportIn(text=csv_text), db)
        self.assertEqual(pv["summary"], dict(total=4, new=2, exists=1, errors=1, inferred=1))
        # يلزم تأكيد
        with self.assertRaises(HTTPException): R.import_commit(R.ImportIn(text=csv_text), db)
        # بدون قبول التصنيف الآلي: يُتخطى 5100، ويُنشأ 5110 فقط
        r = R.import_commit(R.ImportIn(text=csv_text, confirm=True, accept_inferred=False), db)
        self.assertEqual((r["created"], r["skipped_inferred"]), (1, ["5100"]))
        self.assertEqual(len(db.t[Account]), before + 1)
        # مع القبول: يُنشأ 5100، ويصبح 5110 موجوداً (لا تعديل)
        r = R.import_commit(R.ImportIn(text=csv_text, confirm=True, accept_inferred=True), db)
        self.assertEqual(r["created"], 1)
        new = {a.code: a for a in db.t[Account]}
        self.assertEqual(new["5100"].account_type, "expenses")
        self.assertEqual(new["5100"].nature, "مدين")
        self.assertEqual(new["5110"].opening_balance, 0)
        self.assertFalse(new["5110"].is_system)

    def test_import_fatal_and_size_limit(self):
        db = new_db()
        with self.assertRaises(HTTPException) as cx: R.import_preview(R.ImportIn(text=""), db)
        self.assertEqual(cx.exception.status_code, 400)
        with self.assertRaises(HTTPException) as cx: R.import_preview(R.ImportIn(text="x" * (R.MAX_IMPORT_CHARS + 1)), db)
        self.assertEqual(cx.exception.status_code, 413)


if __name__ == "__main__":
    unittest.main()
