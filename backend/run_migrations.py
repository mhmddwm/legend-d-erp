import os
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

def run_sql_files():
    # جلب رابط قاعدة البيانات من متغيرات البيئة في ريندر
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set. Skipping migrations.")
        return

    try:
        # الاتصال بقاعدة البيانات
        conn = psycopg2.connect(database_url)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()

        # استخدام المسار المطلق لضمان العثور على المجلد داخل بيئة Render
        migrations_dir = os.path.join(os.path.abspath(os.path.dirname(__file__)), "database", "migrations")
        
        # إضافة سطر للتحقق من المسار في الـ Logs
        print(f"DEBUG: Looking for migrations at: {migrations_dir}")
        
        if not os.path.exists(migrations_dir):
            print(f"Migrations directory not found at: {migrations_dir}")
            return

        # ترتيب ملفات الـ SQL أبجدياً لضمان تنفيذها بالترتيب الصحيح (001 ثم 002...)
        sql_files = sorted([f for f in os.listdir(migrations_dir) if f.endswith('.sql')])

        for file_name in sql_files:
            file_path = os.path.join(migrations_dir, file_name)
            print(f"Running migration: {file_name}...")
            
            with open(file_path, 'r', encoding='utf-8') as f:
                sql_script = f.read()
                if sql_script.strip():
                    cursor.execute(sql_script)
        
        cursor.close()
        conn.close()
        print("All migrations executed successfully!")

    except Exception as e:
        print(f"Error executing migrations: {e}")

if __name__ == "__main__":
    run_sql_files()