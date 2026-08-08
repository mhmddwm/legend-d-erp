import os

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv


# تحميل متغيرات البيئة
load_dotenv()


DATABASE_URL = os.getenv("DATABASE_URL")


if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Please check your .env file."
    )


# إخفاء كلمة المرور عند الطباعة
safe_url = DATABASE_URL

if "@" in safe_url:
    safe_url = safe_url.split("@")[1]


print(f"DATABASE CONNECTED TO: {safe_url}")


# إعداد SSL لـ Supabase
connect_args = {}

if (
    "localhost" not in DATABASE_URL
    and "127.0.0.1" not in DATABASE_URL
):
    connect_args = {
        "sslmode": "require"
    }


# إنشاء الاتصال
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    connect_args=connect_args
)


# ==========================
# Database Diagnostic
# ==========================

try:
    with engine.connect() as conn:

        print("\n===== DATABASE INFO =====")

        info = conn.execute(
            text("""
                SELECT 
                    current_database(),
                    current_user,
                    current_schema();
            """)
        ).fetchone()

        print(info)


        print("\n===== ACCOUNTS COLUMNS =====")

        columns = conn.execute(
            text("""
                SELECT column_name
                FROM information_schema.columns
                WHERE table_name = 'accounts'
                ORDER BY ordinal_position;
            """)
        ).fetchall()


        for col in columns:
            print(col[0])


        print("==========================\n")


except Exception as e:
    print("DATABASE DIAGNOSTIC ERROR:")
    print(e)



# Session
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)


# Base Models
Base = declarative_base()


def get_db():

    db = SessionLocal()

    try:
        yield db

    finally:
        db.close()