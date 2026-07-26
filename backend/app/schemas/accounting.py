from pydantic import BaseModel, Field
from typing import Optional
from datetime import date, datetime

class AccountIn(BaseModel):
    code: str
    name_ar: str
    name_en: Optional[str] = None
    account_type: str = Field(pattern="^(assets|liabilities|equity|revenue|expenses)$")
    nature: str = Field(default="مدين", pattern="^(مدين|دائن)$")
    # تم تحديثه ليصبح اختيارياً بوضوح
    parent_code: Optional[str] = None 
    opening_balance: float = 0


class AccountUpdate(BaseModel):
    name_ar: Optional[str] = None
    name_en: Optional[str] = None
    account_type: Optional[str] = None  # <--- أضف هذا السطر
    nature: Optional[str] = Field(default=None, pattern="^(مدين|دائن)$")
    parent_code: Optional[str] = None
    opening_balance: Optional[float] = None

class AccountOut(BaseModel):
    code: str
    name_ar: str
    name_en: Optional[str] = None
    account_type: str
    nature: str
    parent_code: Optional[str] = None # تحديث لضمان التوافق
    opening_balance: float
    balance: float = 0

    class Config:
        from_attributes = True


class CostCenterIn(BaseModel):
    code: str
    name_ar: str
    name_en: Optional[str] = None


class CostCenterOut(BaseModel):
    code: str
    name_ar: str
    name_en: Optional[str] = None
    is_active: bool

    class Config:
        from_attributes = True


class LineCostAllocationIn(BaseModel):
    cost_center_code: str
    percentage: float = Field(gt=0, le=100)


class LineCostAllocationOut(BaseModel):
    id: int
    cost_center_code: str
    percentage: float

    class Config:
        from_attributes = True


class LedgerTransactionOut(BaseModel):
    entry_id: int
    entry_date: date
    operation: str
    debit: float
    credit: float
    balance_after: float
    branch_id: Optional[int] = None
    created_by_name: Optional[str] = None
    status: str


class LedgerResponseOut(BaseModel):
    account_code: str
    account_name_ar: str
    account_name_en: Optional[str] = None
    account_type: str
    opening_balance: float
    balance_before_period: float
    current_balance: float
    total: int
    page: int
    page_size: int
    transactions: list[LedgerTransactionOut]


class JournalEntryLineIn(BaseModel):
    account_code: str
    debit: float = Field(default=0, ge=0)
    credit: float = Field(default=0, ge=0)
    line_description: Optional[str] = None
    cost_allocations: list[LineCostAllocationIn] = []


class JournalEntryLineOut(BaseModel):
    id: int
    account_code: str
    debit: float
    credit: float
    line_description: Optional[str] = None
    cost_allocations: list[LineCostAllocationOut] = []

    class Config:
        from_attributes = True


class JournalEntryIn(BaseModel):
    entry_date: date
    description: Optional[str] = None
    created_by_name: Optional[str] = None
    branch_id: Optional[int] = None
    lines: list[JournalEntryLineIn] = Field(min_length=2)


class JournalEntryAttachmentIn(BaseModel):
    file_name: str
    file_url: str
    file_type: Optional[str] = None
    file_size: Optional[int] = None
    uploaded_by: Optional[str] = None


class JournalEntryAttachmentOut(BaseModel):
    id: int
    file_name: str
    file_url: str
    file_type: Optional[str] = None
    file_size: Optional[int] = None
    uploaded_by: Optional[str] = None
    uploaded_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class JournalEntryOut(BaseModel):
    id: int
    entry_date: date
    description: Optional[str] = None
    source_type: str
    source_ref: Optional[str] = None
    created_by_name: Optional[str] = None
    created_at: Optional[datetime] = None
    status: str = "posted"
    branch_id: Optional[int] = None
    total_amount: float = 0
    lines: list[JournalEntryLineOut] = []
    attachments: list[JournalEntryAttachmentOut] = []

    class Config:
        from_attributes = True

