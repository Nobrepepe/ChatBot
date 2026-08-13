"""OpenAI-compatible chat completions provider.

Works with Ollama (http://localhost:11434/v1), LM Studio
(http://localhost:1234/v1), llama.cpp server, KoboldCpp, and any other
endpoint implementing the OpenAI chat completions API.
"""

import json
from collections.abc import AsyncIterator

import httpx

from .base import AIProvider, ProviderError


def _headers(settings: dict[str, str]) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    api_key = settings.get("api_key", "").strip()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _base_url(settings: dict[str, str]) -> str:
    url = settings.get("base_url", "").strip().rstrip("/")
    if not url:
        raise ProviderError("No base URL configured. Set it in Settings.")
    return url


def _payload(messages: list[dict], settings: dict[str, str], stream: bool) -> dict:
    payload: dict = {
        "model": settings.get("model", "").strip(),
        "messages": messages,
        "stream": stream,
    }
    try:
        payload["temperature"] = float(settings.get("temperature", "0.8"))
        payload["top_p"] = float(settings.get("top_p", "0.95"))
        max_tokens = int(settings.get("max_tokens", "1024"))
        if max_tokens > 0:
            payload["max_tokens"] = max_tokens
    except ValueError as exc:
        raise ProviderError(f"Invalid model settings: {exc}") from exc
    if not payload["model"]:
        raise ProviderError("No model configured. Set one in Settings.")
    return payload


class OpenAICompatibleProvider(AIProvider):
    async def stream_chat(
        self, messages: list[dict], settings: dict[str, str]
    ) -> AsyncIterator[str]:
        url = _base_url(settings) + "/chat/completions"
        use_stream = settings.get("streaming", "1") == "1"
        payload = _payload(messages, settings, use_stream)
        timeout = httpx.Timeout(300.0, connect=10.0)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                if use_stream:
                    async with client.stream(
                        "POST", url, json=payload, headers=_headers(settings)
                    ) as resp:
                        if resp.status_code >= 400:
                            body = (await resp.aread()).decode(errors="replace")
                            raise ProviderError(
                                f"API error {resp.status_code}: {body[:500]}"
                            )
                        async for line in resp.aiter_lines():
                            line = line.strip()
                            if not line.startswith("data:"):
                                continue
                            data = line[5:].strip()
                            if data == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data)
                            except json.JSONDecodeError:
                                continue
                            choices = chunk.get("choices") or []
                            if not choices:
                                continue
                            delta = choices[0].get("delta") or {}
                            text = delta.get("content")
                            if text:
                                yield text
                else:
                    resp = await client.post(url, json=payload, headers=_headers(settings))
                    if resp.status_code >= 400:
                        raise ProviderError(
                            f"API error {resp.status_code}: {resp.text[:500]}"
                        )
                    data = resp.json()
                    choices = data.get("choices") or []
                    if not choices:
                        raise ProviderError("The model returned an empty response.")
                    yield choices[0].get("message", {}).get("content", "")
        except httpx.ConnectError as exc:
            raise ProviderError(
                f"Could not connect to {url}. Is your local model server running?"
            ) from exc
        except httpx.TimeoutException as exc:
            raise ProviderError("The request to the model timed out.") from exc

    async def list_models(self, settings: dict[str, str]) -> list[str]:
        url = _base_url(settings) + "/models"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, headers=_headers(settings))
                if resp.status_code >= 400:
                    raise ProviderError(f"API error {resp.status_code}: {resp.text[:300]}")
                data = resp.json()
        except httpx.ConnectError as exc:
            raise ProviderError(
                f"Could not connect to {url}. Is your local model server running?"
            ) from exc
        except httpx.TimeoutException as exc:
            raise ProviderError("Connection test timed out.") from exc
        models = data.get("data") or []
        return [m.get("id", "") for m in models if m.get("id")]


def get_provider() -> AIProvider:
    return OpenAICompatibleProvider()
