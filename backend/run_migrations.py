import os
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

def run_sql_files():
    # طباعة المسار الحالي للتأكد من مكان تشغيل السكربت
    print(f"DEBUG: Current Working Directory: {os.getcwd()}")
    
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is not set. Skipping migrations.")
        return

    try:
        conn = psycopg2.connect(database_url)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()

        # تحديد مسار مجلد المهاجرات بشكل مطلق بناءً على موقع هذا السكربت
        script_dir = os.path.dirname(os.path.abspath(__file__))
        migrations_dir = os.path.join(script_dir, "database", "migrations")
        
        print(f"DEBUG: Looking for migrations at: {migrations_dir}")
        
        if not os.path.exists(migrations_dir):
            # طباعة محتويات المجلد الحالي لمعرفة مكان المجلدات بالنسبة للسكربت
            print(f"DEBUG: Directory contents: {os.listdir(script_dir)}")
            print(f"Migrations directory not found at: {migrations_dir}")
            return

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