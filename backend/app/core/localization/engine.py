"""LEGEND D Localization Engine skeleton.

This layer is intentionally framework-agnostic so every module can store and read
multilingual labels consistently. It supports the AI-ready data model where
business names can be stored as {"ar": "...", "en": "..."} instead of one
language-only string.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

SUPPORTED_LANGUAGES = ("ar", "en")
DEFAULT_LANGUAGE = "ar"


@dataclass(frozen=True)
class LocalizedText:
    ar: str = ""
    en: str = ""

    def get(self, language: str = DEFAULT_LANGUAGE) -> str:
        lang = language if language in SUPPORTED_LANGUAGES else DEFAULT_LANGUAGE
        return getattr(self, lang) or self.ar or self.en or ""


class LocalizationEngine:
    """Central helper for UI labels and business-data names."""

    def __init__(self, default_language: str = DEFAULT_LANGUAGE):
        self.default_language = default_language if default_language in SUPPORTED_LANGUAGES else DEFAULT_LANGUAGE
        self._labels: dict[str, LocalizedText] = {}

    def register(self, key: str, ar: str, en: str) -> None:
        self._labels[key] = LocalizedText(ar=ar, en=en)

    def translate(self, key: str, language: str | None = None) -> str:
        lang = language or self.default_language
        text = self._labels.get(key)
        return text.get(lang) if text else key

    def localized_value(self, value: Any, language: str | None = None) -> str:
        """Read a value that may be plain text or {ar,en}."""
        lang = language or self.default_language
        if isinstance(value, LocalizedText):
            return value.get(lang)
        if isinstance(value, Mapping):
            return str(value.get(lang) or value.get("ar") or value.get("en") or "")
        return "" if value is None else str(value)


localization_engine = LocalizationEngine()
localization_engine.register("purchase.invoice", "فاتورة مشتريات", "Purchase Invoice")
localization_engine.register("purchase.request", "طلب شراء", "Purchase Request")
localization_engine.register("supplier", "المورد", "Supplier")
localization_engine.register("product", "المنتج", "Product")
