from dataclasses import dataclass

@dataclass
class SupplierDecisionInput:
    supplier_code: str
    total_cost: float
    lead_time_days: int
    payment_terms_days: int
    validity_days: int
    quality_score: float = 80
    commitment_score: float = 80

@dataclass
class SupplierDecisionScore:
    supplier_code: str
    score: float
    explanation: str

class DecisionService:
    """Initial supplier score engine. Weights will become configurable."""
    def score_supplier(self, item: SupplierDecisionInput) -> SupplierDecisionScore:
        # Placeholder scoring formula for PF-01.1 skeleton.
        delivery_score = max(0, 100 - item.lead_time_days)
        payment_score = min(100, item.payment_terms_days)
        validity_score = min(100, item.validity_days)
        score = (
            item.quality_score * 0.25 +
            item.commitment_score * 0.25 +
            delivery_score * 0.20 +
            payment_score * 0.15 +
            validity_score * 0.15
        )
        return SupplierDecisionScore(
            supplier_code=item.supplier_code,
            score=round(score, 2),
            explanation="Score calculated from quality, commitment, delivery, payment terms, and offer validity."
        )
