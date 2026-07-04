# Purchase Cycle Standard

Recommended flow:

```text
Purchase Request
→ Request For Quotation
→ Supplier Quotations
→ Quotation Comparison
→ Decision Center
→ Purchase Order
→ Goods Receipt
→ Purchase Invoice
→ Supplier Payment
```

## Required Traceability
Every later document should link back to the earlier document:

```text
Invoice → Receipt → PO → Decision → RFQ → PR
```

## Revision Management
If a new product is added during RFQ stage:
- Add it to the original Purchase Request.
- Create a new revision.
- Update linked open RFQs.
- Mark supplier replies as needing update if they were based on an older revision.
