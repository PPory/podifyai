from pathlib import Path

from flask import Blueprint, abort

from .models import History
from .services import *

bp = Blueprint('static_routes', __name__)
PACKAGE_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = PACKAGE_ROOT.parent

@bp.route('/')
def index():
    return send_from_directory(PACKAGE_ROOT / 'templates', 'index.html')


@bp.route('/login', methods=['GET'])
def login_page():
    return send_from_directory(PACKAGE_ROOT / 'templates', 'login.html')


@bp.route('/register', methods=['GET'])
def register_page():
    return send_from_directory(PACKAGE_ROOT / 'templates', 'register.html')


@bp.route('/history_audio/<path:filename>')
@login_required
def serve_history_audio(filename):
    history_item = History.query.filter_by(audio_filename=filename, user_id=current_user.id).first()
    if not history_item:
        abort(403)
    return send_from_directory(PROJECT_ROOT / 'history_audio', filename)


@bp.route('/pdf_storage/<path:filename>')
@login_required
def serve_pdf_file(filename):
    if not filename.endswith('.pdf') or '..' in filename:
        return jsonify({'error': '无效的文件名'}), 400

    source_url = f'/pdf_storage/{filename}'
    history_item = History.query.filter_by(
        user_id=current_user.id,
        source_type='pdf',
        source_url=source_url,
    ).first()
    if not history_item:
        abort(403)

    pdf_path = PDF_STORAGE_DIR / filename
    if not pdf_path.exists():
        return jsonify({'error': 'PDF文件不存在'}), 404

    return send_from_directory(PROJECT_ROOT / 'pdf_storage', filename, mimetype='application/pdf')


@bp.route('/test_api_response.html')
def test_api_page():
    return send_from_directory(PROJECT_ROOT, 'test_api_response.html')


@bp.route('/<path:path>')
def static_files(path):
    return send_from_directory(PACKAGE_ROOT / 'static', path)
