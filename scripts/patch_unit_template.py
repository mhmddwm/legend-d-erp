# -*- coding: utf-8 -*-
"""
تعديل ملفات الخادم الثلاثة لإضافة الحقل unit_template للمنتجات (PF-01.6).
يُشغَّل مرة واحدة من المجلد الرئيسي للمشروع:
    python scripts/patch_unit_template.py

الأمان:
  • يتحقق من النص المطلوب تعديله ويفشل دون أي كتابة إن لم يجده تماماً.
  • آمن للتكرار: إن كان التعديل مطبَّقاً يتخطاه.
  • يحافظ على نهايات الأسطر (Windows/Linux).
  • بعد التشغيل راجع التغييرات من Source Control (git diff).
"""
import os
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
APP = os.path.join(ROOT, "backend", "app")

# (الملف، بداية النطاق، نهاية النطاق، النص الأصلي، ما يُضاف بعده)
EDITS = [
    ("models/models.py", "class Item(", "\nclass ",
     '    unit = Column(\n        String(20),\n        nullable=False,\n        default="حبة"\n    )\n',
     '\n    # اسم قالب الوحدات المرتبط بالمنتج (PF-01.6)؛ القالب نفسه يُحفظ حالياً في المتصفح\n'
     '    unit_template = Column(String(120), nullable=True)\n'),
    ("schemas/inventory.py", "class ItemIn(", "\nclass ",
     '    unit: str = "حبة"\n', '    unit_template: Optional[str] = None\n'),
    ("schemas/inventory.py", "class ItemUpdate(", "\nclass ",
     '    unit: Optional[str] = None\n', '    unit_template: Optional[str] = None\n'),
    ("schemas/inventory.py", "class ItemOut(", "\nclass ",
     '    unit: str\n', '    unit_template: Optional[str] = None\n'),
    ("routers/inventory.py", "def create_item(", "\n@",
     '        unit=payload.unit,\n', '        unit_template=payload.unit_template,\n'),
]


def patch_file(rel, edits):
    path = os.path.join(APP, *rel.split("/"))
    with open(path, "rb") as fh:
        raw = fh.read().decode("utf-8")
    nl = "\r\n" if "\r\n" in raw else "\n"
    text = raw.replace("\r\n", "\n")
    messages = []
    for _, start, end, old, add in edits:
        a = text.find(start)
        if a < 0:
            raise RuntimeError(f"{rel}: لم أجد «{start}»")
        b = text.find(end, a + len(start))
        b = len(text) if b < 0 else b
        scope = text[a:b]
        if "unit_template" in scope:
            messages.append(f"  = {start} مطبَّق مسبقاً")
            continue
        if scope.count(old) != 1:
            raise RuntimeError(f"{rel}: «{start}» — النص المتوقع وُجد {scope.count(old)} مرة (المطلوب مرة واحدة)؛ "
                               "الملف يختلف عمّا أتوقعه، لن أعدّل شيئاً.")
        new_scope = scope.replace(old, old + add)
        text = text[:a] + new_scope + text[b:]
        messages.append(f"  + {start} تمت إضافة unit_template")
    with open(path, "wb") as fh:
        fh.write(text.replace("\n", nl).encode("utf-8"))
    return messages


def main():
    by_file = {}
    for e in EDITS:
        by_file.setdefault(e[0], []).append(e)
    done = []
    try:
        for rel, edits in by_file.items():
            print(rel)
            for m in patch_file(rel, edits):
                print(m)
            done.append(rel)
    except Exception as exc:
        print("\n[خطأ]", exc)
        if done:
            print("ملفات عُدِّلت قبل الخطأ:", ", ".join(done))
        return 1
    print("\nتم. السيرفر المحلي سيعيد تشغيل نفسه. تأكد أنك طبّقتَ الهجرة 034 قبل فتح أي شاشة.")
    return 0


if __name__ == "__main__":
    sys.exit(main())