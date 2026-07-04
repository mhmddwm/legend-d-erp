from dataclasses import dataclass
from typing import Any, Dict

@dataclass
class AIContext:
    user_question: str
    business_context: Dict[str, Any]

@dataclass
class AIRecommendation:
    title: str
    summary: str
    confidence: float = 0.0

class AIService:
    """AI interface placeholder. Real model integration will be added later."""
    def analyze(self, context: AIContext) -> AIRecommendation:
        return AIRecommendation(
            title="AI Foundation Placeholder",
            summary="The AI layer is ready to receive structured business context in a future sprint.",
            confidence=0.0,
        )
