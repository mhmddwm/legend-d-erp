from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import (
    Item,
    JournalEntry,
    JournalEntryLine,
    JournalEntryAttachment,
    LineCostAllocation,
    GoodsReceipt,
    GoodsReceiptLine,
    PurchaseInvoice,
    PurchaseInvoiceLine,
    PurchaseOrder,
    PurchaseOrderLine,
    PurchaseReturn,
    PurchaseReturnLine,
    StockMove,
    SupplierPayment,
    SupplierPaymentAllocation,
)
from app.models.warehouse_stock import WarehouseStock
from app.models.audit_log import AuditLog


router = APIRouter(prefix="/api/system", tags=["System"])

# العبارة الواجب إرسالها حرفياً لتأكيد عملية التصفير — حماية إضافية ضد
# التنفيذ العرضي لعملية غير قابلة للتراجع عنها
RESET_CONFIRM_PHRASE = "تصفير الحركات"


class ResetTransactionsIn(BaseModel):
    confirm: str


@router.post("/reset-transactions")
def reset_all_transactions(payload: ResetTransactionsIn, db: Session = Depends(get_db)):
    """تصفير شامل لكل الحركات التشغيلية والمحاسبية بالنظام، مع الإبقاء
    الكامل على البيانات الأساسية (دليل الحسابات، الموردين، تعريفات
    الأصناف، المستودعات، مراكز التكلفة، أنواع الضرائب، الفروع).

    يُحذف: كل القيود المحاسبية، فواتير ومرتجعات ومدفوعات المشتريات،
    أوامر الشراء وأذون الاستلام، حركات المخزون، أرصدة المستودعات،
    وسجل النشاط. وتُصفَّر كمية وتكلفة كل الأصناف إلى صفر.

    عملية غير قابلة للتراجع عنها — تتطلب إرسال عبارة تأكيد حرفية."""
    if payload.confirm != RESET_CONFIRM_PHRASE:
        raise HTTPException(
            status_code=400,
            detail=f'يجب إرسال عبارة التأكيد بالضبط: "{RESET_CONFIRM_PHRASE}"',
        )

    try:
        # الحركات المالية المرتبطة بالمشتريات (أبناء قبل آباء)
        db.query(SupplierPaymentAllocation).delete()
        db.query(SupplierPayment).delete()

        db.query(PurchaseReturnLine).delete()
        db.query(PurchaseReturn).delete()

        db.query(PurchaseInvoiceLine).delete()
        db.query(PurchaseInvoice).delete()

        db.query(GoodsReceiptLine).delete()
        db.query(GoodsReceipt).delete()

        db.query(PurchaseOrderLine).delete()
        db.query(PurchaseOrder).delete()

        # حركات وأرصدة المخزون
        db.query(StockMove).delete()
        db.query(WarehouseStock).delete()

        # القيود المحاسبية وملحقاتها
        db.query(LineCostAllocation).delete()
        db.query(JournalEntryAttachment).delete()
        db.query(JournalEntryLine).delete()
        db.query(JournalEntry).delete()

        # سجل النشاط (كان مرتبطاً بمستندات اتمسحت أعلاه)
        db.query(AuditLog).delete()

        # تصفير كمية وتكلفة كل الأصناف (البقاء على تعريف الصنف نفسه)
        db.query(Item).update({Item.qty: 0, Item.avg_cost: 0})

        db.commit()
    except Exception:
        db.rollback()
        raise

    return {"status": "ok", "message": "تم تصفير كل الحركات التشغيلية والمحاسبية بنجاح. دليل الحسابات والبيانات الأساسية سليمة."}
