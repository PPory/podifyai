import sys
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app import app
from podifyai import services


class UrlExtractionRuntimeTests(unittest.TestCase):
    def test_url_fetch_defaults_are_defined(self):
        self.assertIsInstance(services.DEFAULT_UA, str)
        self.assertTrue(services.DEFAULT_UA)
        self.assertIsInstance(services.UPSTREAM_TIMEOUT, int)
        self.assertGreater(services.UPSTREAM_TIMEOUT, 0)
        self.assertIsInstance(services.MIN_ARTICLE_CHARS, int)
        self.assertGreater(services.MIN_ARTICLE_CHARS, 0)
        self.assertIsInstance(services.ALLOW_TEXT_MIRROR, bool)
        self.assertEqual(services.DEFAULT_UA, services.HTTP_HEADERS["user-agent"])

    @patch("podifyai.services.resolve_canonical_or_amp", side_effect=lambda url: url)
    @patch("podifyai.services.resolve_special", side_effect=lambda url: url)
    @patch("podifyai.services.requests.get")
    def test_smart_fetch_html_returns_direct_html(self, mock_get, _resolve_special, _resolve_canonical):
        mock_get.return_value = SimpleNamespace(
            ok=True,
            status_code=200,
            headers={"content-type": "text/html; charset=utf-8"},
            text=f"<html><body><article>{'正文' * 150}</article></body></html>",
            url="https://example.com/post",
        )

        result = services.smart_fetch_html("https://example.com/post")

        self.assertTrue(result["ok"])
        self.assertEqual("direct", result["strategy"])
        self.assertEqual("https://example.com/post", result["url"])
        self.assertFalse(result["mirrored"])

    def test_extract_from_url_returns_json_when_internal_error_occurs(self):
        client = app.test_client()
        with patch("podifyai.content._extract_url_payload", side_effect=RuntimeError("boom")):
            response = client.post("/api/extract_from_url", json={"url": "https://example.com/post"})

        self.assertEqual(500, response.status_code)
        data = response.get_json()
        self.assertEqual("INTERNAL_ERROR", data["error_type"])
        self.assertFalse(data["ok"])

    def test_extract_from_url_returns_network_error_when_fetch_fails(self):
        client = app.test_client()
        with patch(
            "podifyai.content.smart_fetch_html",
            return_value={
                "ok": False,
                "strategy": "direct",
                "status": 0,
                "url": "https://example.com/post",
                "html": "",
                "mirrored": False,
                "error_type": "NETWORK_ERROR",
            },
        ):
            response = client.post("/api/extract_from_url", json={"url": "https://example.com/post"})

        self.assertEqual(422, response.status_code)
        data = response.get_json()
        self.assertFalse(data["ok"])
        self.assertEqual("NETWORK_ERROR", data["error_type"])
        self.assertEqual("direct", data["strategy"])
        self.assertEqual(0, data["status"])


if __name__ == "__main__":
    unittest.main()
