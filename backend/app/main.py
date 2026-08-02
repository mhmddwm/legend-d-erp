import os
import logging
import traceback
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.routers import (
    accounting,
    inventory,
    purchasing,
    localization,
    users,
    roles,
    permissions_catalog,
    warehouse,
    warehouse_locations,
    branches  # تم إضافة branches هنا
)

logger = logging.getLogger("uvicorn.error")

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


# ================= معالج أخطاء شامل =================
# بدون هذا، أي خطأ غير متوقع (عمود غير موجود بقاعدة البيانات، migration
# لم تُشغَّل، إلخ) يرجع للواجهة كـ 500 فارغ فتظهر رسالة "خطأ في الخادم"
# العامة بدون أي تفاصيل تساعد على التشخيص. هذا المعالج يسجّل الخطأ
# الكامل بالـ logs (لك أنت فقط، بلوحة Render) ويرجع رسالة واضحة للواجهة.
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error("خطأ غير متوقع في %s: %s\n%s", request.url.path, exc, traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": f"خطأ غير متوقع في الخادم: {type(exc).__name__}: {str(exc)}"},
    )


# ================= ROUTERS =================

# Localization
app.include_router(localization.router)


# Accounting
app.include_router(accounting.router)
app.include_router(accounting.journal_router)
app.include_router(accounting.cost_center_router)
app.include_router(accounting.tax_type_router)


# Branches (تم إضافة مسار الفروع)
app.include_router(branches.router)


# Inventory
app.include_router(inventory.router)
app.include_router(inventory.stock_router)
app.include_router(inventory.supplier_router)


# Purchasing
app.include_router(purchasing.po_router)
app.include_router(purchasing.grn_router)
app.include_router(purchasing.pinv_router)
app.include_router(purchasing.prt_router)


# Users, Roles & Permissions
app.include_router(users.router)
app.include_router(roles.router)
app.include_router(permissions_catalog.router)


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
        reload=True
    )