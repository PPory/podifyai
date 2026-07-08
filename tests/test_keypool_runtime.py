# -*- coding: utf-8 -*-
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import unittest
from unittest.mock import patch

from podifyai.services import resolve_title_from_content


class TitleResolutionTests(unittest.TestCase):
    @patch('podifyai.services.generate_title_with_gemini', return_value='模型生成标题')
    def test_manual_input_prefers_generated_title(self, mock_generate):
        title = resolve_title_from_content(
            explicit_title='',
            source_title='',
            original_input='这是一段用户直接粘贴的长文本内容，用来验证标题优先走模型生成。',
            script_content='[S1] 这是一段用户直接粘贴的长文本内容，用来验证标题优先走模型生成。',
            input_type='manual',
        )
        self.assertEqual('模型生成标题', title)
        mock_generate.assert_called_once()

    @patch('podifyai.services.generate_title_with_gemini', side_effect=RuntimeError('boom'))
    def test_manual_input_falls_back_when_generation_fails(self, mock_generate):
        title = resolve_title_from_content(
            explicit_title='',
            source_title='',
            original_input='用于回退的标题文本',
            script_content='[S1] 用于回退的标题文本',
            input_type='manual',
        )
        self.assertEqual('用于回退的标题文本', title)
        mock_generate.assert_called_once()

    @patch('podifyai.services.generate_title_with_gemini')
    def test_real_source_title_skips_generation(self, mock_generate):
        title = resolve_title_from_content(
            explicit_title='',
            source_title='文章真实标题',
            original_input='https://example.com/post',
            script_content='[S1] 这里是脚本内容',
            input_type='url',
        )
        self.assertEqual('文章真实标题', title)
        mock_generate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
