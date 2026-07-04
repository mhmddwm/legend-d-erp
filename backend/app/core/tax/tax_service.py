from dataclasses import dataclass

@dataclass
class TaxRule:
    name: str
    rate_percent: float
    included: bool = False

@dataclass
class TaxResult:
    net_amount: float
    tax_amount: float
    gross_amount: float

class TaxService:
    def calculate(self, amount: float, rule: TaxRule) -> TaxResult:
        rate = rule.rate_percent / 100
        if rule.included:
            net = amount / (1 + rate) if rate else amount
            tax = amount - net
            return TaxResult(net_amount=round(net, 2), tax_amount=round(tax, 2), gross_amount=round(amount, 2))
        tax = amount * rate
        return TaxResult(net_amount=round(amount, 2), tax_amount=round(tax, 2), gross_amount=round(amount + tax, 2))
