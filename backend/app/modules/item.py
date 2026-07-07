from sqlalchemy import Column, Integer, String, Numeric
from app.database import Base


class Item(Base):
    __tablename__ = "items"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    sku = Column(String)
    unit = Column(String)
    price = Column(Numeric)
    stock_qty = Column(Numeric, default=0)