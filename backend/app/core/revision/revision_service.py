from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Optional

@dataclass
class RevisionRecord:
    document_type: str
    document_id: str
    revision_no: int
    changes: Dict[str, Any]
    actor: str
    reason: Optional[str] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

class RevisionService:
    """Creates revision metadata for documents."""
    def next_revision_no(self, current_revision_no: int | None) -> int:
        return 0 if current_revision_no is None else current_revision_no + 1

    def create_revision(self, document_type: str, document_id: str, current_revision_no: int | None, changes: Dict[str, Any], actor: str, reason: str | None = None) -> RevisionRecord:
        return RevisionRecord(
            document_type=document_type,
            document_id=document_id,
            revision_no=self.next_revision_no(current_revision_no),
            changes=changes,
            actor=actor,
            reason=reason,
        )
