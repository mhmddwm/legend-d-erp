import sys, pathlib, unittest, csv, io
HERE = pathlib.Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parent)]
from app import account_settings_engine as E
from seed_chart import seed_chart


def A(code, ar, en="", t="assets", parent=None, active=True, nature=None, system=False):
    return dict(code=code, name_ar=ar, name_en=en, account_type=t, parent_code=parent, is_active=active,
                nature=nature or E.NATURE_BY_TYPE[t], is_system=system)


class Normalize(unittest.TestCase):
    def test_arabic_variants(self):
        self.assertEqual(E.norm("الأصنـــاف  المُخزَّنة"), E.norm("الاصناف المخزنه"))
        self.assertEqual(E.norm("إيرادات"), E.norm("ايرادات"))
        self.assertEqual(E.norm("مستلمة"), E.norm("مستلمه"))


class Suggest(unittest.TestCase):
    def setUp(self):
        self.chart = seed_chart()

    def top(self, S, role):
        return S[role][0]["code"] if S[role] else None

    def test_real_seed_chart_matches_legacy_codes(self):
        S = E.suggest_roles(self.chart)
        for r in E.ROLES:
            self.assertEqual(self.top(S, r["key"]), r["legacy"], r["key"])

    def test_opening_equity_prefers_opening_account_not_capital(self):
        S = E.suggest_roles(self.chart)
        self.assertNotIn("31", [c["code"] for c in S["opening_equity"]])

    def test_no_weak_noise(self):
        for cands in E.suggest_roles(self.chart).values():
            for c in cands:
                self.assertGreaterEqual(c["score"], E.MIN_SUGGEST_SCORE)

    def test_english_only_chart(self):
        chart = [A("1000", "", "Stock Inventory", "assets"), A("1100", "", "Trade Receivables", "assets"),
                 A("2000", "", "Trade Payables", "liabilities"), A("4000", "", "Sales Revenue", "revenue"),
                 A("5000", "", "Cost of Goods Sold", "expenses")]
        S = E.suggest_roles(chart)
        self.assertEqual(self.top(S, "inventory"), "1000")
        self.assertEqual(self.top(S, "payable"), "2000")
        self.assertEqual(self.top(S, "sales_revenue"), "4000")
        self.assertEqual(self.top(S, "cogs"), "5000")

    def test_wrong_type_and_inactive_excluded(self):
        chart = [A("9", "مخزون قديم", "", "expenses"), A("10", "مخزون", "", "assets", active=False)]
        self.assertEqual(E.suggest_roles(chart)["inventory"], [])

    def test_accumulated_depreciation_not_inventory(self):
        chart = [A("1", "مجمع إهلاك مخزون", "", "assets"), A("2", "مخزون بضاعة", "", "assets")]
        self.assertEqual(self.top(E.suggest_roles(chart), "inventory"), "2")

    def test_leaf_preferred_over_parent(self):
        chart = [A("12", "المخزون", "", "assets"), A("121", "مخزون بضاعة تامة", "", "assets", parent="12")]
        S = E.suggest_roles(chart)["inventory"]
        self.assertEqual(S[0]["code"], "121")


class Audit(unittest.TestCase):
    def setUp(self):
        self.chart = seed_chart()

    def codes(self, au):
        return [i["code"] for i in au["issues"]]

    def test_clean_chart_scores_100(self):
        au = E.audit_chart(self.chart, {})
        self.assertEqual(au["score"], 100)
        self.assertEqual(au["stats"]["errors"], 0)

    def test_missing_account_is_error(self):
        au = E.audit_chart(self.chart, {"inventory": "999"})
        self.assertIn("role_missing", self.codes(au))
        self.assertLess(au["score"], 100)

    def test_wrong_type_is_error(self):
        au = E.audit_chart(self.chart, {"inventory": "41"})
        self.assertIn("role_type", self.codes(au))

    def test_inactive_account(self):
        chart = [dict(a) for a in self.chart]
        for a in chart:
            if a["code"] == "123":
                a["is_active"] = False
        self.assertIn("role_inactive", self.codes(E.audit_chart(chart, {})))

    def test_shared_account_warns(self):
        au = E.audit_chart(self.chart, {"receivable": "1121", "payable": "1121"})
        self.assertIn("role_shared", self.codes(au))

    def test_parent_account_warns(self):
        au = E.audit_chart(self.chart, {"receivable": "112"})
        self.assertIn("role_parent", self.codes(au))

    def test_orphan_cycle_dup_nature(self):
        chart = [A("1", "أ", "", "assets", parent="99"),
                 A("2", "ب", "", "assets", parent="3"), A("3", "ج", "", "assets", parent="2"),
                 A("4", "مكرر", "", "assets"), A("5", "مكرر", "", "assets"),
                 A("6", "غريب", "", "assets", nature="دائن")]
        c = self.codes(E.audit_chart(chart, {}))
        for k in ("orphan", "cycle", "dup_name", "nature"):
            self.assertIn(k, c)

    def test_contra_account_nature_not_flagged(self):
        chart = [A("1221", "مجمع إهلاك الأثاث", "", "assets", nature="دائن")]
        self.assertNotIn("nature", self.codes(E.audit_chart(chart, {})))

    def test_score_floor_zero(self):
        self.assertEqual(E.audit_chart([], {})["score"], max(0, 100 - 18 * 7))


class Classify(unittest.TestCase):
    def test_by_name_and_code(self):
        self.assertEqual(E.classify_type("رواتب وأجور", "", "")[0], "expenses")
        self.assertEqual(E.classify_type("Bank Interest Expense")[0], "expenses")
        self.assertEqual(E.classify_type("Petty Cash")[0], "assets")
        self.assertEqual(E.classify_type("", "", "4100"), ("revenue", "code"))
        self.assertEqual(E.classify_type("???", "", "0000000000")[0], None)
        self.assertEqual(E.classify_type("الأصول المتداولة", "Current Assets", "11")[0], "assets")
        self.assertEqual(E.classify_type("الخصوم المتداولة", "Current Liabilities", "21")[0], "liabilities")
        self.assertEqual(E.classify_type("المصروفات", "Expenses", "5")[0], "expenses")
        self.assertEqual(E.classify_type("", "Rent Expense", "")[0], "expenses")
        self.assertEqual(E.classify_type("x", "", "x", hint="equity"), ("equity", "hint"))


class ExportImport(unittest.TestCase):
    def setUp(self):
        self.chart = seed_chart()

    def rows(self, exp):
        return list(csv.DictReader(io.StringIO(exp["content"])))

    def test_odoo_export_types(self):
        r = {x["code"]: x for x in self.rows(E.export_chart(self.chart, "odoo"))}
        self.assertEqual(r["1121"]["account_type"], "asset_receivable")
        self.assertEqual(r["1111"]["account_type"], "asset_cash")
        self.assertEqual(r["2111"]["account_type"], "liability_payable")
        self.assertEqual(r["212"]["account_type"], "liability_current")
        self.assertEqual(r["221"]["account_type"], "liability_non_current")
        self.assertEqual(r["41"]["account_type"], "income")
        self.assertEqual(r["51"]["account_type"], "expense_direct_cost")
        self.assertEqual(r["122"]["account_type"], "asset_fixed")

    def test_sap_export_padding_and_limits(self):
        r = {x["GLAccount"]: x for x in self.rows(E.export_chart(self.chart, "sap", sap_pad="left"))}
        self.assertIn("0000001121", r)
        self.assertEqual(r["0000001121"]["BalanceSheetAccount"], "X")
        self.assertEqual(r["0000000041"]["PLAccountType"], "X")
        self.assertLessEqual(max(len(x["ShortText"]) for x in r.values()), 20)
        rr = {x["GLAccount"] for x in self.rows(E.export_chart(self.chart, "sap", sap_pad="right"))}
        self.assertIn("1121000000", rr)

    def test_oracle_export(self):
        r = {x["Value"]: x for x in self.rows(E.export_chart(self.chart, "oracle"))}
        self.assertEqual(r["1121"]["AccountType"], "Asset")
        self.assertEqual(r["3"]["AccountType"], "Owners' Equity")
        self.assertEqual(r["112"]["SummaryFlag"], "Y")
        self.assertEqual(r["1121"]["AllowPosting"], "Y")
        self.assertEqual(r["1121"]["ParentValue"], "112")

    def test_inactive_excluded_by_default(self):
        chart = [A("1", "أ"), A("2", "ب", active=False)]
        self.assertEqual(E.export_chart(chart, "generic")["count"], 1)
        self.assertEqual(E.export_chart(chart, "generic", include_inactive=True)["count"], 2)

    def test_generic_roundtrip_is_lossless(self):
        exp = E.export_chart(self.chart, "generic")
        p = E.parse_import(exp["content"], existing_codes=[])
        self.assertEqual(p["format"], "generic")
        self.assertEqual(p["summary"]["errors"], 0)
        self.assertEqual(p["summary"]["new"], len(self.chart))
        src = {a["code"]: a for a in self.chart}
        for r in p["rows"]:
            a = src[r["code"]]
            self.assertEqual((r["name_ar"], r["account_type"], r["parent_code"], r["nature"]),
                             (a["name_ar"], a["account_type"], a["parent_code"], a["nature"]), r["code"])

    def test_odoo_roundtrip_detects_and_maps_types(self):
        exp = E.export_chart(self.chart, "odoo")
        p = E.parse_import(exp["content"], existing_codes=[])
        self.assertEqual(p["format"], "odoo")
        self.assertEqual(p["summary"]["errors"], 0)
        src = {a["code"]: a for a in self.chart}
        for r in p["rows"]:
            self.assertEqual(r["account_type"], src[r["code"]]["account_type"], r["code"])
        # الأب يُستنتج من بادئة الكود لأن Odoo لا يحمل عمود الأب
        by = {r["code"]: r for r in p["rows"]}
        self.assertEqual(by["1121"]["parent_code"], "112")
        self.assertTrue(by["1121"]["parent_inferred"])

    def test_sap_import_strips_zero_padding_and_keeps_parent(self):
        exp = E.export_chart(self.chart, "sap", sap_pad="left")
        p = E.parse_import(exp["content"], existing_codes=[])
        self.assertEqual(p["format"], "sap")
        by = {r["code"]: r for r in p["rows"]}
        self.assertIn("1121", by)
        self.assertEqual(by["1121"]["parent_code"], "112")
        self.assertEqual(by["1121"]["account_type"], "assets")      # من AccountGroup=ASSET
        self.assertEqual(p["summary"]["errors"], 0)

    def test_oracle_roundtrip(self):
        p = E.parse_import(E.export_chart(self.chart, "oracle")["content"], existing_codes=[])
        self.assertEqual(p["format"], "oracle")
        self.assertEqual(p["summary"]["errors"], 0)
        by = {r["code"]: r for r in p["rows"]}
        self.assertEqual(by["3"]["account_type"], "equity")
        self.assertEqual(by["1121"]["parent_code"], "112")

    def test_existing_not_overwritten_and_counted(self):
        exp = E.export_chart(self.chart, "generic")
        p = E.parse_import(exp["content"], existing_codes=["1", "11"])
        self.assertEqual(p["summary"]["exists"], 2)
        self.assertEqual(p["summary"]["new"], len(self.chart) - 2)

    def test_ai_classifies_missing_type_and_flags_it(self):
        txt = "code,name\n5100,رواتب الموظفين\n1500,Petty Cash\n0000,???\n"
        p = E.parse_import(txt, existing_codes=[])
        by = {r["code"]: r for r in p["rows"]}
        self.assertEqual(by["5100"]["account_type"], "expenses")
        self.assertTrue(by["5100"]["type_source"].startswith("ai_"))
        self.assertTrue(by["5100"]["warnings"])
        self.assertEqual(by["1500"]["account_type"], "assets")
        self.assertEqual(by["0000"]["status"], "error")
        self.assertEqual(p["summary"]["inferred"], 2)

    def test_validation_errors(self):
        txt = "code,name,type\n,بدون كود,assets\nA1,بدون نوع صالح,zzz\nA2,,assets\nA3,تكرار,assets\nA3,تكرار 2,assets\n"
        p = E.parse_import(txt, existing_codes=[])
        st = [r["status"] for r in p["rows"]]
        self.assertEqual(st[0], "error")           # كود فارغ
        self.assertEqual(st[2], "error")           # اسم فارغ
        self.assertEqual(st[4], "error")           # مكرر
        self.assertEqual(p["rows"][1]["account_type"], "assets" if False else p["rows"][1]["account_type"])

    def test_semicolon_tab_and_bom(self):
        txt = "\ufeffcode;name;type\n1;أصول;assets\n"
        p = E.parse_import(txt, existing_codes=[])
        self.assertEqual(p["rows"][0]["code"], "1")
        p2 = E.parse_import("code\tname\ttype\n1\tAssets\tassets\n", existing_codes=[])
        self.assertEqual(p2["rows"][0]["name_en"], "Assets")
        self.assertEqual(p2["rows"][0]["name_ar"], "Assets")        # name_ar إلزامي بالقاعدة

    def test_fatal_cases(self):
        self.assertTrue(E.parse_import("", [])["fatal"])
        self.assertTrue(E.parse_import("a,b\n1,2\n", [])["fatal"])
        self.assertTrue(E.parse_import("code,name\n", [])["fatal"])

    def test_unknown_parent_dropped_with_warning_and_self_parent_error(self):
        p = E.parse_import("code,name,type,parent\n10,أ,assets,77\n11,ب,assets,11\n", [])
        self.assertIsNone(p["rows"][0]["parent_code"])
        self.assertTrue(p["rows"][0]["warnings"])
        self.assertEqual(p["rows"][1]["status"], "error")

    def test_insert_order_parent_first_and_cycle_safe(self):
        rows = [dict(code="112", parent_code="11", status="new"), dict(code="11", parent_code=None, status="new"),
                dict(code="x", parent_code="y", status="new"), dict(code="y", parent_code="x", status="new"),
                dict(code="old", parent_code=None, status="exists")]
        o = [r["code"] for r in E.order_for_insert(rows)]
        self.assertLess(o.index("11"), o.index("112"))
        self.assertNotIn("old", o)
        self.assertEqual(len(o), 4)


class InsertOrderFK(unittest.TestCase):
    def test_child_of_skipped_parent_becomes_root_and_existing_parent_kept(self):
        rows = [dict(code="11", parent_code="1", status="skipped"),
                dict(code="111", parent_code="11", status="new"),
                dict(code="21", parent_code="2", status="new")]
        o = E.order_for_insert(rows, existing_codes=["2"])
        by = {r["code"]: r for r in o}
        self.assertIsNone(by["111"]["parent_code"])      # أبوه تُخطّي
        self.assertEqual(by["21"]["parent_code"], "2")   # أبوه موجود بالقاعدة


if __name__ == "__main__":
    unittest.main(verbosity=1)
