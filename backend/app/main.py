import os
import logging
import traceback
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles


from app.core.security import enforce_route_permission
from app.routers import (
    auth,
    accounting,
    inventory,
    purchasing,
    sales,
    localization,
    users,
    roles,
    permissions_catalog,
    warehouse,
    warehouse_locations,
    branches,
    reports,
    system,
)


# ============================================================
# Logging
# ============================================================

logger = logging.getLogger("uvicorn.error")


# ============================================================
# Application
# ============================================================

app = FastAPI(
    title="LEGEND D ERP System"
)


# ============================================================
# CORS
# ============================================================

# الواجهة تُخدَّم عادةً من نفس الخادم. يُسمح دائماً بـ localhost/127.0.0.1 لأغراض
# التطوير المحلي (script.js يخاطب 127.0.0.1:8080 حين تُفتح الصفحة من localhost).
# لأصول إضافية: CORS_ORIGINS=https://erp.example.com  (لا يُسمح بـ "*").
_cors_origins = [
    o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",")
    if o.strip() and o.strip() != "*"
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=False,   # المصادقة بترويسة Bearer لا بالكوكيز
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# Global Exception Handler
# ============================================================

@app.exception_handler(Exception)
async def global_exception_handler(
    request: Request,
    exc: Exception
):

    logger.error(
        "\n========== SERVER ERROR ==========\n"
        "PATH: %s\n"
        "ERROR: %s\n"
        "%s"
        "\n==================================",
        request.url.path,
        exc,
        traceback.format_exc(),
    )

    if os.getenv("DEBUG", "").lower() in ("1", "true", "yes"):
        content = {
            "detail": str(exc),
            "type": type(exc).__name__,
            "path": request.url.path,
        }
    else:
        content = {"detail": "حدث خطأ داخلي في الخادم"}
    return JSONResponse(status_code=500, content=content)


# ============================================================
# Routers
# ============================================================

# كل الراوترات (عدا الدخول والترجمة) تمر عبر المصادقة + فحص الصلاحية المركزي
PROTECTED = [Depends(enforce_route_permission)]

# Auth (عام: تسجيل الدخول)
app.include_router(
    auth.router
)

# Localization
app.include_router(
    localization.router
)


# Accounting
app.include_router(
    accounting.router,
    dependencies=PROTECTED,
)

app.include_router(
    accounting.journal_router,
    dependencies=PROTECTED,
)

app.include_router(
    accounting.cost_center_router,
    dependencies=PROTECTED,
)

app.include_router(
    accounting.tax_type_router,
    dependencies=PROTECTED,
)


# Branches
app.include_router(
    branches.router,
    dependencies=PROTECTED,
)

# Financial Reports
app.include_router(
    reports.router,
    dependencies=PROTECTED,
)

# System utilities
app.include_router(
    system.router,
    dependencies=PROTECTED,
)


# Inventory
app.include_router(
    inventory.router,
    dependencies=PROTECTED,
)

app.include_router(
    inventory.stock_router,
    dependencies=PROTECTED,
)

app.include_router(
    inventory.supplier_router,
    dependencies=PROTECTED,
)

app.include_router(
    inventory.category_router,
    dependencies=PROTECTED,
)

app.include_router(
    inventory.brand_router,
    dependencies=PROTECTED,
)

app.include_router(
    inventory.unit_template_router,
    dependencies=PROTECTED,
)

app.include_router(
    inventory.price_list_router,
    dependencies=PROTECTED,
)


# Purchasing
app.include_router(
    purchasing.po_router,
    dependencies=PROTECTED,
)

app.include_router(
    purchasing.grn_router,
    dependencies=PROTECTED,
)

app.include_router(
    purchasing.pinv_router,
    dependencies=PROTECTED,
)

app.include_router(
    purchasing.prt_router,
    dependencies=PROTECTED,
)

app.include_router(
    purchasing.spay_router,
    dependencies=PROTECTED,
)


# Sales
app.include_router(
    sales.customer_router,
    dependencies=PROTECTED,
)

app.include_router(
    sales.si_router,
    dependencies=PROTECTED,
)

app.include_router(
    sales.so_router,
    dependencies=PROTECTED,
)

app.include_router(
    sales.dn_router,
    dependencies=PROTECTED,
)

app.include_router(
    sales.sq_router,
    dependencies=PROTECTED,
)

app.include_router(
    sales.sr_router,
    dependencies=PROTECTED,
)


# Users / Roles / Permissions
app.include_router(
    users.router,
    dependencies=PROTECTED,
)

app.include_router(
    roles.router,
    dependencies=PROTECTED,
)

app.include_router(
    permissions_catalog.router,
    dependencies=PROTECTED,
)


# Warehouse
app.include_router(
    warehouse.router,
    dependencies=PROTECTED,
)

app.include_router(
    warehouse.stock_router,
    dependencies=PROTECTED,
)

app.include_router(
    warehouse_locations.router,
    dependencies=PROTECTED,
)


# ============================================================
# إنشاء مدير النظام الأول (إن لم يوجد أي مستخدم)
# ============================================================

@app.on_event("startup")
def bootstrap_admin():
    from app.bootstrap import ensure_initial_admin
    ensure_initial_admin()


# ============================================================
# Health Check
# ============================================================

@app.get("/api")
def api_home():

    return {
        "message": "ERP API is running",
        "system": "LEGEND D ERP"
    }


# ============================================================
# Frontend
# ============================================================

BASE_DIR = Path(__file__).resolve().parents[2]

FRONTEND_DIR = BASE_DIR / "frontend"


if FRONTEND_DIR.exists():

    app.mount(
        "/",
        StaticFiles(
            directory=str(FRONTEND_DIR),
            html=True
        ),
        name="frontend",
    )


# ============================================================
# Local Run
# ============================================================

if __name__ == "__main__":

    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=int(
            os.environ.get(
                "PORT",
                8000
            )
        ),
        reload=True,
    )