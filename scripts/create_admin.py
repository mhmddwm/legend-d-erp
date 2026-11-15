# -*- coding: utf-8 -*-
"""إنشاء مدير نظام أو إعادة ضبط كلمة مروره.

الاستخدام (من مجلد backend وبعد تفعيل البيئة الافتراضية):
    python ../scripts/create_admin.py admin@example.com
سيطلب كلمة المرور بشكل مخفي. أضف --name "الاسم" لتحديد الاسم الكامل.
"""
import argparse
import getpass
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "backend"))

from app.bootstrap import upsert_admin  # noqa: E402
from app.database import SessionLocal  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("email")
    ap.add_argument("--name", default="مدير النظام")
    args = ap.parse_args()
    pw = getpass.getpass("كلمة المرور الجديدة (8 أحرف فأكثر): ")
    if len(pw) < 8:
        sys.exit("كلمة المرور أقصر من 8 أحرف")
    if pw != getpass.getpass("أعد كتابتها: "):
        sys.exit("كلمتا المرور غير متطابقتين")
    db = SessionLocal()
    try:
        user = upsert_admin(db, args.email, pw, args.name)
        print(f"تم: {user.email} (مدير النظام)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
