from typing import Iterable, Callable, TypeVar, List

T = TypeVar("T")

class SearchService:
    """Simple generic text search helper for early-stage modules."""
    def filter(self, rows: Iterable[T], query: str, accessor: Callable[[T], str]) -> List[T]:
        q = (query or "").strip().lower()
        if not q:
            return list(rows)
        return [row for row in rows if q in (accessor(row) or "").lower()]
