from dataclasses import dataclass

@dataclass
class NumberingRule:
    prefix: str
    next_number: int = 1
    digits: int = 4
    separator: str = "-"

class NumberingService:
    def generate(self, rule: NumberingRule) -> str:
        return f"{rule.prefix}{rule.separator}{rule.next_number:0{rule.digits}d}"
