"""إعدادات الحسابات (PF-01.11): الحسابات الافتراضية + مساعد ذكي + توافق Odoo/SAP/Oracle."""
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import account_settings_engine as eng
from app.account_defaults import load_role_settings
from app.database import get_db
from app.models.models import Account, AccountSetting

router = APIRouter(prefix="/api/account-settings", tags=["Account Settings"])

MAX_IMPORT_CHARS = 2_000_000


# ------------------------------------------------------------------ مساعدات
def _accounts(db: Session) -> list:
    return [dict(code=a.code, name_ar=a.name_ar, name_en=a.name_en, account_type=a.account_type,
                 nature=a.nature, parent_code=a.parent_code, is_active=bool(a.is_active),
                 is_system=bool(a.is_system), opening_balance=float(a.opening_balance or 0))
            for a in db.query(Account).all()]


def _profile(db: Session) -> str:
    row = db.query(AccountSetting).filter(AccountSetting.key == "erp_profile").first()
    v = (row.value if row is not None else "") or "generic"
    return v if v in eng.PROFILES else "generic"


def _state(db: Session) -> dict:
    accounts = _accounts(db)
    by_code = {a["code"]: a for a in accounts}
    settings = load_role_settings(db)
    audit = eng.audit_chart(accounts, settings)
    roles = []
    for r in eng.ROLES:
        code, source = eng.resolve_role_code(r, settings)
        acc = by_code.get(code)
        role_issues = [i for i in audit["issues"] if i.get("role") == r["key"]]
        sev = "error" if any(i["severity"] == "error" for i in role_issues) else \
              "warn" if any(i["severity"] == "warn" for i in role_issues) else "ok"
        roles.append(dict(
            key=r["key"], label=r["label"], type=r["type"], type_label=eng.TYPE_LABELS[r["type"]],
            used_by=r["used_by"], legacy=r["legacy"], code=code, source=source, status=sev,
            account=(dict(code=acc["code"], name=acc["name_ar"], type=acc["account_type"],
                          is_active=acc["is_active"]) if acc else None),
            messages=[i["message"] for i in role_issues if i["code"] != "role_default"]))
    options = [dict(code=a["code"], name=a["name_ar"], type=a["account_type"], is_active=a["is_active"])
               for a in sorted(accounts, key=lambda a: a["code"])]
    return dict(roles=roles, profile=_profile(db), score=audit["score"], grade=audit["grade"],
                stats=audit["stats"], issues=audit["issues"], options=options)


# ------------------------------------------------------------------ الحسابات الافتراضية
class SettingsIn(BaseModel):
    defaults: Dict[str, Optional[str]] = {}
    erp_profile: Optional[str] = None


@router.get("")
def get_settings(db: Session = Depends(get_db)):
    return _state(db)


@router.put("")
def save_settings(payload: SettingsIn, db: Session = Depends(get_db)):
    by_code = {a["code"]: a for a in _accounts(db)}
    problems = []
    for key, code in payload.defaults.items():
        role = eng.ROLE_BY_KEY.get(key)
        if role is None:
            problems.append(f"دور غير معروف: {key}")
            continue
        code = (code or "").strip()
        if not code:
            continue                                  # إرجاع للكود التقليدي
        acc = by_code.get(code)
        if acc is None:
            problems.append(f"«{role['label']}»: الحساب {code} غير موجود.")
        elif not acc["is_active"]:
            problems.append(f"«{role['label']}»: الحساب {code} موقوف.")
        elif acc["account_type"] != role["type"]:
            problems.append(f"«{role['label']}»: الحساب {code} من نوع «{eng.TYPE_LABELS.get(acc['account_type'], acc['account_type'])}» "
                            f"والمطلوب «{eng.TYPE_LABELS[role['type']]}».")
    if payload.erp_profile is not None and payload.erp_profile not in eng.PROFILES:
        problems.append("نمط ERP غير معروف.")
    if problems:
        raise HTTPException(status_code=400, detail=" | ".join(problems))

    def upsert(k, v):
        row = db.query(AccountSetting).filter(AccountSetting.key == k).first()
        if v:
            if row is None:
                db.add(AccountSetting(key=k, value=v))
            else:
                row.value = v
        elif row is not None:
            db.delete(row)

    for key, code in payload.defaults.items():
        upsert(eng.SETTING_PREFIX + key, (code or "").strip())
    if payload.erp_profile is not None:
        upsert("erp_profile", payload.erp_profile if payload.erp_profile != "generic" else "")
    db.commit()
    return _state(db)


# ------------------------------------------------------------------ المساعد الذكي
@router.get("/suggest")
def suggest(db: Session = Depends(get_db)):
    accounts = _accounts(db)
    sugg = eng.suggest_roles(accounts)
    settings = load_role_settings(db)
    out = []
    for r in eng.ROLES:
        cur, _ = eng.resolve_role_code(r, settings)
        cands = sugg[r["key"]]
        best = cands[0] if cands else None
        out.append(dict(role=r["key"], label=r["label"], current=cur, candidates=cands,
                        differs=bool(best and best["code"] != cur)))
    return dict(suggestions=out, engine="local-rules")


@router.get("/audit")
def audit(db: Session = Depends(get_db)):
    return eng.audit_chart(_accounts(db), load_role_settings(db))


# ------------------------------------------------------------------ تصدير / استيراد
@router.get("/export")
def export(format: str = "generic", sap_pad: str = "left", include_inactive: bool = False,
           db: Session = Depends(get_db)):
    if format not in eng.PROFILES:
        raise HTTPException(400, "صيغة غير معروفة.")
    if sap_pad not in ("left", "right", "none"):
        raise HTTPException(400, "قيمة sap_pad غير صالحة.")
    return eng.export_chart(_accounts(db), format, sap_pad=sap_pad, include_inactive=include_inactive)


class ImportIn(BaseModel):
    text: str
    format: Optional[str] = None
    confirm: bool = False
    accept_inferred: bool = False


def _parse(payload: ImportIn, db: Session):
    if len(payload.text or "") > MAX_IMPORT_CHARS:
        raise HTTPException(413, "الملف كبير جداً (الحد 2 ميجابايت).")
    existing = [a.code for a in db.query(Account.code).all()]
    parsed = eng.parse_import(payload.text, existing_codes=existing, fmt=payload.format)
    if parsed.get("fatal"):
        raise HTTPException(400, parsed["fatal"])
    return parsed


@router.post("/import/preview")
def import_preview(payload: ImportIn, db: Session = Depends(get_db)):
    return _parse(payload, db)


@router.post("/import/commit")
def import_commit(payload: ImportIn, db: Session = Depends(get_db)):
    if not payload.confirm:
        raise HTTPException(400, "يلزم تأكيد الاستيراد صراحةً.")
    parsed = _parse(payload, db)
    rows = parsed["rows"]
    skipped_inferred = []
    if not payload.accept_inferred:
        for r in rows:
            if r["status"] == "new" and r["type_source"].startswith("ai_"):
                r["status"] = "skipped"
                skipped_inferred.append(r["code"])
    todo = eng.order_for_insert(rows, existing_codes=[a.code for a in db.query(Account.code).all()])
    for r in todo:
        db.add(Account(code=r["code"], name_ar=r["name_ar"], name_en=r["name_en"],
                       account_type=r["account_type"], nature=r["nature"], parent_code=r["parent_code"],
                       opening_balance=0, is_active=r["is_active"], is_system=False))
        db.flush()            # يضمن وجود الأب قبل الابن (FK)
    db.commit()
    s = parsed["summary"]
    return dict(created=len(todo), exists=s["exists"], errors=s["errors"],
                skipped_inferred=skipped_inferred,
                note="الأرصدة الافتتاحية في الملف لا تُستورد (تُدخل بقيد افتتاحي)")
