import json
import pathlib
import sys
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from podifyai.services import resolve_title_from_content


def main():
    with patch('podifyai.services.generate_title_with_gemini', return_value='Smoke 标题'):
        title = resolve_title_from_content(
            explicit_title='',
            source_title='',
            original_input='这是一次本地 smoke 检查，用于确认标题优先走模型生成。',
            script_content='[S1] 这是一次本地 smoke 检查，用于确认标题优先走模型生成。',
            input_type='manual',
        )

    print(json.dumps({'ok': title == 'Smoke 标题', 'title': title}, ensure_ascii=False))


if __name__ == '__main__':
    main()
