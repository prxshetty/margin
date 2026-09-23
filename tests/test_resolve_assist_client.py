import unittest
from unittest.mock import patch

from fastapi import HTTPException

from api.routers import assist


class FakeClient:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


def settings_with(active_endpoint, endpoints):
    return {
        "active_endpoint": active_endpoint,
        "endpoints": endpoints,
        "is_thinking": True,
    }


class TestResolveSimpleAssistClient(unittest.TestCase):

    def resolve(self, settings):
        with patch.object(assist.storage, "get_settings", return_value=settings), \
             patch.object(assist.llm, "LLMClient", FakeClient):
            return assist._resolve_simple_assist_client()

    def test_valid_endpoint_builds_client_from_settings(self):
        ep = {"url": "http://localhost:1234/v1", "api_key": "k",
              "model": "m", "is_thinking": False, "custom_thinking_tags": []}
        client = self.resolve(settings_with("local", {"local": ep}))
        self.assertEqual(client.kwargs["model"], "m")
        self.assertEqual(client.kwargs["base_url"], "http://localhost:1234/v1")
        self.assertEqual(client.kwargs["api_key"], "k")
        self.assertFalse(client.kwargs["is_thinking"])

    def test_no_endpoint_raises_clear_error(self):
        with self.assertRaises(HTTPException) as ctx:
            self.resolve(settings_with(None, {}))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("No endpoint configured", ctx.exception.detail)

    def test_stale_endpoint_id_raises_same_error(self):
        with self.assertRaises(HTTPException) as ctx:
            self.resolve(settings_with("deleted", {"other": {"model": "m"}}))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("No endpoint configured", ctx.exception.detail)


if __name__ == "__main__":
    unittest.main()
