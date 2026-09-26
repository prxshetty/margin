import unittest

from fastapi.testclient import TestClient

from api.main import app


class TestHarnessStaticModels(unittest.TestCase):
    def test_codex_lists_current_gpt6_models(self):
        res = TestClient(app).get("/api/harnesses/codex/models")

        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["manual"])
        self.assertEqual(
            [m["id"] for m in res.json()["models"]],
            ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"],
        )

    def test_claude_code_lists_opus_5_5(self):
        res = TestClient(app).get("/api/harnesses/claude-code/models")

        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["manual"])
        self.assertIn("claude-opus-5-5", [m["id"] for m in res.json()["models"]])


if __name__ == "__main__":
    unittest.main()
