# -*- coding: utf-8 -*-
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import unittest

from app import app


class AppRuntimeTests(unittest.TestCase):
    def test_core_routes_are_registered(self):
        rules = {rule.rule for rule in app.url_map.iter_rules()}
        self.assertIn('/api/user/status', rules)
        self.assertIn('/generate-script', rules)
        self.assertIn('/generate-title', rules)
        self.assertIn('/synthesize-audio', rules)
        self.assertIn('/history', rules)

    def test_user_status_endpoint_returns_ok(self):
        client = app.test_client()
        response = client.get('/api/user/status')
        self.assertEqual(200, response.status_code)
        data = response.get_json()
        self.assertIn('isLoggedIn', data)


if __name__ == '__main__':
    unittest.main()
