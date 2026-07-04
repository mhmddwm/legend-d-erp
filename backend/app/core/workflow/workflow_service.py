from enum import Enum

class WorkflowState(str, Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    REVIEWED = "reviewed"
    APPROVED = "approved"
    PROCESSED = "processed"
    CLOSED = "closed"
    CANCELLED = "cancelled"

class WorkflowService:
    """Basic workflow transition guard. Rules will expand per document type."""
    allowed_transitions = {
        WorkflowState.DRAFT: {WorkflowState.SUBMITTED, WorkflowState.CANCELLED},
        WorkflowState.SUBMITTED: {WorkflowState.REVIEWED, WorkflowState.APPROVED, WorkflowState.CANCELLED},
        WorkflowState.REVIEWED: {WorkflowState.APPROVED, WorkflowState.CANCELLED},
        WorkflowState.APPROVED: {WorkflowState.PROCESSED, WorkflowState.CANCELLED},
        WorkflowState.PROCESSED: {WorkflowState.CLOSED},
        WorkflowState.CLOSED: set(),
        WorkflowState.CANCELLED: set(),
    }

    def can_transition(self, current: WorkflowState, target: WorkflowState) -> bool:
        return target in self.allowed_transitions.get(current, set())
