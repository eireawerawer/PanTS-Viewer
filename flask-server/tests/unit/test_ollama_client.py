import pytest

import services.ollama_client as ollama_client


def test_chat_structured_json_sends_schema_and_image_messages(monkeypatch):
    captured = {}

    def fake_post_chat(payload, timeout):
        captured["payload"] = payload
        captured["timeout"] = timeout
        return {
            "message": {
                "content": '{"classification":"undistorted","confidence":0.9,"reasons":[]}'
            }
        }

    monkeypatch.setattr(ollama_client, "_post_chat", fake_post_chat)
    schema = {
        "type": "object",
        "properties": {"classification": {"type": "string"}},
    }
    messages = [
        {
            "role": "user",
            "content": "inspect",
            "images": ["base64-image"],
        }
    ]

    result = ollama_client.chat_structured_json(
        model="qwen3-vl:4b",
        messages=messages,
        schema=schema,
        timeout=9,
        temperature=0,
        seed=42,
    )

    assert result["classification"] == "undistorted"
    assert captured["timeout"] == 9
    assert captured["payload"]["messages"] == messages
    assert captured["payload"]["format"] == schema
    assert captured["payload"]["options"]["temperature"] == 0
    assert captured["payload"]["options"]["seed"] == 42


def test_chat_structured_json_requires_object_schema():
    with pytest.raises(ValueError, match="object schema"):
        ollama_client.chat_structured_json(
            model="qwen3-vl:4b",
            messages=[{"role": "user", "content": "inspect"}],
            schema={"type": "array"},
        )
