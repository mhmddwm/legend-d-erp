import sys
import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

sys.path.append(str(Path(__file__).resolve().parent.parent))

from app.routers import accounting, inventory, purchasing

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(accounting.router)
app.include_router(accounting.journal_router)
app.include_router(inventory.router)
app.include_router(inventory.stock_router)
app.include_router(inventory.supplier_router)
app.include_router(purchasing.po_router)
app.include_router(purchasing.grn_router)
app.include_router(purchasing.pinv_router)
app.include_router(purchasing.prt_router)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8080)