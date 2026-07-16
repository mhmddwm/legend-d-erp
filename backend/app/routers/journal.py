from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from ..database import get_db # استيراد دالة قاعدة البيانات
from ..models import JournalEntry # استيراد نموذج البيانات (Table)

router = APIRouter()

@router.get("/journal-entries")
def get_journal_entries(
    entry_no: Optional[int] = None,
    account: Optional[str] = None,
    # ... (باقي المعاملات كما كتبناها سابقاً)
    db: Session = Depends(get_db)
):
    # كود الفلترة هنا
    query = db.query(JournalEntry)
    # ... (شروط الـ if)
    return query.all()