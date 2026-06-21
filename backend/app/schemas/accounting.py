from pydantic import BaseModel, Field
from typing import Optional
from datetime import date


class AccountIn(BaseModel):
    code: str
    name_ar: str
    name_en: Optional[str] = None
    account_type: str = Field(pattern="^(assets|liabilities|equity|revenue|expenses)$")
    parent_code: Optional[str] = None
    opening_balance: float = 0


class AccountUpdate(BaseModel):
    name_ar: Optional[str] = None
    name_en: Optional[str] = None
    parent_code: Optional[str] = None
    opening_balance: Optional[float] = None


class AccountOut(BaseModel):
    code: str
    name_ar: str
    name_en: Optional[str]
    account_type: str
    parent_code: Optional[str]
    opening_balance: float
    balance: float = 0  # الرصيد المحسوب (افتتاحي + قيود + فروع)

    class Config:
        from_attributes = True


class JournalEntryIn(BaseModel):
    entry_date: date
    debit_account: str
    credit_account: str
    amount: float = Field(gt=0)
    description: Optional[str] = None


class JournalEntryOut(BaseModel):
    id: int
    entry_date: date
    debit_account: str
    credit_account: str
    amount: float
    description: Optional[str]
    source_type: str
    source_ref: Optional[str]

    class Config:
        from_attributes = True
