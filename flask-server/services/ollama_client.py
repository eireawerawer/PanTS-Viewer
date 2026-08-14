from __future__ import annotations

import json
import os
import re
from typing import Any

import requests


OLLAMA_BASE_URL = os.getenv(
    "OLLAMA_BASE_URL",
    "http://localhost:11434",
).rstrip("/")

# Default to llama3.1 — it is NOT a reasoning model, so it never leaks a
# chain-of-thought "thinking" block into the answer. qwen3 is faster but only
# stays clean when the local Ollama honors the /no_think switch (recent Ollama).
DEFAULT_OLLAMA_MODEL = os.getenv(
    "BODYMAPS_OLLAMA_MODEL",
    "llama3.1:latest",
).strip()

# Model used when the request carries images (screenshots / attached scans).
DEFAULT_OLLAMA_VISION_MODEL = os.getenv(
    "BODYMAPS_OLLAMA_VISION_MODEL",
    "qwen3-vl:4b",
).strip()

OLLAMA_LIST_TIMEOUT = float(
    os.getenv("OLLAMA_LIST_TIMEOUT_SECONDS", "5")
)

# Local models can take longer than 30 seconds on the first request.
OLLAMA_CHAT_TIMEOUT = float(
    os.getenv("OLLAMA_CHAT_TIMEOUT_SECONDS", "180")
)

OLLAMA_KEEP_ALIVE = os.getenv("OLLAMA_KEEP_ALIVE", "30m").strip() or "30m"

OLLAMA_NUM_CTX = int(os.getenv("OLLAMA_NUM_CTX", "8192"))

# Ceiling on generated tokens. -1 means "no cap": the model generates until it
# naturally finishes, so answers are never cut off mid-sentence. Brevity for
# simple questions comes from the prompt, not from a low cap.
OLLAMA_NUM_PREDICT = int(os.getenv("OLLAMA_NUM_PREDICT", "-1"))

# Connect timeout for the streaming call. The READ timeout is intentionally
# unlimited (see chat_stream) so a slow, still-working generation is never
# disconnected before it finishes.
OLLAMA_CONNECT_TIMEOUT = float(os.getenv("OLLAMA_CONNECT_TIMEOUT_SECONDS", "20"))

# Ask the model to emit its private reasoning as a separate "thinking" stream
# (supported by qwen3 / reasoning models). When false, only the answer streams.
OLLAMA_THINK = os.getenv("OLLAMA_THINK", "false").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}


class OllamaUnavailable(RuntimeError):
    """Raised when the local Ollama server cannot complete a request."""


class OllamaInvalidResponse(RuntimeError):
    """Raised when Ollama returns a response that cannot be parsed."""


def list_ollama_models(
    timeout: float | None = None,
) -> list[dict[str, Any]]:
    """Return installed Ollama models from /api/tags."""

    try:
        response = requests.get(
            f"{OLLAMA_BASE_URL}/api/tags",
            timeout=(
                timeout
                if timeout is not None
                else OLLAMA_LIST_TIMEOUT
            ),
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise OllamaUnavailable(str(exc)) from exc

    models = payload.get("models", [])

    if not isinstance(models, list):
        return []

    result: list[dict[str, Any]] = []

    for model in models:
        if not isinstance(model, dict):
            continue

        name = str(model.get("name") or "").strip()
        if not name:
            continue

        result.append(
            {
                "name": name,
                "size": model.get("size"),
                "modified_at": model.get("modified_at"),
                "details": model.get("details"),
            }
        )

    return result


def _extract_json_object(text: str) -> dict[str, Any]:
    value = (text or "").strip()

    if not value:
        raise OllamaInvalidResponse(
            "Ollama returned an empty response."
        )

    fenced = re.search(
        r"```(?:json)?\s*(\{.*\})\s*```",
        value,
        flags=re.DOTALL | re.IGNORECASE,
    )

    if fenced:
        value = fenced.group(1).strip()
    elif not value.startswith("{"):
        start = value.find("{")
        end = value.rfind("}")

        if start >= 0 and end > start:
            value = value[start : end + 1]

    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise OllamaInvalidResponse(
            f"Ollama did not return valid JSON: {exc}"
        ) from exc

    if not isinstance(parsed, dict):
        raise OllamaInvalidResponse(
            "Ollama response JSON was not an object."
        )

    return parsed


def _post_chat(
    payload: dict[str, Any],
    timeout: float,
) -> dict[str, Any]:
    try:
        response = requests.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json=payload,
            timeout=timeout,
        )
        response.raise_for_status()
        data = response.json()
    except requests.Timeout as exc:
        raise OllamaUnavailable(
            "Ollama timed out while generating a response."
        ) from exc
    except (requests.RequestException, ValueError) as exc:
        raise OllamaUnavailable(str(exc)) from exc

    if not isinstance(data, dict):
        raise OllamaInvalidResponse(
            "Ollama returned an unexpected response."
        )

    return data


def chat_structured_json(
    *,
    model: str,
    messages: list[dict[str, Any]],
    schema: dict[str, Any],
    timeout: float | None = None,
    temperature: float = 0.0,
    seed: int = 42,
) -> dict[str, Any]:
    """Call Ollama with text or image messages and a JSON response schema."""
    selected_model = str(model or "").strip()
    if not selected_model:
        raise ValueError("An Ollama model name is required.")
    if not messages:
        raise ValueError("At least one Ollama message is required.")
    if not isinstance(schema, dict) or schema.get("type") != "object":
        raise ValueError("A JSON object schema is required.")

    payload: dict[str, Any] = {
        "model": selected_model,
        "stream": False,
        "keep_alive": "10m",
        "messages": messages,
        "options": {
            "temperature": temperature,
            "num_ctx": 4096,
            "seed": seed,
        },
        "format": schema,
    }
    data = _post_chat(
        payload,
        timeout if timeout is not None else OLLAMA_CHAT_TIMEOUT,
    )
    content = (((data.get("message") or {}).get("content") or "")).strip()
    return _extract_json_object(content)


def chat_json(
    *,
    model: str | None,
    system_prompt: str,
    user_prompt: str,
    response_schema: dict[str, Any] | None = None,
    timeout: float | None = None,
    temperature: float = 0.2,
) -> dict[str, Any]:
    """
    Call Ollama /api/chat and return one parsed JSON object.

    The response contains conversational text and optional viewer actions.
    """

    selected_model = (
        str(model or DEFAULT_OLLAMA_MODEL).strip()
    )

    if not selected_model:
        raise ValueError("An Ollama model name is required.")

    request_timeout = (
        timeout
        if timeout is not None
        else OLLAMA_CHAT_TIMEOUT
    )

    json_user_prompt = user_prompt
    if not OLLAMA_THINK and "qwen3" in selected_model.lower():
        json_user_prompt = f"{json_user_prompt}\n\n/no_think"

    payload: dict[str, Any] = {
        "model": selected_model,
        "stream": False,
        "keep_alive": OLLAMA_KEEP_ALIVE,
        "messages": [
            {
                "role": "system",
                "content": system_prompt,
            },
            {
                "role": "user",
                "content": json_user_prompt,
            },
        ],
        "options": {
            "temperature": temperature,
            "num_ctx": OLLAMA_NUM_CTX,
            "seed": 42,
        },
        "think": OLLAMA_THINK,
        "format": response_schema or "json",
    }

    data = _post_chat(payload, request_timeout)

    content = (
        ((data.get("message") or {}).get("content") or "")
        .strip()
    )

    try:
        return _extract_json_object(content)
    except OllamaInvalidResponse:
        # Give the model one opportunity to repair malformed JSON.
        repair_payload: dict[str, Any] = {
            "model": selected_model,
            "stream": False,
            "keep_alive": "10m",
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Convert the supplied content into one valid JSON "
                        "object with keys reply, actions, and intent. "
                        "Return JSON only."
                    ),
                },
                {
                    "role": "user",
                    "content": content,
                },
            ],
            "options": {
                "temperature": 0.0,
                "num_ctx": 4096,
                "seed": 42,
            },
            "format": response_schema or "json",
        }

        repaired = _post_chat(
            repair_payload,
            request_timeout,
        )

        repaired_content = (
            (
                (repaired.get("message") or {})
                .get("content")
                or ""
            )
            .strip()
        )

        return _extract_json_object(repaired_content)


def chat_stream(
    *,
    model: str | None,
    system_prompt: str,
    user_prompt: str,
    images: list[str] | None = None,
    timeout: float | None = None,
    temperature: float = 0.3,
):
    """
    Stream a conversational answer from Ollama /api/chat.

    Yields (kind, text) tuples as tokens arrive, where kind is either
    "thinking" (the model's private reasoning) or "content" (the answer the
    user should see). Callers forward these to the browser so the reply
    appears progressively instead of all at once.

    `images` is an optional list of base64-encoded images (no data: prefix);
    when present the caller should pass a vision-capable model.
    """

    selected_model = str(model or DEFAULT_OLLAMA_MODEL).strip()

    if not selected_model:
        raise ValueError("An Ollama model name is required.")

    # (connect, read) timeout. Read is None = unlimited, so a slow but still
    # streaming answer is NEVER disconnected before it finishes — only a failure
    # to connect (Ollama down) errors out quickly. `timeout` (if passed) only
    # overrides the connect timeout.
    connect_timeout = timeout if timeout is not None else OLLAMA_CONNECT_TIMEOUT
    request_timeout = (connect_timeout, None)

    content = user_prompt
    # qwen3 is a reasoning model: without this it emits a long <think> chain
    # before answering (slow, and shows "steps" the user doesn't want). The
    # "/no_think" directive turns that off so it answers directly and fast.
    if not OLLAMA_THINK and "qwen3" in selected_model.lower():
        content = f"{content}\n\n/no_think"

    user_message: dict[str, Any] = {
        "role": "user",
        "content": content,
    }

    if images:
        user_message["images"] = images

    payload: dict[str, Any] = {
        "model": selected_model,
        "stream": True,
        "keep_alive": OLLAMA_KEEP_ALIVE,
        "messages": [
            {"role": "system", "content": system_prompt},
            user_message,
        ],
        "options": {
            "temperature": temperature,
            "num_ctx": OLLAMA_NUM_CTX,
            "num_predict": OLLAMA_NUM_PREDICT,
        },
        "think": OLLAMA_THINK,
    }

    try:
        with requests.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json=payload,
            timeout=request_timeout,
            stream=True,
        ) as response:
            response.raise_for_status()

            for line in response.iter_lines(decode_unicode=True):
                if not line:
                    continue

                try:
                    chunk = json.loads(line)
                except ValueError:
                    continue

                if not isinstance(chunk, dict):
                    continue

                if chunk.get("error"):
                    raise OllamaUnavailable(str(chunk.get("error")))

                message = chunk.get("message") or {}

                thinking = message.get("thinking")
                if thinking:
                    yield ("thinking", thinking)

                content = message.get("content")
                if content:
                    yield ("content", content)

                if chunk.get("done"):
                    break

    except requests.Timeout as exc:
        raise OllamaUnavailable(
            "Ollama timed out while generating a response."
        ) from exc
    except (requests.RequestException, ValueError) as exc:
        raise OllamaUnavailable(str(exc)) from exc
