# -*- coding: utf-8 -*-
"""
كتالوج الصلاحيات المركزي — LEGEND D ERP
=========================================
هذا الملف هو "المصدر الوحيد للحقيقة" لقائمة الوحدات (Modules) والإجراءات
(Actions) المستخدمة في نظام الأدوار والصلاحيات. أي راوتر جديد يريد حماية
مساراته يستورد `require_permission(module, action)` من app.core.security،
وأي وحدة جديدة تُضاف للنظام تُضاف هنا فقط فتظهر تلقائياً في مصفوفة
الصلاحيات بشاشة "الأدوار والصلاحيات" بالواجهة (عبر GET /api/permissions/catalog).

هذا يطابق أسماء المجموعات (data-group) المستخدمة فعلياً بالقائمة الجانبية
والقائمة الأفقية بالواجهة الأمامية (index.html) حتى تبقى الصلاحيات متوافقة
تماماً مع شاشات النظام الحالية.
"""

from typing import Dict, List

# (key, name_ar, name_en) — key يطابق data-group بالواجهة قدر الإمكان
MODULES: List[Dict[str, str]] = [
    {"key": "dashboard", "name_ar": "لوحة التحكم", "name_en": "Dashboard"},
    {"key": "accounts", "name_ar": "الحسابات والقيود", "name_en": "Accounting"},
    {"key": "purchasing", "name_ar": "المشتريات", "name_en": "Purchasing"},
    {"key": "sales", "name_ar": "المبيعات", "name_en": "Sales"},
    {"key": "pos", "name_ar": "نقاط البيع", "name_en": "Point of Sale"},
    {"key": "customers", "name_ar": "العملاء", "name_en": "Customers"},
    {"key": "finance", "name_ar": "المالية والخزينة", "name_en": "Finance"},
    {"key": "assets", "name_ar": "الأصول الثابتة", "name_en": "Assets"},
    {"key": "inventory", "name_ar": "المخزون والمستودعات", "name_en": "Inventory"},
    {"key": "reports", "name_ar": "التقارير", "name_en": "Reports"},
    {"key": "print_templates", "name_ar": "قوالب الطباعة", "name_en": "Print Templates"},
    {"key": "general_settings", "name_ar": "الإعدادات العامة", "name_en": "General Settings"},
    {"key": "users_permissions", "name_ar": "المستخدمون والصلاحيات", "name_en": "Users & Permissions"},
]

# (key, name_ar, name_en)
ACTIONS: List[Dict[str, str]] = [
    {"key": "view", "name_ar": "عرض", "name_en": "View"},
    {"key": "create", "name_ar": "إضافة", "name_en": "Create"},
    {"key": "edit", "name_ar": "تعديل", "name_en": "Edit"},
    {"key": "delete", "name_ar": "حذف", "name_en": "Delete"},
    {"key": "export", "name_ar": "تصدير", "name_en": "Export"},
    {"key": "approve", "name_ar": "اعتماد", "name_en": "Approve"},
]

MODULE_KEYS = [m["key"] for m in MODULES]
ACTION_KEYS = [a["key"] for a in ACTIONS]


def full_access() -> Dict[str, List[str]]:
    """صلاحيات كاملة على كل الوحدات — تُستخدم لدور (مدير النظام)."""
    return {m: list(ACTION_KEYS) for m in MODULE_KEYS}


def view_only() -> Dict[str, List[str]]:
    """عرض فقط على كل الوحدات — تُستخدم لدور (مطّلع)."""
    return {m: ["view"] for m in MODULE_KEYS}


def normalize_permissions(raw: Dict) -> Dict[str, List[str]]:
    """
    ينظّف كائن الصلاحيات القادم من الواجهة أو قاعدة البيانات:
    يتجاهل أي وحدة/إجراء غير معروف، ويعيد بنية مضمونة ومتوافقة مع الكتالوج
    الحالي حتى لو تغيّر الكتالوج لاحقاً (إضافة/حذف وحدات).
    """
    raw = raw or {}
    cleaned: Dict[str, List[str]] = {}
    for module_key in MODULE_KEYS:
        actions = raw.get(module_key) or []
        cleaned[module_key] = [a for a in ACTION_KEYS if a in actions]
    return cleaned


def has_permission(permissions: Dict, module: str, action: str) -> bool:
    if not permissions:
        return False
    return action in (permissions.get(module) or [])
