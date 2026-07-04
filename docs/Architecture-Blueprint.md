# LEGEND D Architecture Blueprint

## Current Foundation
The current repository keeps the original operational folders:

```text
frontend/
backend/
database/
```

PF-01.1 adds platform-level folders around them:

```text
docs/
vision/
deployment/
scripts/
tests/
config/
```

## Target Platform Layers

### 1. Operations Layer
Daily business screens: purchasing, inventory, sales, accounting, products, suppliers, customers.

### 2. Management Layer
Dashboards, approvals, KPIs, decision center, supplier scoring, alerts.

### 3. Intelligence Layer
AI Copilot, recommendations, predictions, company memory, business knowledge graph.

## Backend Core Engines
Core engines live under:

```text
backend/app/core/
```

The goal is to avoid rewriting workflow, audit, numbering, tax, and decision logic in every module.

## Event-Driven Direction
Future business operations should publish events, for example:

```text
PurchaseRequestCreated
RFQSent
SupplierQuotationReceived
SupplierSelected
PurchaseOrderCreated
StockReceived
PurchaseInvoiceCreated
```

Other modules can react to those events without direct coupling.
