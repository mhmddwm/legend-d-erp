from fastapi import APIRouter
from app.core.localization.engine import SUPPORTED_LANGUAGES, localization_engine

router = APIRouter(prefix="/api/localization", tags=["Localization"])

@router.get("/languages")
def languages():
    return {
        "default": "ar",
        "supported": [
            {"code": "ar", "name": "العربية", "dir": "rtl"},
            {"code": "en", "name": "English", "dir": "ltr"},
        ],
    }

@router.get("/label/{key}")
def label(key: str, lang: str = "ar"):
    return {"key": key, "lang": lang, "value": localization_engine.translate(key, lang)}
