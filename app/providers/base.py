"""Abstract AI provider interface."""

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator


class ProviderError(Exception):
    """Raised for connection or API failures, with a user-friendly message."""


class AIProvider(ABC):
    @abstractmethod
    def stream_chat(
        self, messages: list[dict], settings: dict[str, str]
    ) -> AsyncIterator[str]:
        """Yield response text chunks for the given OpenAI-style messages."""

    @abstractmethod
    async def list_models(self, settings: dict[str, str]) -> list[str]:
        """Return available model names (used by the connection test)."""
