
from datetime import datetime

# Simple GRN module (skeleton)

class GoodsReceipt:
    def __init__(self, grn_number, po_number, warehouse):
        self.grn_number = grn_number
        self.po_number = po_number
        self.warehouse = warehouse
        self.items = []
        self.created_at = datetime.now()

    def add_item(self, product_id, qty, batch, expiry_date):
        self.items.append({
            "product_id": product_id,
            "qty": qty,
            "batch": batch,
            "expiry_date": expiry_date
        })

