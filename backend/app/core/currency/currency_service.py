from dataclasses import dataclass

@dataclass
class CurrencyAmount:
    amount: float
    currency: str = "SAR"

class CurrencyService:
    """Currency placeholder. Exchange-rate logic will be added later."""
    def normalize(self, value: CurrencyAmount, target_currency: str = "SAR") -> CurrencyAmount:
        return CurrencyAmount(amount=value.amount, currency=target_currency)
