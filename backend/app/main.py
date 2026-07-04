import sys
import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn

# إعداد المسارات لضمان عمل الاستيرادات بشكل صحيح
sys.path.append(str(Path(__file__).resolve().parent.parent))

from app.routers import accounting, inventory, purchasing, localization

app = FastAPI()

# إعداد الـ CORS للسماح بالاتصال بين الواجهة والسيرفر
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# تسجيل الـ Routers
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

# ربط ملفات الـ Frontend لتعمل كواجهة للنظام
# تأكد أن المجلد اسمه 'frontend' في المسار الرئيسي للمشروع
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8080)