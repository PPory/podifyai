from flask import Blueprint

from .extensions import db
from .models import CreditTxn, History, UserAPIKey
from .services import *

bp = Blueprint('tts', __name__)

@bp.route('/generate-title', methods=['POST'])
@login_required
def generate_title_api():
    """API接口：为给定的脚本内容生成一个标题"""
    try:
        data = request.json
        script_content = data.get('script')
        if not script_content:
            return jsonify({"error": "脚本内容不能为空"}), 400
        
        # 注意：这里我们硬编码了模型，也可以从前端传递
        title = resolve_title_from_content(
            original_input=script_content,
            script_content=script_content,
            input_type='text',
        )
        return jsonify({"title": title})

    except Exception as e:
        logging.error(f"/generate-title 接口出错: {e}", exc_info=True)
        return jsonify({"error": f"标题生成失败: {str(e)}"}), 500

# --- 新增：基于数据库的用户专属音色库 API ---


def _normalize_dialogue_tags(s: str) -> str:
    """规范化对话标签，将各种格式统一为 [S1]/[S2] 格式"""
    import re
    if not s:
        return ''
    
    lines = []
    for line in s.replace('\r\n', '\n').split('\n'):
        t = line.strip()
        if not t:
            lines.append('')
            continue
            
        # 匹配各种格式的说话人标签
        m = re.match(r'^\s*\[?\s*S\s*([12])\s*\]?\s*[:：、.\-]?\s*', t, flags=re.I)
        if m:
            # 提取标签后的内容
            content_after_tag = t[m.end():]
            # 重新构造为标准格式
            t = f'[S{m.group(1)}]' + content_after_tag
        lines.append(t)
    
    fixed = '\n'.join(lines)
    # 去重标签 [S1][S1] → [S1]
    fixed = re.sub(r'\[S([12])\]\s*\[S\1\]\s*', r'[S\1] ', fixed)
    return fixed


def _clean_title_input(title: str | None) -> str:
    return clean_generated_title(title)


def _needs_generated_title(title: str | None) -> bool:
    return is_placeholder_title(title)


@bp.route('/synthesize-audio', methods=['POST'])
@login_required
def synthesize_audio_api():
    """核心功能：调用SiliconFlow API合成音频，并为当前用户创建一条历史记录"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "请求体不能为空"}), 400
            
        script_content = data.get('script')
        # 后端兜底再规范化：即使前端已修，后端入口也做一次规范化
        script_content = _normalize_dialogue_tags(script_content)
        
        # 健壮性检查：脚本经一次规范化后如果还是空，直接报错
        if not script_content or not script_content.strip():
            return jsonify({"error": "脚本为空"}), 400
        
        # 新的音色参数：优先使用ID，向后兼容名称
        mode = data.get('mode')
        title = _clean_title_input(data.get('title'))
        
        # 获取音色ID（只使用ID，禁止兜底用名字）
        voice_id = data.get('voice_id')
        s1_voice_id = data.get('s1_voice_id')
        s2_voice_id = data.get('s2_voice_id')
        
        # 单人模式：强制上 [S1] 标签，确保与 references 同构
        if mode == 'single':
            script_content = ensure_single_tagging(script_content)
            # 兜底：把任何 S2 痕迹替换为 S1（非行首也处理）
            script_content = re.sub(r'\[S2\]', '[S1]', script_content)
        
        # 新增：获取原始输入内容
        original_input = data.get('originalInput') or data.get('script')
        input_type = data.get('inputType') or 'manual'
        source_url = data.get('sourceUrl') or ''
        source_title = clean_generated_title(data.get('sourceTitle'))
        
        # 参数验证：根据模式检查必要参数
        if mode == 'role':
            # 对话模式使用双音色
            if not all([script_content, s1_voice_id, s2_voice_id, mode]):
                return jsonify({"error": "缺少必要参数：script, s1_voice_id, s2_voice_id, mode"}), 400
        else:
            # 单人模式使用单个音色
            if not all([script_content, voice_id, mode]):
                return jsonify({"error": "缺少必要参数：script, voice_id, mode"}), 400

        # 1. 获取用户专属的API密钥
        user_api_keys = UserAPIKey.query.filter_by(user_id=current_user.id).first()
        if not user_api_keys or not user_api_keys.siliconflow_key:
            # This is a placeholder. We will soon build a UI for users to set their keys.
            # For now, we fall back to the globally configured key for testing.
            if not API_KEYS.get('siliconflow_key'):
                 return jsonify({"error": "未找到可用的SiliconFlow API密钥"}), 400
            siliconflow_key = API_KEYS.get('siliconflow_key')
            siliconflow_base = API_KEYS.get('siliconflow_base')
        else:
            siliconflow_key = user_api_keys.siliconflow_key
            siliconflow_base = user_api_keys.siliconflow_base

        if _needs_generated_title(title):
            logging.info("未提供有效标题，正在基于内容生成标题...")

        title = resolve_title_from_content(
            explicit_title=title,
            source_title=source_title,
            original_input=original_input,
            script_content=script_content,
            input_type=input_type,
        )

        if not source_title or source_title in GENERIC_SOURCE_TITLES:
            fallback_source_title = summarize_content_title(
                pick_title_source_text(original_input, script_content, input_type)
            )
            source_title = fallback_source_title or title

        # 2. 获取音色对象并验证权限
        voices = []
        voice_names_for_log = []
        
        if mode == 'role':
            # 对话模式：获取两个音色
            voice1 = get_voice_by_id_or_403(s1_voice_id)
            voice2 = get_voice_by_id_or_403(s2_voice_id)
            voices = [voice1, voice2]
            voice_names_for_log = [voice1.name, voice2.name]
        else:
            # 单人模式：获取一个音色
            voice = get_voice_by_id_or_403(voice_id)
            voices = [voice]
            voice_names_for_log = [voice.name]
        
        # 3. 初始化SiliconFlow客户端
        sf_client = OpenAI(api_key=siliconflow_key, base_url=siliconflow_base, timeout=60.0, max_retries=2)

        # 准备文件和目录
        history_id = str(uuid.uuid4())
        save_fmt = "mp3"
        audio_filename = f"history_{history_id}.{save_fmt}"
        audio_path = HISTORY_AUDIO_DIR / audio_filename
        
        # 记录使用的音色信息
        if mode == 'role':
            logging.info(f"用户 '{current_user.username}' 开始合成音频，使用双音色: {voice_names_for_log[0]} (S1), {voice_names_for_log[1]} (S2)")
        else:
            logging.info(f"用户 '{current_user.username}' 开始合成音频，使用音色: {voice_names_for_log[0]}")

        # 3.5. 检查用户积分余额
        if (current_user.credits or 0) < CREDITS_PER_AUDIO:
            return jsonify({
                "error": "积分不足",
                "required": CREDITS_PER_AUDIO,
                "current": current_user.credits or 0,
                "payment_required": True
            }), 402

        # 4. 调用SiliconFlow API进行音频合成
        # 优先使用预置音色URI，降级到动态references
        actual_voice_id_used = None
        actual_voice_uri_used = None
        
        try:
            # CosyVoice2 路径：按说话人分段合成，自动上传音色拿 speech:xxx URI
            logging.info(f"CosyVoice2 分段合成 | mode={mode} | voices={[v.name for v in voices]}")
            audio_data = tts_cosyvoice_per_turn(
                script_content, voices, mode, sf_client,
                siliconflow_key, siliconflow_base
            )
            actual_voice_id_used = voices[0].id
            actual_voice_uri_used = voices[0].voice_uri
        except Exception as tts_e:
            logging.error(f"TTS合成失败: {tts_e}", exc_info=True)
            return jsonify({"error": f"音频合成失败: {str(tts_e)}"}), 500

        # 5. 音频保存（CosyVoice2 输出已是 MP3，直接写入）
        with open(audio_path, "wb") as f:
            f.write(audio_data)
        logging.info(f"音频文件已保存至: {audio_path}")

        # 6. 计算音频时长 - 双保险逻辑，确保获取到可信时长
        duration_in_seconds = None
        try:
            # 优先尝试 mutagen
            audio = File(audio_path)
            if audio and audio.info:
                duration_in_seconds = audio.info.length
                logging.info(f"使用 mutagen 获取到原始时长: {duration_in_seconds} 秒")
        except Exception as e:
            logging.warning(f"Mutagen 获取时长失败: {e}，尝试使用 pydub 作为备用方案。")
            try:
                # Mutagen 失败后，尝试 pydub
                audio_segment = AudioSegment.from_file(audio_path)
                duration_in_seconds = len(audio_segment) / 1000.0  # pydub 以毫秒为单位
                logging.info(f"使用 pydub 获取到原始时长: {duration_in_seconds} 秒")
            except Exception as e2:
                logging.error(f"Pydub 获取时长也失败了: {e2}", exc_info=True)
                duration_in_seconds = 0
        
        # 兜底检查：确保时长不为 0/None
        if not duration_in_seconds or duration_in_seconds <= 0:
            logging.error(f"音频时长获取失败，文件路径: {audio_path}")
            # 尝试使用 ffprobe 作为最后的备用方案
            try:
                import subprocess
                result = subprocess.run([
                    'ffprobe', '-v', 'quiet', '-show_entries', 'format=duration',
                    '-of', 'csv=p=0', str(audio_path)
                ], capture_output=True, text=True, timeout=10)
                if result.returncode == 0 and result.stdout.strip():
                    duration_in_seconds = float(result.stdout.strip())
                    logging.info(f"使用 ffprobe 获取到原始时长: {duration_in_seconds} 秒")
                else:
                    raise Exception("ffprobe 命令执行失败")
            except Exception as ffprobe_e:
                logging.error(f"ffprobe 获取时长也失败了: {ffprobe_e}")
                # 如果所有方法都失败，设置一个默认值并记录警告
                duration_in_seconds = 30  # 默认30秒
                logging.warning(f"所有时长获取方法都失败，使用默认时长: {duration_in_seconds} 秒")
        
        logging.info(f"最终确定的音频时长: {duration_in_seconds} 秒")

        # 随机选择一个缩略图
        THUMBNAIL_DIR = Path(current_app.static_folder) / 'card-thumbnail'
        thumbnail_image = None
        if THUMBNAIL_DIR.exists():
            thumbnail_files = [f.name for f in THUMBNAIL_DIR.glob('*.jpg')] + [f.name for f in THUMBNAIL_DIR.glob('*.png')]
            if thumbnail_files:
                thumbnail_image = random.choice(thumbnail_files)

        # 7. 创建历史记录并原子化扣分（在同一事务中完成）
        # 确定保存的音色名称
        if mode == 'role':
            # 对话模式：保存双音色信息
            saved_voice_name = f"{voice_names_for_log[0]} + {voice_names_for_log[1]}"
        else:
            # 单人模式：保存单个音色名称
            saved_voice_name = voice_names_for_log[0]
            
        new_history_entry = History(
            id=history_id,
            user_id=current_user.id,
            title=title,
            script_full=script_content,
            audio_filename=audio_filename,
            timestamp=datetime.datetime.utcnow(),
            mode=mode,
            voice_name=saved_voice_name,
            duration=duration_in_seconds,
            play_count=0,
            thumbnail_filename=thumbnail_image,
            # 新增：保存原始输入信息
            original_input=original_input,
            input_type=input_type,
            # 新增：保存来源信息
            source_url=source_url,
            source_title=source_title,
            source_type=input_type,  # 使用input_type作为source_type
            # 新增：音色溯源字段
            voice_id_used=actual_voice_id_used,
            voice_uri_used=actual_voice_uri_used,
            owner=current_user
        )
        db.session.add(new_history_entry)
        
        # 原子化扣分：在同一事务中扣除用户积分
        current_user.credits = (current_user.credits or 0) - CREDITS_PER_AUDIO
        
        # 提交事务：如果任一步失败则回滚，不扣分不落库
        db.session.commit()

        logging.info(f"为用户 '{current_user.username}' 成功创建历史记录并扣除 {CREDITS_PER_AUDIO} 积分，剩余积分: {current_user.credits}")

        # 8. 返回与前端兼容的数据
        return jsonify({
            'id': new_history_entry.id,
            'title': new_history_entry.title,
            'script_full': new_history_entry.script_full,
            'audio_filename': new_history_entry.audio_filename,
            'timestamp': new_history_entry.timestamp.isoformat(),
            'mode': new_history_entry.mode,
            'voice_name': new_history_entry.voice_name,
            'duration': new_history_entry.duration,
            'play_count': new_history_entry.play_count,
            'thumbnail_filename': new_history_entry.thumbnail_filename,
            # 新增：返回原始输入信息
            'original_input': new_history_entry.original_input,
            'input_type': new_history_entry.input_type,
            # 新增：返回来源信息
            'source_url': new_history_entry.source_url,
            'source_title': new_history_entry.source_title,
            'source_type': new_history_entry.source_type,
            # 新增：返回最新积分余额，便于前端立即更新
            'credits': current_user.credits
        })

    except Exception as e:
        db.session.rollback()
        logging.error(f"音频合成API出错: {e}", exc_info=True)
        return jsonify({"error": f"音频合成失败: {str(e)}"}), 500

