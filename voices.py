from flask import Blueprint

from decorators import admin_required
from extensions import db
from models import UserAPIKey, Voice
from services import *

bp = Blueprint('voices', __name__)

@bp.route('/voices', methods=['GET'])
@login_required
def get_user_voices():
    """获取当前登录用户可用的音色列表（包括全站共享和个人音色），不再区分type"""
    
    # 获取全站共享音色（不再按type过滤）
    global_voices = Voice.query.filter_by(is_global=True).order_by(Voice.id.desc()).all()
    
    # 获取用户个人音色（不再按type过滤）
    personal_voices = Voice.query.filter_by(owner=current_user, is_global=False).order_by(Voice.id.desc()).all()
    
    # 将 SQLAlchemy 对象转换为字典列表
    voices_data = {
        'global_voices': [{
            'id': v.id,
            'name': v.name,
            'text': v.text,
            'audio_path': v.audio_path,
            'type': v.type,
            'description': v.description,
            'is_global': v.is_global,
            'owner_username': v.owner.username if v.owner else 'System',
            'preview_url': f"/api/voices/{v.id}/preview"
        } for v in global_voices],
        'personal_voices': [{
            'id': v.id,
            'name': v.name,
            'text': v.text,
            'audio_path': v.audio_path,
            'type': v.type,
            'description': v.description,
            'is_global': v.is_global,
            'owner_username': v.owner.username,
            'preview_url': f"/api/voices/{v.id}/preview"
        } for v in personal_voices]
    }
    
    return jsonify(voices_data)

_ALLOWED_AUDIO_EXTS = {'.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac'}

def _validate_audio_upload(file_storage):
    """Validate an uploaded audio file.

    Returns (safe_filename, ext) on success, raises ValueError with a
    user-facing message on failure.
    """
    if not file_storage or not file_storage.filename:
        raise ValueError('缺少音频文件')
    safe = secure_filename(file_storage.filename)
    ext = Path(safe).suffix.lower()
    if not ext:
        ext = '.wav'
    if ext not in _ALLOWED_AUDIO_EXTS:
        raise ValueError(f'不支持的音频格式 {ext}，请上传 MP3、WAV、M4A、FLAC、OGG 或 AAC 文件')
    return safe, ext


@bp.route('/voices', methods=['POST'])
@login_required
def add_user_voice():
    """为当前登录用户添加一个新音色（需要付费权限）"""
    try:
        # 检查用户是否有付费权限（管理员免检查）
        if not current_user.is_admin and not current_user.has_premium:
            return jsonify({'error': '添加个人音色需要升级到付费版本', 'premium_required': True}), 402
        
        if 'referenceAudio' not in request.files:
            return jsonify({'error': '缺少参考音频文件'}), 400
        
        voice_name = request.form.get('voiceName')
        reference_text = request.form.get('referenceText')
        voice_type = request.form.get('voiceType', 'single')  # 默认为single类型
        voice_description = request.form.get('voiceDescription', '')
        reference_audio = request.files.get('referenceAudio')
        try:
            _, audio_ext = _validate_audio_upload(reference_audio)
        except ValueError as ve:
            return jsonify({'error': str(ve)}), 400

        # 单人音色自动修复：发现对话痕迹就净化
        if voice_type == 'single':
            original_text = reference_text
            reference_text = _autofix_single_voice_text(reference_text)
            if original_text != reference_text:
                logging.info(f"单人音色文本自动净化: '{voice_name}' - 原文: '{original_text}' -> 净化后: '{reference_text}'")

        if not all([voice_name, reference_text]):
            return jsonify({'error': '缺少必要参数'}), 400

        # 检查音色名称唯一性
        if current_user.is_admin:
            # 管理员检查全站共享音色名称唯一性
            if Voice.query.filter_by(name=voice_name, is_global=True).first():
                return jsonify({'error': f'全站共享音色名称 "{voice_name}" 已存在'}), 409
        else:
            # 普通用户检查个人音色名称唯一性
            if Voice.query.filter_by(owner=current_user, name=voice_name, is_global=False).first():
                return jsonify({'error': f'音色名称 "{voice_name}" 已存在'}), 409

        # 保存音频文件
        VOICES_AUDIO_DIR = Path('voices_audio/')
        if not VOICES_AUDIO_DIR.exists():
            VOICES_AUDIO_DIR.mkdir(exist_ok=True)
        
        audio_filename = f"{uuid.uuid4()}{audio_ext}"
        audio_path = VOICES_AUDIO_DIR / audio_filename

        # 保存音频文件
        reference_audio.save(audio_path)

        # 验证文件是否保存成功
        if not audio_path.exists() or audio_path.stat().st_size == 0:
            return jsonify({'error': '音频文件保存失败'}), 500

        logging.info(f"音频文件保存成功: {audio_path}, 大小: {audio_path.stat().st_size} bytes")

        # 清洗参考音频（去掉首尾空气声，限制时长）
        clean_reference_wav(str(audio_path), str(audio_path))

        # 再次验证清洗后的文件
        if not audio_path.exists() or audio_path.stat().st_size == 0:
            return jsonify({'error': '音频文件处理失败'}), 500

        # 创建新音色记录并存入数据库
        # 如果是管理员，默认创建全站共享音色
        new_voice = Voice(
            name=voice_name,
            text=reference_text,
            audio_path=str(audio_path),
            type=voice_type,
            description=voice_description,
            owner=current_user,
            is_global=current_user.is_admin,  # 管理员添加的音色自动设为全站共享
            source_model=SF_TTS_MODEL  # 设置源模型
        )
        db.session.add(new_voice)
        db.session.commit()

        # 尝试上传到SiliconFlow获取预置音色URI
        try:
            # 获取用户的API密钥
            user_api_keys = UserAPIKey.query.filter_by(user_id=current_user.id).first()
            if user_api_keys and user_api_keys.siliconflow_key:
                api_key = user_api_keys.siliconflow_key
                base_url = user_api_keys.siliconflow_base
            else:
                # 使用全局配置
                api_key = API_KEYS.get('siliconflow_key')
                base_url = API_KEYS.get('siliconflow_base')
            
            if api_key and base_url:
                voice_uri = upload_voice_to_siliconflow(new_voice, api_key, base_url)
                if voice_uri:
                    new_voice.voice_uri = voice_uri
                    db.session.commit()
                    logging.info(f"成功上传音色到SiliconFlow: {voice_name} -> {voice_uri}")
                else:
                    logging.warning(f"上传音色到SiliconFlow失败，将使用动态references: {voice_name}")
            else:
                logging.warning(f"未找到SiliconFlow API密钥，将使用动态references: {voice_name}")
        except Exception as upload_e:
            logging.error(f"上传音色到SiliconFlow异常: {upload_e}", exc_info=True)
            # 上传失败不影响音色创建，继续使用动态references

        logging.info(f"用户 '{current_user.username}' 添加了新音色: {voice_name}")
        return jsonify({'message': '音色保存成功'}), 201

    except Exception as e:
        db.session.rollback()
        logging.error(f"添加音色失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@bp.route('/voices/<int:voice_id>', methods=['PUT'])
@login_required
def update_user_voice(voice_id):
    """更新当前登录用户的指定音色"""
    voice = Voice.query.get_or_404(voice_id)
    
    # 权限检查：只能编辑自己的音色，或者管理员可以编辑全站共享音色
    if voice.owner != current_user and not (current_user.is_admin and voice.is_global):
        return jsonify({'error': '无权操作该音色'}), 403

    new_name = request.form.get('newName', '').strip()
    if new_name != voice.name and Voice.query.filter_by(owner=current_user, name=new_name).first():
        return jsonify({'error': f'音色名称 "{new_name}" 已存在'}), 409

    voice.name = new_name
    new_text = request.form.get('newText', '').strip()
    
    # 单人音色自动修复：发现对话痕迹就净化
    if voice.type == 'single':
        original_text = new_text
        new_text = _autofix_single_voice_text(new_text)
        if original_text != new_text:
            logging.info(f"单人音色文本自动净化: '{voice.name}' - 原文: '{original_text}' -> 净化后: '{new_text}'")
    
    voice.text = new_text
    voice.description = request.form.get('newDescription', '').strip()

    if 'newReferenceAudio' in request.files:
        new_audio_file = request.files['newReferenceAudio']
        if new_audio_file and new_audio_file.filename:
            try:
                _, new_audio_ext = _validate_audio_upload(new_audio_file)
            except ValueError as ve:
                return jsonify({'error': str(ve)}), 400

            # 删除旧音频文件
            try:
                old_audio_path = Path(voice.audio_path)
                if old_audio_path.exists():
                    old_audio_path.unlink()
            except Exception as e:
                logging.error(f"删除旧音频文件失败: {e}")

            # 保存新音频文件
            VOICES_AUDIO_DIR = Path('voices_audio/')
            if not VOICES_AUDIO_DIR.exists():
                VOICES_AUDIO_DIR.mkdir(exist_ok=True)

            audio_filename = f"user_{current_user.id}_{uuid.uuid4()}{new_audio_ext}"
            audio_path = VOICES_AUDIO_DIR / audio_filename
            new_audio_file.save(audio_path)

            # 更新数据库中的音频路径
            voice.audio_path = str(audio_path)
            
            # 音频文件更新后，重新上传到SiliconFlow获取新的voice_uri
            try:
                # 获取用户的API密钥
                user_api_keys = UserAPIKey.query.filter_by(user_id=current_user.id).first()
                if user_api_keys and user_api_keys.siliconflow_key:
                    api_key = user_api_keys.siliconflow_key
                    base_url = user_api_keys.siliconflow_base
                else:
                    # 使用全局配置
                    api_key = API_KEYS.get('siliconflow_key')
                    base_url = API_KEYS.get('siliconflow_base')
                
                if api_key and base_url:
                    voice_uri = upload_voice_to_siliconflow(voice, api_key, base_url)
                    if voice_uri:
                        voice.voice_uri = voice_uri
                        logging.info(f"成功重新上传音色到SiliconFlow: {voice.name} -> {voice_uri}")
                    else:
                        logging.warning(f"重新上传音色到SiliconFlow失败，将使用动态references: {voice.name}")
                else:
                    logging.warning(f"未找到SiliconFlow API密钥，将使用动态references: {voice.name}")
            except Exception as upload_e:
                logging.error(f"重新上传音色到SiliconFlow异常: {upload_e}", exc_info=True)
                # 上传失败不影响音色更新

    db.session.commit()
    logging.info(f"用户 '{current_user.username}' 更新了音色: {voice.name}")
    return jsonify({'message': '音色更新成功'})

@bp.route('/voices/<int:voice_id>', methods=['DELETE'])
@login_required
def delete_user_voice(voice_id):
    """删除当前登录用户的指定音色"""
    voice = Voice.query.get_or_404(voice_id)
    
    # 权限检查：只能删除自己的音色，或者管理员可以删除全站共享音色
    if voice.owner != current_user and not (current_user.is_admin and voice.is_global):
        return jsonify({'error': '无权操作该音色'}), 403

    # 删除音频文件
    try:
        audio_file = Path(voice.audio_path)
        if audio_file.exists():
            audio_file.unlink()
    except Exception as e:
        logging.error(f"删除音频文件失败: {e}")
    
    db.session.delete(voice)
    db.session.commit()
    logging.info(f"用户 '{current_user.username}' 删除了音色: {voice.name}")
    return jsonify({'message': '音色删除成功'})

# --- 新增：管理员音色管理API ---

@bp.route('/admin/voices', methods=['POST'])
@login_required
@admin_required
def add_global_voice():
    """管理员添加全站共享音色"""
    try:
        if 'referenceAudio' not in request.files:
            return jsonify({'error': '缺少参考音频文件'}), 400
        
        voice_name = request.form.get('voiceName')
        reference_text = request.form.get('referenceText')
        voice_type = request.form.get('voiceType', 'single')  # 默认为single类型
        voice_description = request.form.get('voiceDescription', '')
        reference_audio = request.files.get('referenceAudio')
        try:
            _, audio_ext = _validate_audio_upload(reference_audio)
        except ValueError as ve:
            return jsonify({'error': str(ve)}), 400

        if not all([voice_name, reference_text]):
            return jsonify({'error': '缺少必要参数'}), 400

        # 检查全站音色名称唯一性
        if Voice.query.filter_by(name=voice_name, is_global=True).first():
            return jsonify({'error': f'全站共享音色名称 "{voice_name}" 已存在'}), 409

        # 保存音频文件
        VOICES_AUDIO_DIR = Path('voices_audio/')
        if not VOICES_AUDIO_DIR.exists():
            VOICES_AUDIO_DIR.mkdir(exist_ok=True)

        audio_filename = f"global_{uuid.uuid4()}{audio_ext}"
        audio_path = VOICES_AUDIO_DIR / audio_filename
        
        # 保存音频文件
        reference_audio.save(audio_path)
        
        # 验证文件是否保存成功
        if not audio_path.exists() or audio_path.stat().st_size == 0:
            return jsonify({'error': '音频文件保存失败'}), 500
        
        logging.info(f"音频文件保存成功: {audio_path}, 大小: {audio_path.stat().st_size} bytes")
        
        # ✅ 新增：清洗参考音频（去掉首尾空气声，限制时长）
        clean_reference_wav(str(audio_path), str(audio_path))
        
        # 再次验证清洗后的文件
        if not audio_path.exists() or audio_path.stat().st_size == 0:
            return jsonify({'error': '音频文件处理失败'}), 500

        # 创建全站共享音色记录
        new_voice = Voice(
            name=voice_name,
            text=reference_text,
            audio_path=str(audio_path),
            type=voice_type,
            description=voice_description,
            owner=current_user,
            is_global=True  # 标记为全站共享
        )
        db.session.add(new_voice)
        db.session.commit()

        logging.info(f"管理员 '{current_user.username}' 添加了全站共享音色: {voice_name}")
        return jsonify({'message': '全站共享音色添加成功'}), 201

    except Exception as e:
        db.session.rollback()
        logging.error(f"添加全站共享音色失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@bp.route('/admin/voices/<int:voice_id>', methods=['PUT'])
@login_required
@admin_required
def update_global_voice(voice_id):
    """管理员更新全站共享音色"""
    try:
        voice = Voice.query.get_or_404(voice_id)
        if not voice.is_global:
            return jsonify({'error': '只能编辑全站共享音色'}), 403

        new_name = request.form.get('newName', '').strip()
        if new_name and new_name != voice.name:
            # 检查新名称是否已被其他全站音色使用
            if Voice.query.filter_by(name=new_name, is_global=True).filter(Voice.id != voice_id).first():
                return jsonify({'error': f'音色名称 "{new_name}" 已存在'}), 409
            voice.name = new_name

        voice.text = request.form.get('newText', voice.text).strip()
        voice.description = request.form.get('newDescription', voice.description).strip()

        if 'newReferenceAudio' in request.files:
            new_audio_file = request.files['newReferenceAudio']
            if new_audio_file.filename:
                try:
                    _, new_audio_ext = _validate_audio_upload(new_audio_file)
                except ValueError as ve:
                    return jsonify({'error': str(ve)}), 400

                # 删除旧音频文件
                try:
                    old_audio_path = Path(voice.audio_path)
                    if old_audio_path.exists():
                        old_audio_path.unlink()
                except Exception as e:
                    logging.warning(f"删除旧音频文件失败: {e}")

                # 保存新音频文件
                audio_filename = f"global_{uuid.uuid4()}{new_audio_ext}"
                audio_path = Path('voices_audio/') / audio_filename
                new_audio_file.save(audio_path)
                voice.audio_path = str(audio_path)

        db.session.commit()
        logging.info(f"管理员 '{current_user.username}' 更新了全站共享音色: {voice.name}")
        return jsonify({'message': '全站共享音色更新成功'})

    except Exception as e:
        db.session.rollback()
        logging.error(f"更新全站共享音色失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@bp.route('/admin/voices/<int:voice_id>', methods=['DELETE'])
@login_required
@admin_required
def delete_global_voice(voice_id):
    """管理员删除全站共享音色"""
    try:
        voice = Voice.query.get_or_404(voice_id)
        if not voice.is_global:
            return jsonify({'error': '只能删除全站共享音色'}), 403

        # 删除音频文件
        try:
            audio_file = Path(voice.audio_path)
            if audio_file.exists():
                audio_file.unlink()
        except Exception as e:
            logging.error(f"删除音频文件失败: {e}")
        
        voice_name = voice.name
        db.session.delete(voice)
        db.session.commit()
        
        logging.info(f"管理员 '{current_user.username}' 删除了全站共享音色: {voice_name}")
        return jsonify({'message': '全站共享音色删除成功'})

    except Exception as e:
        db.session.rollback()
        logging.error(f"删除全站共享音色失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@bp.route('/admin/voices', methods=['GET'])
@login_required
@admin_required
def get_admin_voices():
    """管理员获取所有音色列表（用于管理界面）"""
    try:
        # 获取全站共享音色（不再按type过滤）
        global_voices = Voice.query.filter_by(is_global=True).order_by(Voice.id.desc()).all()
        
        # 获取用户个人音色统计（可选）
        personal_voices_count = Voice.query.filter_by(is_global=False).count()
        
        voices_data = {
            'global_voices': [{
                'id': v.id,
                'name': v.name,
                'text': v.text,
                'audio_path': v.audio_path,
                'type': v.type,
                'description': v.description,
                'is_global': v.is_global,
                'owner_username': v.owner.username,
                'created_at': v.id,  # 使用ID作为创建顺序的简单指示
                'preview_url': f"/api/voices/{v.id}/preview"
            } for v in global_voices],
            'stats': {
                'global_voices_count': len(global_voices),
                'personal_voices_count': personal_voices_count
            }
        }
        
        return jsonify(voices_data)

    except Exception as e:
        logging.error(f"获取管理员音色列表失败: {e}", exc_info=True)
        return jsonify({'error': str(e)}), 500

# --- 新增：音色试听预览 API ---


@bp.get("/api/voices/<int:voice_id>/preview")
@login_required
def voice_preview(voice_id: int):
    """直接播放上传的音频文件作为预览"""
    from werkzeug.exceptions import Forbidden
    
    v = Voice.query.get_or_404(voice_id)

    # 权限：本人/全站共享/管理员可播
    if not (v.user_id == current_user.id or v.is_global or current_user.is_admin):
        raise Forbidden("no permission to preview this voice")

    try:
        # 首先检查原始音频文件是否存在
        original_path = Path(v.audio_path)
        if not original_path.exists():
            logging.error(f"音色 {voice_id} 的音频文件不存在: {v.audio_path}")
            return jsonify({"error": "音频文件不存在，请重新上传"}), 404
        
        if original_path.stat().st_size == 0:
            logging.error(f"音色 {voice_id} 的音频文件为空: {v.audio_path}")
            return jsonify({"error": "音频文件损坏，请重新上传"}), 404
        
        preview_path = ensure_preview_file(v)  # 关键：用上传文件做预览源
    except FileNotFoundError:
        logging.error(f"音色 {voice_id} 预览文件生成失败: {v.audio_path}")
        return jsonify({"error": "预览音频生成失败"}), 404
    except Exception as e:
        logging.error(f"音色 {voice_id} 预览处理失败: {e}", exc_info=True)
        return jsonify({"error": "预览处理失败"}), 500

    # 根据文件扩展名设置正确的MIME类型，支持更多音频格式
    suffix = preview_path.suffix.lower()
    if suffix == '.mp3':
        mimetype = "audio/mpeg"
    elif suffix == '.wav':
        mimetype = "audio/wav"
    elif suffix in ['.m4a', '.mp4']:
        mimetype = "audio/mp4"
    elif suffix == '.ogg':
        mimetype = "audio/ogg"
    elif suffix == '.flac':
        mimetype = "audio/flac"
    elif suffix == '.aac':
        mimetype = "audio/aac"
    elif suffix == '.webm':
        mimetype = "audio/webm"
    elif suffix == '.opus':
        mimetype = "audio/opus"
    else:
        # 对于未知格式，使用通用的二进制流类型，让浏览器自动检测
        mimetype = "application/octet-stream"
    
    # 禁用Range请求以避免416错误，直接返回完整文件
    response = send_file(
        preview_path,
        mimetype=mimetype,
        as_attachment=False,
        conditional=False,  # 禁用Range请求
        download_name=preview_path.name
    )
    
    # 添加HTTP头来确保浏览器正确处理音频文件
    response.headers['Accept-Ranges'] = 'none'  # 禁用Range请求
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    
    # 对于某些格式，添加额外的头信息
    if suffix in ['.wav', '.flac']:
        response.headers['Content-Type'] = mimetype + '; charset=binary'
    
    return response


# --- 新增：基于数据库的用户专属历史记录 API ---

