import os
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.routers import (
    accounting,
    inventory,
    purchasing,
    localization,
    users,
    warehouse,
    warehouse_locations
)

# ================= MIGRATION =================
def run_startup_migrations():
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        return
    try:
        conn = psycopg2.connect(database_url)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()
        
        # المسار الصحيح للمجلد بناءً على هيكلية مشروعك
        base_dir = Path(__file__).resolve().parents[1] 
        migrations_dir = base_dir / "database" / "migrations"
        
        if migrations_dir.exists():
            sql_files = sorted([f for f in migrations_dir.glob("*.sql")])
            for file_path in sql_files:
                with open(file_path, 'r', encoding='utf-8') as f:
                    cursor.execute(f.read())
        cursor.close()
        conn.close()
    except Exception as e:
        print(f"Migration error: {e}")

run_startup_migrations()
# =============================================

app = FastAPI(
    title="ERP System"
)

# ================= CORS =================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ================= ROUTERS =================

# Localization
app.include_router(localization.router)


# Accounting
app.include_router(accounting.router)
# تم التأكد من ربط راوتر القيود اليومية الذي سنعتمد عليه في البحث المتقدم
app.include_router(accounting.journal_router)


# Inventory
app.include_router(inventory.router)
app.include_router(inventory.stock_router)
app.include_router(inventory.supplier_router)


# Purchasing
app.include_router(purchasing.po_router)
app.include_router(purchasing.grn_router)
app.include_router(purchasing.pinv_router)
app.include_router(purchasing.prt_router)


# Users
app.include_router(users.router)


# Warehouses
app.include_router(warehouse.router)


# Warehouse Locations
app.include_router(warehouse_locations.router)


# ================= API HEALTH CHECK =================

@app.get("/api")
def api_home():
    return {
        "message": "ERP API is running",
        "system": "LEGEND D ERP"
    }


# ================= FRONTEND =================

BASE_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIR = BASE_DIR / "frontend"

if FRONTEND_DIR.exists():
    app.mount(
        "/",
        StaticFiles(
            directory=str(FRONTEND_DIR),
            html=True
        ),
        name="frontend"
    )


# ================= LOCAL RUN =================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8000)),
        reload=True  # تم تفعيل الـ reload لتسهيل التطوير البرمجي
    )