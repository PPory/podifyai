import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app import app


def main():
    client = app.test_client()
    response = client.get('/api/user/status')
    payload = response.get_json() or {}
    print(json.dumps({'ok': response.status_code == 200, 'status': response.status_code, 'keys': sorted(payload.keys())}, ensure_ascii=False))


if __name__ == '__main__':
    main()
