from flask import Blueprint

from extensions import db
from models import History
from services import *

bp = Blueprint('history', __name__)

@bp.route('/history', methods=['GET'])
@login_required
def get_user_history():
    """获取当前登录用户的历史记录，按时间倒序"""
    history_items = History.query.filter_by(user_id=current_user.id).order_by(History.timestamp.desc()).all()
    
    history_data = [{
        'id': h.id,
        'title': h.title,
        'script_full': h.script_full, # 注意：未来可能优化为仅传预览
        'audio_filename': h.audio_filename,
        'timestamp': h.timestamp.isoformat(),
        'mode': h.mode,
        'voice_name': h.voice_name,
        'duration': h.duration,
        'play_count': h.play_count,
        'thumbnail_filename': h.thumbnail_filename,
        'source_title': h.source_title,
        'source_type': h.source_type,
        # 新增：原始输入字段
        'original_input': h.original_input,
        'input_type': h.input_type,
    } for h in history_items]
    
    resp = jsonify(history_data)
    resp.headers['Cache-Control'] = 'no-store'
    return resp

@bp.route('/history/<string:history_id>', methods=['DELETE'])
@login_required
def delete_user_history(history_id):
    """删除当前登录用户的指定历史记录"""
    history_item = History.query.get_or_404(history_id)
    if history_item.user_id != current_user.id:
        return jsonify({'error': '无权操作该记录'}), 403

    # 删除音频文件
    try:
        audio_file = HISTORY_AUDIO_DIR / history_item.audio_filename
        if audio_file.exists():
            audio_file.unlink()
    except Exception as e:
        logging.error(f"删除历史音频文件失败: {e}")

    db.session.delete(history_item)
    db.session.commit()
    logging.info(f"用户 '{current_user.username}' 删除了历史记录: {history_item.title}")
    return jsonify({'message': '历史记录删除成功'})

@bp.route('/history/play/<string:history_id>', methods=['POST'])
@login_required
def increment_play_count(history_id):
    """增加指定历史记录的播放次数"""
    history_item = History.query.get_or_404(history_id)
    if history_item.user_id != current_user.id:
         return jsonify({'error': '无权操作'}), 403
    
    history_item.play_count = (history_item.play_count or 0) + 1
    db.session.commit()
    return jsonify({'play_count': history_item.play_count})

@bp.route('/history/update_duration/<string:history_id>', methods=['POST'])
@login_required
def update_history_duration(history_id):
    """更新历史记录的音频时长"""
    data = request.get_json()
    duration = data.get('duration')
    if not duration or not isinstance(duration, (int, float)):
        return jsonify({'error': '无效的时长'}), 400

    history_item = History.query.get_or_404(history_id)
    if history_item.user_id != current_user.id:
        return jsonify({'error': '无权操作'}), 403

    history_item.duration = duration
    db.session.commit()
    return jsonify({'message': '时长更新成功'})

@bp.route('/api/history/<string:hid>', methods=['GET'])
@login_required
def api_history_detail(hid):
    """获取单条历史详情"""
    h = History.query.filter_by(id=hid, user_id=current_user.id).first()
    if not h:
        return jsonify({"ok": False, "error": "NOT_FOUND"}), 404
    data = {
        "id": h.id,
        "title": h.title,
        "script_full": h.script_full or "",
        "audio_filename": h.audio_filename,
        "timestamp": h.timestamp.isoformat() if h.timestamp else None,
        "mode": h.mode,
        "voice_name": h.voice_name,
        "duration": h.duration,
        "play_count": h.play_count,
        "thumbnail_filename": h.thumbnail_filename,
        "source_url": h.source_url,
        "source_title": h.source_title,
        "source_type": h.source_type,
        # 新增：原始输入字段
        "original_input": h.original_input,
        "input_type": h.input_type
    }
    return jsonify({"ok": True, "data": data})


