import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn

from app.routers import accounting, inventory, purchasing, localization

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(localization.router)
app.include_router(accounting.router)
app.include_router(accounting.journal_router)
app.include_router(inventory.router)
app.include_router(inventory.stock_router)
app.include_router(inventory.supplier_router)
app.include_router(purchasing.po_router)
app.include_router(purchasing.grn_router)
app.include_router(purchasing.pinv_router)
app.include_router(purchasing.prt_router)

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

app.mount(
    "/",
    StaticFiles(directory=str(FRONTEND_DIR), html=True),
    name="frontend"
)

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8000))
    )