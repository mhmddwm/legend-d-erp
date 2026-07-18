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


class JournalEntryLineIn(BaseModel):
    account_code: str
    debit: float = Field(default=0, ge=0)
    credit: float = Field(default=0, ge=0)
    line_description: Optional[str] = None


class JournalEntryLineOut(BaseModel):
    id: int
    account_code: str
    debit: float
    credit: float
    line_description: Optional[str] = None

    class Config:
        from_attributes = True


class JournalEntryIn(BaseModel):
    entry_date: date
    description: Optional[str] = None
    created_by_name: Optional[str] = None
    lines: list[JournalEntryLineIn] = Field(min_length=2)


class JournalEntryOut(BaseModel):
    id: int
    entry_date: date
    description: Optional[str] = None
    source_type: str
    source_ref: Optional[str] = None
    created_by_name: Optional[str] = None
    created_at: Optional[datetime] = None
    total_amount: Optional[float] = None
    # تبقى للتوافق مع القيود القديمة/البسيطة (سطرين فقط)
    debit_account: Optional[str] = None
    credit_account: Optional[str] = None
    amount: Optional[float] = None
    lines: list[JournalEntryLineOut] = []

    class Config:
        from_attributes = True

