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
    branches,
    reports,
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
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

    return JSONResponse(
        status_code=500,
        content={
            "detail": str(exc),
            "type": type(exc).__name__,
            "path": request.url.path,
        },
    )


# ============================================================
# Routers
# ============================================================

# Localization
app.include_router(
    localization.router
)


# Accounting
app.include_router(
    accounting.router
)

app.include_router(
    accounting.journal_router
)

app.include_router(
    accounting.cost_center_router
)

app.include_router(
    accounting.tax_type_router
)


# Branches
app.include_router(
    branches.router
)

# Financial Reports
app.include_router(
    reports.router
)


# Inventory
app.include_router(
    inventory.router
)

app.include_router(
    inventory.stock_router
)

app.include_router(
    inventory.supplier_router
)


# Purchasing
app.include_router(
    purchasing.po_router
)

app.include_router(
    purchasing.grn_router
)

app.include_router(
    purchasing.pinv_router
)

app.include_router(
    purchasing.prt_router
)

app.include_router(
    purchasing.spay_router
)


# Users / Roles / Permissions
app.include_router(
    users.router
)

app.include_router(
    roles.router
)

app.include_router(
    permissions_catalog.router
)


# Warehouse
app.include_router(
    warehouse.router
)

app.include_router(
    warehouse.stock_router
)

app.include_router(
    warehouse_locations.router
)


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