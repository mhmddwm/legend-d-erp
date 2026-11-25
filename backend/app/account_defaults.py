"""قراءة الحسابات الافتراضية من «إعدادات الحسابات» مع الرجوع للكود التقليدي عند غياب الإعداد."""
from app.account_settings_engine import ROLE_BY_KEY, SETTING_PREFIX


def get_default_account(db, role: str, legacy: str | None = None) -> str:
    """
    يعيد كود الحساب المضبوط للدور `role`، وإلا `legacy` (إن مُرِّر) وإلا الكود التقليدي للدور.
    آمن: إن لم يوجد جدول account_settings بعد (الهجرة 038 لم تُطبَّق) يعيد الكود التقليدي
    دون إفساد معاملة قاعدة البيانات (savepoint).
    """
    fallback = legacy or ROLE_BY_KEY[role]["legacy"]
    try:
        from app.models.models import AccountSetting
        with db.begin_nested():
            row = db.query(AccountSetting).filter(AccountSetting.key == SETTING_PREFIX + role).first()
        value = (row.value or "").strip() if row is not None else ""
        return value or fallback
    except Exception:
        return fallback


def load_role_settings(db) -> dict:
    """{role_key: code} للأدوار المضبوطة صراحةً فقط."""
    try:
        from app.models.models import AccountSetting
        with db.begin_nested():
            rows = db.query(AccountSetting).all()
    except Exception:
        return {}
    out = {}
    for r in rows:
        if r.key.startswith(SETTING_PREFIX) and (r.value or "").strip():
            out[r.key[len(SETTING_PREFIX):]] = r.value.strip()
    return out
