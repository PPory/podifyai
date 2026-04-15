import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services import API_KEYS, get_siliconflow_client


def main():
    old_key = API_KEYS.get('siliconflow_key')
    old_base = API_KEYS.get('siliconflow_base')
    try:
        API_KEYS['siliconflow_key'] = 'smoke-key'
        API_KEYS['siliconflow_base'] = 'https://example.com/v1'
        client = get_siliconflow_client()
        print(json.dumps({'ok': client is not None, 'base_url': str(client.base_url)}, ensure_ascii=False))
    finally:
        API_KEYS['siliconflow_key'] = old_key
        API_KEYS['siliconflow_base'] = old_base


if __name__ == '__main__':
    main()
