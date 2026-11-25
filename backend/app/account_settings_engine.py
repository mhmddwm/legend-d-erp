"""
محرك إعدادات الحسابات (PF-01.11) — وحدة نقية بلا اعتماد على قاعدة البيانات أو FastAPI.

يعمل على قوائم قواميس بسيطة للحسابات:
    {"code","name_ar","name_en","account_type","nature","parent_code","is_active","is_system"}

ويوفّر:
  1) ROLES            — الحسابات الافتراضية التي تعتمد عليها القيود التلقائية (مخزون، عملاء، ...).
  2) suggest_roles    — اقتراح الحساب الأنسب لكل دور (تحليل أسماء عربي/إنجليزي + النوع + الهيكل).
  3) audit_chart      — فحص صحة دليل الحسابات والإعدادات مع درجة صحة وتوصيات.
  4) export_chart     — تصدير الدليل بصيغ Odoo / SAP / Oracle / عام.
  5) parse_import     — قراءة ملف من هذه الأنظمة، اكتشاف صيغته تلقائياً، وتصنيف الأنواع الناقصة.

ملاحظة صادقة: «الذكاء» هنا محرك تقييم قواعدي محلي (تطبيع عربي + أوزان كلمات + بنية الشجرة)،
وليس نموذجاً لغوياً خارجياً؛ لذلك يعمل دون إنترنت ودون إرسال بيانات الشركة لأي جهة.
"""
from __future__ import annotations

import csv
import io
import re
from collections import defaultdict

# ======================================================================
# 1) الأدوار (الحسابات الافتراضية)
# ======================================================================
# legacy = الكود الذي كان مكتوباً داخل الكود قبل هذه الشاشة (يبقى fallback فيتطابق السلوك القديم).
ROLES = [
    dict(key="inventory", label="حساب المخزون", type="assets", legacy="123",
         used_by="المشتريات، المبيعات (تكلفة)، الرصيد الافتتاحي",
         include_ar=["مخزون", "بضاعه", "مخازن", "مستودع", "اصناف"],
         include_en=["inventory", "stock", "merchandise", "goods"],
         exclude=["مجمع", "اهلاك", "غير مفوتر", "grni", "gr/ir", "مردود", "accum", "depreciation", "received"]),
    dict(key="grni", label="بضاعة مستلمة غير مفوترة (GRNI)", type="liabilities", legacy="217",
         used_by="استلام البضاعة (GRN) قبل الفاتورة",
         include_ar=["مستلمه غير مفوتره", "غير مفوتر", "بضاعه مستلمه"],
         include_en=["grni", "gr/ir", "goods received not invoiced", "received not invoiced"],
         exclude=[]),
    dict(key="payable", label="حساب الموردين الافتراضي", type="liabilities", legacy="211",
         legacy_new_supplier="2111",
         used_by="المورد الجديد، فواتير المشتريات، مدفوعات الموردين",
         include_ar=["موردون", "مورد", "ذمم دائنه"],
         include_en=["accounts payable", "payable", "suppliers", "vendors", "creditors"],
         exclude=["اوراق دفع", "notes payable", "دفعات مقدمه", "advance", "ضريبه", "vat", "tax"]),
    dict(key="receivable", label="حساب العملاء الافتراضي", type="assets", legacy="1121",
         used_by="العميل الجديد، فواتير المبيعات، التحصيلات",
         include_ar=["عملاء", "عميل", "ذمم مدينه"],
         include_en=["customers", "accounts receivable", "receivable", "debtors"],
         exclude=["اوراق قبض", "notes receivable", "دفعات مقدمه", "advance", "ضريبه", "vat", "tax"]),
    dict(key="sales_revenue", label="إيرادات المبيعات", type="revenue", legacy="41",
         used_by="فواتير المبيعات",
         include_ar=["ايرادات المبيعات", "مبيعات", "ايراد"],
         include_en=["sales revenue", "revenue", "sales", "income"],
         exclude=["مردود", "مسموحات", "اخري", "returns", "allowance", "other"]),
    dict(key="cogs", label="تكلفة البضاعة المباعة", type="expenses", legacy="51",
         used_by="فواتير المبيعات، مرتجعات المبيعات",
         include_ar=["تكلفه البضاعه المباعه", "تكلفه المبيعات", "تكلفه المباع"],
         include_en=["cost of goods sold", "cogs", "cost of sales", "cost of goods"],
         exclude=[]),
    dict(key="opening_equity", label="أرصدة افتتاحية (طرف دائن)", type="equity", legacy="34",
         used_by="قيد المخزون الافتتاحي",
         include_ar=["ارصده افتتاحيه", "رصيد افتتاحي", "افتتاحي"],
         include_en=["opening balance", "opening stock", "opening equity"],
         exclude=["مسحوبات", "drawings"]),
]
ROLE_BY_KEY = {r["key"]: r for r in ROLES}
SETTING_PREFIX = "default."
ACCOUNT_TYPES = ("assets", "liabilities", "equity", "revenue", "expenses")
TYPE_LABELS = {"assets": "أصول", "liabilities": "خصوم", "equity": "حقوق ملكية",
               "revenue": "إيرادات", "expenses": "مصروفات"}
NATURE_BY_TYPE = {"assets": "مدين", "expenses": "مدين",
                  "liabilities": "دائن", "equity": "دائن", "revenue": "دائن"}
PROFILES = ("generic", "odoo", "sap", "oracle")
MIN_SUGGEST_SCORE = 30


def legacy_code(role_key: str, variant: str | None = None) -> str:
    r = ROLE_BY_KEY[role_key]
    if variant == "new_supplier" and r.get("legacy_new_supplier"):
        return r["legacy_new_supplier"]
    return r["legacy"]


# ======================================================================
# 2) تطبيع النص العربي/الإنجليزي
# ======================================================================
_AR_DIACRITICS = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u0640]")
_NON_WORD = re.compile(r"[^\w/\s]", re.UNICODE)


def norm(text) -> str:
    """تطبيع: إزالة التشكيل والتطويل، توحيد الألف/الياء/التاء المربوطة، أحرف صغيرة."""
    s = str(text or "").strip().lower()
    s = _AR_DIACRITICS.sub("", s)
    for a, b in (("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ٱ", "ا"), ("ى", "ي"), ("ة", "ه"), ("ؤ", "و"), ("ئ", "ي")):
        s = s.replace(a, b)
    s = _NON_WORD.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


def _tokens(s: str):
    out = []
    for t in norm(s).split():
        if len(t) > 3 and t.startswith("ال"):
            t = t[2:]
        out.append(t)
    return out


def _joined(text) -> str:
    return " " + " ".join(_tokens(text)) + " "


def kw_in(text, kw) -> bool:
    """مطابقة كلمة/عبارة عند بداية كلمة فقط (rent لا تطابق current؛ مصروف تطابق المصروفات)."""
    k = " ".join(_tokens(kw))
    return bool(k) and (" " + k) in _joined(text)


def has_arabic(s) -> bool:
    return bool(re.search(r"[\u0600-\u06FF]", str(s or "")))


# ======================================================================
# 3) هيكل الشجرة
# ======================================================================
def _index(accounts):
    by_code = {str(a["code"]): a for a in accounts}
    children = defaultdict(list)
    for a in accounts:
        p = a.get("parent_code")
        if p:
            children[str(p)].append(str(a["code"]))
    return by_code, children


def _active_children(code, by_code, children):
    return [c for c in children.get(code, []) if by_code[c].get("is_active", True)]


# ======================================================================
# 4) الاقتراح الذكي لكل دور
# ======================================================================
def score_account(role, acc, by_code, children):
    """يعيد (score 0..100, [أسباب]) أو (None, []) إذا لا يصلح الحساب لهذا الدور."""
    if not acc.get("is_active", True):
        return None, []
    if acc.get("account_type") != role["type"]:
        return None, []

    name_ar = norm(acc.get("name_ar"))
    name_en = norm(acc.get("name_en"))
    full = f"{name_ar} {name_en}".strip()
    toks = set(_tokens(full))
    score, reasons = 0.0, []

    best = (0, "")
    for ph in role["include_ar"] + role["include_en"]:
        phn = norm(ph)
        if not phn:
            continue
        if name_ar == phn or name_en == phn:
            cand = (70, f"اسم الحساب يطابق «{ph}» تماماً")
        elif kw_in(full, ph):
            cand = (55, f"الاسم يحتوي «{ph}»")
        else:
            ptoks = set(_tokens(phn))
            if ptoks and ptoks <= toks:
                cand = (45, f"الاسم يضم كلمات «{ph}»")
            else:
                continue
        if cand[0] > best[0]:
            best = cand
    if best[0] == 0:
        return None, []
    score += best[0] + 10
    reasons = [f"النوع «{TYPE_LABELS[role['type']]}» مناسب", best[1]]

    for ex in role["exclude"]:
        if kw_in(full, ex):
            score -= 60
            reasons.append(f"يحتوي كلمة مستبعدة «{ex}»")
            break

    code = str(acc["code"])
    kids = _active_children(code, by_code, children)
    if not kids:
        score += 15
        reasons.append("حساب فرعي نهائي (مناسب للترحيل)")
    else:
        score -= 5
        reasons.append("حساب رئيسي له فروع")
    if acc.get("is_system"):
        score += 5
        reasons.append("حساب نظامي")
    if code == role["legacy"]:
        score += 8
        reasons.append("هو الكود التقليدي المستخدم بالنظام")
    return max(0.0, min(100.0, score)), reasons


def suggest_roles(accounts, current=None, top_n=3):
    """اقتراحات مرتبة لكل دور: {role_key: [{code,name,score,confidence,reasons}]}"""
    by_code, children = _index(accounts)
    current = current or {}
    out = {}
    for role in ROLES:
        cands = []
        for acc in accounts:
            sc, why = score_account(role, acc, by_code, children)
            if sc is None or sc < MIN_SUGGEST_SCORE:
                continue
            cands.append(dict(code=str(acc["code"]),
                              name=acc.get("name_ar") or acc.get("name_en") or "",
                              score=round(sc, 1), reasons=why,
                              confidence=_conf(sc)))
        cands.sort(key=lambda c: (-c["score"], len(c["code"]), c["code"]))
        out[role["key"]] = cands[:top_n]
    return out


def _conf(score):
    return "high" if score >= 85 else "medium" if score >= 60 else "low"


# ======================================================================
# 5) فحص الصحة
# ======================================================================
def resolve_role_code(role, settings):
    v = (settings or {}).get(role["key"])
    return (str(v), "custom") if v else (role["legacy"], "default")


def audit_chart(accounts, settings=None):
    """
    يعيد dict: score(0..100)، grade، issues[]، stats.
    كل issue: {severity: error|warn|info, code, message, fix, role?, account?}
    """
    settings = settings or {}
    by_code, children = _index(accounts)
    issues = []

    def add(sev, code, msg, fix="", **kw):
        issues.append(dict(severity=sev, code=code, message=msg, fix=fix, **kw))

    # --- الأدوار الافتراضية
    used = defaultdict(list)
    for role in ROLES:
        code, source = resolve_role_code(role, settings)
        acc = by_code.get(code)
        if acc is None:
            add("error", "role_missing",
                f"«{role['label']}»: الحساب {code} غير موجود بدليل الحسابات — سيفشل أي ترحيل يعتمد عليه.",
                "اختر حساباً صالحاً من الإعدادات أو استخدم «اقتراح ذكي».", role=role["key"])
            continue
        used[code].append(role["key"])
        if not acc.get("is_active", True):
            add("error", "role_inactive", f"«{role['label']}»: الحساب {code} ({acc['name_ar']}) موقوف.",
                "فعّله أو اختر حساباً آخر.", role=role["key"], account=code)
        if acc.get("account_type") != role["type"]:
            add("error", "role_type",
                f"«{role['label']}»: الحساب {code} من نوع «{TYPE_LABELS.get(acc.get('account_type'), acc.get('account_type'))}» "
                f"والمتوقع «{TYPE_LABELS[role['type']]}».", "اختر حساباً من النوع الصحيح.",
                role=role["key"], account=code)
        if _active_children(code, by_code, children) and role["key"] not in ("payable",):
            add("warn", "role_parent",
                f"«{role['label']}»: الحساب {code} رئيسي وله فروع؛ الأفضل الترحيل على حساب فرعي نهائي.",
                "اختر أحد الحسابات الفرعية.", role=role["key"], account=code)
        if source == "default":
            add("info", "role_default",
                f"«{role['label']}» يستخدم الكود التقليدي {code} (لم يُحدَّد صراحةً).",
                "ثبّته صراحةً من الإعدادات لتأمينه ضد تغيّر الدليل.", role=role["key"], account=code)
    for code, keys in used.items():
        if len(keys) > 1:
            labels = "، ".join(ROLE_BY_KEY[k]["label"] for k in keys)
            add("warn", "role_shared", f"الحساب {code} مستخدم لأكثر من دور: {labels}.",
                "افصل الأدوار على حسابات مستقلة ليصبح التحليل المالي أدق.", account=code)

    # --- سلامة الشجرة
    for a in accounts:
        code, p = str(a["code"]), a.get("parent_code")
        if p and str(p) not in by_code:
            add("error", "orphan", f"الحساب {code} ({a['name_ar']}) أبوه {p} غير موجود.",
                "صحّح الحساب الرئيسي.", account=code)
        elif p:
            pa = by_code[str(p)]
            if pa.get("account_type") != a.get("account_type"):
                add("warn", "type_mismatch_parent",
                    f"الحساب {code} نوعه يختلف عن نوع أبيه {p}.", "وحّد النوع مع الحساب الرئيسي.", account=code)
            if not pa.get("is_active", True) and a.get("is_active", True):
                add("warn", "inactive_parent", f"الحساب {code} نشط لكن أبوه {p} موقوف.",
                    "فعّل الأب أو أوقف الفرع.", account=code)
    # دورات (حلقات) في الشجرة
    for a in accounts:
        seen, cur = set(), str(a["code"])
        while cur in by_code and by_code[cur].get("parent_code"):
            if cur in seen:
                add("error", "cycle", f"حلقة مغلقة في هرمية الحسابات عند {cur}.", "اكسر الحلقة.", account=cur)
                break
            seen.add(cur)
            cur = str(by_code[cur]["parent_code"])
    # أسماء مكررة
    names = defaultdict(list)
    for a in accounts:
        if a.get("is_active", True):
            names[norm(a.get("name_ar"))].append(str(a["code"]))
    for n, codes in names.items():
        if n and len(codes) > 1:
            add("warn", "dup_name", f"اسم مكرر بين الحسابات: {', '.join(codes)}.", "ادمجها أو ميّز أسماءها.")
    # طبيعة الحساب
    for a in accounts:
        exp = NATURE_BY_TYPE.get(a.get("account_type"))
        nature = a.get("nature")
        contra = any(kw_in(a.get("name_ar"), w) for w in ("مجمع", "مردود", "مسموحات", "مسحوبات", "خصم"))
        if exp and nature and nature != exp and not contra:
            add("warn", "nature", f"طبيعة الحساب {a['code']} ({a['name_ar']}) «{nature}» والمعتاد «{exp}».",
                "راجع طبيعة الحساب.", account=str(a["code"]))

    errors = sum(1 for i in issues if i["severity"] == "error")
    warns = sum(1 for i in issues if i["severity"] == "warn")
    score = max(0, 100 - 18 * errors - 4 * warns)
    grade = "ممتاز" if score >= 90 else "جيد" if score >= 70 else "يحتاج مراجعة" if score >= 40 else "حرج"
    order = {"error": 0, "warn": 1, "info": 2}
    issues.sort(key=lambda i: order[i["severity"]])
    return dict(score=score, grade=grade, issues=issues,
                stats=dict(accounts=len(accounts), errors=errors, warnings=warns,
                           infos=len(issues) - errors - warns,
                           active=sum(1 for a in accounts if a.get("is_active", True))))


# ======================================================================
# 6) أنواع الحسابات بين الأنظمة
# ======================================================================
def classify_type(name_ar="", name_en="", code="", hint=None):
    """تصنيف نوع الحساب من الاسم/الكود. يعيد (type|None, basis) حيث basis: hint|name|code."""
    if hint in ACCOUNT_TYPES:
        return hint, "hint"
    full = f"{name_ar} {name_en}"
    rules = [
        ("expenses", ["مصروف", "مصاريف", "تكلفه", "اهلاك", "رواتب", "ايجار", "expense", "cost of", "depreciation", "salar", "rent"]),
        ("revenue", ["ايراد", "مبيعات", "دخل", "revenue", "income", "sales"]),
        ("equity", ["راس المال", "حقوق", "ارباح مرحله", "احتياطي", "equity", "capital", "retained", "reserve"]),
        ("liabilities", ["موردون", "دائن", "قروض", "مستحق", "ضريبه مستحقه", "payable", "loan", "accrued", "liabilit"]),
        ("assets", ["نقد", "صندوق", "بنك", "عملاء", "مخزون", "اصول", "مدين", "ثابت", "cash", "bank", "receivable", "inventory", "asset"]),
    ]
    for t, words in rules:
        if any(kw_in(full, w) for w in words):
            return t, "name"
    c = re.sub(r"\D", "", str(code or "")).lstrip("0")
    if c:
        d = c[0]
        t = {"1": "assets", "2": "liabilities", "3": "equity", "4": "revenue"}.get(d)
        if t:
            return t, "code"
        if d in "56789":
            return "expenses", "code"
    return None, ""


# --- Odoo
def odoo_type(acc):
    t, n = acc.get("account_type"), f"{acc.get('name_ar')} {acc.get('name_en')}"
    has = lambda *ws: any(kw_in(n, w) for w in ws)
    if t == "assets":
        if has("عملاء", "ذمم مدينه", "receivable", "customers"):
            return "asset_receivable"
        if has("صندوق", "بنك", "نقد", "cash", "bank"):
            return "asset_cash"
        if has("مقدم", "prepaid", "advance"):
            return "asset_prepayments"
        if has("ثابت", "اراضي", "مباني", "معدات", "سيارات", "اثاث", "fixed", "vehicle", "equipment", "land", "building", "furniture"):
            return "asset_fixed"
        return "asset_current"
    if t == "liabilities":
        if has("موردون", "payable", "vendors", "suppliers") and not has("اوراق", "notes"):
            return "liability_payable"
        if has("طويله", "قروض", "long term", "loan"):
            return "liability_non_current"
        return "liability_current"
    if t == "equity":
        return "equity"
    if t == "revenue":
        return "income_other" if has("اخري", "other") else "income"
    if t == "expenses":
        if has("تكلفه البضاعه", "cost of goods", "cogs"):
            return "expense_direct_cost"
        if has("اهلاك", "depreciation"):
            return "expense_depreciation"
        return "expense"
    return "asset_current"


ODOO_TO_TYPE = {"asset": "assets", "liability": "liabilities", "equity": "equity",
                "income": "revenue", "expense": "expenses"}
ORACLE_TYPES = {"assets": "Asset", "liabilities": "Liability", "equity": "Owners' Equity",
                "revenue": "Revenue", "expenses": "Expense"}
SAP_GROUPS = {"assets": "ASSET", "liabilities": "LIABL", "equity": "EQUTY", "revenue": "REVEN", "expenses": "EXPNS"}


def _sap_code(code, pad, width=10):
    c = str(code)
    if not c.isdigit() or pad == "none":
        return c
    return c.zfill(width) if pad == "left" else c.ljust(width, "0")


# ======================================================================
# 7) التصدير
# ======================================================================
def _csv(rows, headers):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(headers)
    w.writerows(rows)
    return buf.getvalue()


def export_chart(accounts, fmt="generic", sap_pad="left", sap_chart="INT", oracle_value_set="NATURAL_ACCOUNT",
                 include_inactive=False):
    """يعيد dict: filename, content (CSV)، count، headers، notes[]"""
    fmt = fmt if fmt in PROFILES else "generic"
    accs = [a for a in accounts if include_inactive or a.get("is_active", True)]
    accs.sort(key=lambda a: str(a["code"]))
    _, children = _index(accs)
    notes = []
    if fmt == "odoo":
        headers = ["code", "name", "account_type", "reconcile", "deprecated"]
        rows = []
        for a in accs:
            ot = odoo_type(a)
            rows.append([a["code"], a.get("name_ar") or a.get("name_en"), ot,
                         "TRUE" if ot in ("asset_receivable", "liability_payable", "asset_cash") else "FALSE",
                         "FALSE" if a.get("is_active", True) else "TRUE"])
        notes += ["أنواع Odoo بصيغة الإصدارات 16/17+ (account_type).",
                  "Odoo لا يستورد هرمية الأب/الابن في account.account؛ التجميع يتم بمجموعات الحسابات (account.group) حسب بادئة الكود.",
                  "في الإصدارات الأقدم (≤ 13) يُستبدل account_type بـ user_type_id."]
    elif fmt == "sap":
        headers = ["ChartOfAccounts", "GLAccount", "AccountGroup", "BalanceSheetAccount", "PLAccountType",
                   "ShortText", "LongText", "ParentGLAccount", "PostingAllowed"]
        rows = []
        for a in accs:
            t = a.get("account_type")
            bs = "X" if t in ("assets", "liabilities", "equity") else ""
            name = a.get("name_en") or a.get("name_ar") or ""
            rows.append([sap_chart, _sap_code(a["code"], sap_pad), SAP_GROUPS.get(t, ""), bs,
                         "" if bs else "X", (a.get("name_ar") or name)[:20], (a.get("name_ar") or name)[:50],
                         _sap_code(a["parent_code"], sap_pad) if a.get("parent_code") else "",
                         "N" if children.get(str(a["code"])) else "Y"])
        if any(not str(a["code"]).isdigit() for a in accs):
            notes.append("بعض الأكواد غير رقمية؛ أرقام حسابات SAP تحتاج غالباً أرقاماً فقط — راجعها قبل الاستيراد.")
        notes += [f"مجموعات الحسابات ({', '.join(SAP_GROUPS.values())}) رموز مقترحة؛ استبدلها بمجموعات شركتك.",
                  "الاسم القصير 20 حرفاً والطويل 50 حرفاً (حدود SAP).",
                  "SAP لا يحمل هرمية في الحساب نفسه (تُبنى بشجرة Financial Statement Version)؛ عمود ParentGLAccount للمرجعية."]
    elif fmt == "oracle":
        headers = ["ValueSetCode", "Value", "Description", "SummaryFlag", "Enabled", "AccountType",
                   "AllowPosting", "ParentValue"]
        rows = []
        for a in accs:
            is_parent = bool(children.get(str(a["code"])))
            rows.append([oracle_value_set, a["code"], a.get("name_ar") or a.get("name_en"),
                         "Y" if is_parent else "N", "Y" if a.get("is_active", True) else "N",
                         ORACLE_TYPES.get(a.get("account_type"), ""), "N" if is_parent else "Y",
                         a.get("parent_code") or ""])
        notes += ["مصمم لشريحة Natural Account في Oracle Fusion/EBS (Segment Values + Hierarchy).",
                  "اسم الـ Value Set وأسماء الأعمدة تختلف بين الإصدارات؛ طابقها مع قالب الاستيراد لديك."]
    else:
        headers = ["code", "name_ar", "name_en", "account_type", "nature", "parent_code", "opening_balance", "is_active"]
        rows = [[a["code"], a.get("name_ar"), a.get("name_en") or "", a.get("account_type"), a.get("nature") or "",
                 a.get("parent_code") or "", a.get("opening_balance") or 0, "1" if a.get("is_active", True) else "0"]
                for a in accs]
        notes.append("الصيغة العامة للنظام — تُقرأ عند الاستيراد دون أي تحويل.")
    return dict(format=fmt, filename=f"chart_of_accounts_{fmt}.csv", content=_csv(rows, headers),
                count=len(rows), headers=headers, notes=notes)


# ======================================================================
# 8) الاستيراد: اكتشاف الصيغة + التحويل + التحقق
# ======================================================================
_ALIASES = {
    "code": {"code", "glaccount", "saknr", "value", "accountnumber", "accountcode", "accountno", "رقمالحساب", "الكود", "كود"},
    "name": {"name", "accountname", "longtext", "txt50", "description", "اسمالحساب", "الاسم", "name_ar", "namear"},
    "name_en": {"name_en", "nameen", "englishname", "اسمانجليزي"},
    "short": {"shorttext", "txt20"},
    "type": {"accounttype", "type", "accounttype", "نوعالحساب", "النوع", "usertypeid"},
    "parent": {"parent", "parentcode", "parentvalue", "parentglaccount", "parentaccount", "parent_code", "الحسابالرئيسي", "الاب"},
    "nature": {"nature", "طبيعةالحساب", "الطبيعة"},
    "opening": {"openingbalance", "opening_balance", "الرصيدالافتتاحي"},
    "active": {"isactive", "is_active", "enabled", "active", "نشط"},
    "deprecated": {"deprecated"},
    "bs": {"balancesheetaccount", "xbilk", "bsaccount"},
    "group": {"accountgroup", "ktoks"},
    "summary": {"summaryflag"},
}


def _hkey(h):
    return re.sub(r"[^0-9a-z\u0600-\u06FF]", "", str(h or "").strip().lower())


def _norm_headers(headers):
    mapping = {}
    for idx, h in enumerate(headers):
        k = _hkey(h)
        for field, al in _ALIASES.items():
            if k in {_hkey(x) for x in al} and field not in mapping:
                mapping[field] = idx
                break
    return mapping


def detect_format(headers):
    keys = {_hkey(h) for h in headers}
    if {"valuesetcode"} & keys or ("value" in keys and "accounttype" in keys and "summaryflag" in keys):
        return "oracle"
    if {"glaccount", "saknr", "chartofaccounts", "balancesheetaccount", "accountgroup"} & keys:
        return "sap"
    if "accounttype" in keys and "code" in keys and "name" in keys and "nature" not in keys and "namear" not in keys:
        return "odoo"
    return "generic"


def _parse_type(raw, fmt):
    s = norm(raw).replace(" ", "_")
    if not s:
        return None
    if s in ACCOUNT_TYPES:
        return s
    for pre, t in ODOO_TO_TYPE.items():           # asset_receivable, liability_payable, income_other...
        if s.startswith(pre):
            return t
    table = {"owners_equity": "equity", "owner_s_equity": "equity", "owners_equity_": "equity",
             "اصول": "assets", "اصل": "assets", "خصوم": "liabilities", "التزامات": "liabilities",
             "حقوق_ملكيه": "equity", "حقوق_الملكيه": "equity", "ايرادات": "revenue", "ايراد": "revenue",
             "مصروفات": "expenses", "مصروف": "expenses", "مصاريف": "expenses", "off_balance": None}
    return table.get(s)


def _truthy(v, default=True):
    s = str(v).strip().lower()
    if s == "":
        return default
    return s in ("1", "true", "y", "yes", "x", "نعم", "نشط")


def parse_import(text, existing_codes=(), fmt=None, existing_accounts=None):
    """
    يقرأ نص CSV ويعيد {format, rows[], summary}.
    كل صف: line, code, name_ar, name_en, account_type, nature, parent_code, is_active,
           status (new|exists|error), type_source, warnings[], errors[]
    لا يكتب شيئاً؛ الكتابة مسؤولية الراوتر بعد موافقة المستخدم.
    """
    text = (text or "").lstrip("\ufeff")
    if not text.strip():
        return dict(format="generic", rows=[], summary=dict(total=0, new=0, exists=0, errors=0, inferred=0),
                    fatal="الملف فارغ")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = list(csv.reader(io.StringIO(text), dialect))
    reader = [r for r in reader if any(c.strip() for c in r)]
    if len(reader) < 2:
        return dict(format="generic", rows=[], summary=dict(total=0, new=0, exists=0, errors=0, inferred=0),
                    fatal="الملف يجب أن يحتوي صف عناوين وصفاً واحداً على الأقل")
    headers = reader[0]
    detected = detect_format(headers)
    fmt = fmt if fmt in PROFILES else detected
    m = _norm_headers(headers)
    if "code" not in m or not ({"name", "short"} & set(m)):
        return dict(format=fmt, rows=[], summary=dict(total=0, new=0, exists=0, errors=0, inferred=0),
                    fatal="لم أجد عمودي «الكود» و«الاسم» في عناوين الملف.")
    existing = {str(c) for c in existing_codes}
    cell = lambda r, f: (r[m[f]].strip() if f in m and m[f] < len(r) else "")

    rows, seen = [], {}
    raw_rows = []
    for ln, r in enumerate(reader[1:], start=2):
        code = cell(r, "code")
        if fmt == "sap" and code.isdigit() and len(code) >= 8 and code.startswith("0"):
            code = code.lstrip("0") or "0"
        raw_rows.append((ln, r, code))
    batch_codes = {c for _, _, c in raw_rows if c}

    for ln, r, code in raw_rows:
        errs, warns = [], []
        name = cell(r, "name") or cell(r, "short")
        name_en = cell(r, "name_en")
        if not code:
            errs.append("الكود فارغ")
        if len(code) > 20:
            errs.append("الكود أطول من 20 خانة")
        if not name:
            errs.append("الاسم فارغ")
        if code in seen:
            errs.append(f"الكود مكرر داخل الملف (السطر {seen[code]})")
        elif code:
            seen[code] = ln
        # النوع
        t = _parse_type(cell(r, "type"), fmt)
        tsrc = "file" if t else ""
        if not t and fmt == "sap" and cell(r, "group"):
            t = _parse_type(cell(r, "group"), fmt)
            tsrc = "file" if t else ""
        if not t:
            t, basis = classify_type(name, name_en, code)
            tsrc = "ai_" + basis if t else ""
            if t:
                warns.append(f"النوع غير مذكور؛ صنّفه المساعد «{TYPE_LABELS[t]}» اعتماداً على "
                             f"{'الاسم' if basis == 'name' else 'الرقم'} — راجعه.")
            else:
                errs.append("تعذّر تحديد نوع الحساب")
        nature = cell(r, "nature")
        nature = nature if nature in ("مدين", "دائن") else (NATURE_BY_TYPE.get(t) or "مدين")
        # الاسم عربي/إنجليزي
        if has_arabic(name):
            name_ar = name
        else:
            name_ar, name_en = name, (name_en or name)
        # الأب
        parent = cell(r, "parent")
        if fmt == "sap" and parent.isdigit() and len(parent) >= 8 and parent.startswith("0"):
            parent = parent.lstrip("0")
        if parent and parent == code:
            errs.append("الحساب أب لنفسه")
            parent = ""
        pool = (existing | batch_codes)
        if parent and parent not in pool:
            warns.append(f"الحساب الرئيسي {parent} غير موجود — سيُنشأ بدون أب.")
            parent = ""
        inferred_parent = False
        if not parent and not cell(r, "parent") and code:
            cands = [c for c in pool if c != code and code.startswith(c)]
            if cands:
                parent = max(cands, key=len)
                inferred_parent = True
        active = _truthy(cell(r, "active"), True)
        if "deprecated" in m and _truthy(cell(r, "deprecated"), False):
            active = False
        try:
            opening = float(cell(r, "opening") or 0)
        except ValueError:
            opening = 0.0
            warns.append("الرصيد الافتتاحي غير رقمي فتم تجاهله")
        status = "error" if errs else ("exists" if code in existing else "new")
        rows.append(dict(line=ln, code=code, name_ar=name_ar, name_en=name_en or None, account_type=t,
                         nature=nature, parent_code=parent or None, parent_inferred=inferred_parent,
                         is_active=active, opening_balance=opening, status=status, type_source=tsrc,
                         warnings=warns, errors=errs))
    summary = dict(total=len(rows),
                   new=sum(1 for r in rows if r["status"] == "new"),
                   exists=sum(1 for r in rows if r["status"] == "exists"),
                   errors=sum(1 for r in rows if r["status"] == "error"),
                   inferred=sum(1 for r in rows if r["type_source"].startswith("ai_")))
    return dict(format=fmt, detected=detected, rows=rows, summary=summary, fatal=None)


def order_for_insert(rows, existing_codes=()):
    """
    يرتب الصفوف الجديدة بحيث يُنشأ الأب قبل أبنائه، ويُفرغ parent_code إن كان الأب
    غير موجود لا بالقاعدة ولا ضمن الصفوف المراد إنشاؤها (مثلاً أبوه تُخطّي) — حمايةً من خطأ FK.
    """
    existing = {str(c) for c in existing_codes}
    new = [r for r in rows if r["status"] == "new"]
    codes = {r["code"] for r in new}
    for r in new:
        p = r.get("parent_code")
        if p and p not in codes and p not in existing:
            r["parent_code"] = None
    done, ordered, guard = set(), [], 0
    pending = list(new)
    while pending and guard < len(new) + 5:
        guard += 1
        nxt = []
        for r in pending:
            p = r.get("parent_code")
            if not p or p in existing or p in done:
                ordered.append(r)
                done.add(r["code"])
            else:
                nxt.append(r)
        pending = nxt
    for r in pending:                      # حلقات: تُنشأ بدون أب حمايةً
        r["parent_code"] = None
        ordered.append(r)
    return ordered
