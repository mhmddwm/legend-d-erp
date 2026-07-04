from dataclasses import dataclass
from datetime import datetime, timezone

@dataclass
class Notification:
    recipient: str
    title: str
    message: str
    created_at: datetime = datetime.now(timezone.utc)

class NotificationService:
    """Notification placeholder for internal alerts, email, and WhatsApp later."""
    def create(self, recipient: str, title: str, message: str) -> Notification:
        return Notification(recipient=recipient, title=title, message=message)
