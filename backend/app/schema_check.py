# -*- coding: utf-8 -*-
"""
فحص بنية قاعدة البيانات عند تشغيل الخادم (قراءة فقط — لا يغيّر أي شيء).

لماذا؟ المشروع لا يستخدم create_all، فبنية القاعدة تأتي من الهجرات فقط. إذا نُشر
كود جديد (موديل فيه عمود جديد مثل items.unit_template) قبل تطبيق هجرته، يفشل
GET /api/items بخطأ 500 فتظهر شاشة المنتجات فارغة دون أي سبب ظاهر.
هذا الفحص يكتب في سجل الخادم قائمة الجداول/الأعمدة الناقصة بوضوح.
"""
import logging

from sqlalchemy import inspect

log = logging.getLogger("schema_check")


def find_schema_gaps(engine, metadata):
    """يعيد قائمة نصوص: جداول أو أعمدة معرَّفة في الموديلات وغير موجودة بالقاعدة."""
    insp = inspect(engine)
    existing = set(insp.get_table_names())
    gaps = []
    for table in metadata.sorted_tables:
        if table.name not in existing:
            gaps.append(f"جدول ناقص: {table.name}")
            continue
        have = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name not in have:
                gaps.append(f"عمود ناقص: {table.name}.{col.name}")
    return gaps


def run_startup_check():
    """يُستدعى عند التشغيل؛ لا يرفع استثناءً أبداً حتى لا يمنع تشغيل الخادم."""
    try:
        from app.database import engine, Base, IS_SQLITE
        import app.models.models  # noqa: F401  (يسجّل كل الموديلات في Base.metadata)
        if IS_SQLITE:
            return []
        gaps = find_schema_gaps(engine, Base.metadata)
        if gaps:
            log.warning(
                "⚠ بنية قاعدة البيانات لا تطابق الكود (%d فرق). قد تظهر الشاشات فارغة "
                "(المنتجات/قوالب الوحدات...). شغّل من مجلد backend:\n"
                "    python ../scripts/migrate.py status\n"
                "    python ../scripts/migrate.py apply\n%s",
                len(gaps), "\n".join("  - " + g for g in gaps),
            )
            print("\n⚠ SCHEMA MISMATCH — شغّل: python ../scripts/migrate.py status / apply")
            for g in gaps:
                print("  -", g)
        else:
            log.info("schema check: OK")
        return gaps
    except Exception as e:  # noqa: BLE001
        log.warning("تعذر فحص بنية القاعدة: %s", e)
        return []
