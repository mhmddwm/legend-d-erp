from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List

@dataclass
class DomainEvent:
    name: str
    payload: Dict[str, Any]
    occurred_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

class EventBus:
    """Simple in-memory event bus skeleton for future module decoupling."""
    def __init__(self):
        self._subscribers: Dict[str, List[Callable[[DomainEvent], None]]] = {}

    def subscribe(self, event_name: str, handler: Callable[[DomainEvent], None]) -> None:
        self._subscribers.setdefault(event_name, []).append(handler)

    def publish(self, event: DomainEvent) -> None:
        for handler in self._subscribers.get(event.name, []):
            handler(event)

event_bus = EventBus()
