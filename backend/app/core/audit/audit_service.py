from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional

@dataclass
class AuditRecord:
    actor: str
    action: str
    entity_type: str
    entity_id: str
    before: Optional[Dict[str, Any]] = None
    after: Optional[Dict[str, Any]] = None
    reason: Optional[str] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

class AuditService:
    """Skeleton audit service. Persistence will be connected in a later sprint."""
    def record(self, record: AuditRecord) -> AuditRecord:
        return record
