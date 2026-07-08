from flask import Blueprint

from .services import *

bp = Blueprint('content', __name__)

URL_FETCH_ERROR_MAP = {
    "ANTIBOT": "该链接可能启用了反爬/人机验证，暂无法解析",
    "UNSUPPORTED_MIME": "该链接不是标准网页（可能是文件/媒体），无法解析正文",
    "NETWORK_ERROR": "网络异常或目标站点无响应",
}


def _extract_url_payload(url: str, *, include_title: bool) -> tuple[dict | None, dict | None, int | None]:
    fetch = smart_fetch_html(url)
    if not fetch.get("ok"):
        msg = URL_FETCH_ERROR_MAP.get(fetch.get("error_type"), "解析失败")
        return None, {
            "ok": False,
            "error": msg,
            "error_type": fetch.get("error_type"),
            "resolved_url": fetch.get("url"),
            "strategy": fetch.get("strategy"),
            "status": fetch.get("status"),
        }, 422

    html = fetch["html"]
    text = extract_text_from_html(html, mirrored=fetch["mirrored"])

    if len(text) < MIN_ARTICLE_CHARS:
        lower = html.lower()
        if any(s in lower for s in ["subscribe to", "sign in", "log in", "members only", "paywall"]):
            err = "该链接内容可能需要登录/订阅，无法获取正文"
            err_type = "LOGIN_OR_PAYWALL"
        else:
            err = "未能可靠提取正文（内容过短或结构异常）"
            err_type = "CONTENT_TOO_SHORT"
        return None, {
            "ok": False,
            "error": err,
            "error_type": err_type,
            "resolved_url": fetch["url"],
            "strategy": fetch["strategy"],
        }, 422

    title = ""
    if include_title and not fetch["mirrored"]:
        try:
            soup = BeautifulSoup(html, "html.parser")
            title = extract_title(soup)
        except Exception:
            title = ""

    max_chars = 20000
    if len(text) > max_chars:
        text = text[:max_chars]

    payload = {
        "resolved_url": fetch["url"],
        "text": text,
        "word_count": len(text),
        "strategy": fetch["strategy"],
    }
    if include_title:
        payload["title"] = title
    return payload, None, None


@bp.route("/api/extract_from_url", methods=["POST"])
def extract_from_url():
    """稳健的通用URL抽取接口"""
    data = request.get_json(force=True) or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"ok": False, "error": "缺少 url"}), 400

    try:
        payload, error_body, status = _extract_url_payload(url, include_title=True)
    except Exception:
        logging.exception("URL提取接口内部异常")
        return jsonify({
            "ok": False,
            "error": "链接解析服务内部错误，请稍后重试",
            "error_type": "INTERNAL_ERROR",
        }), 500

    if error_body:
        return jsonify(error_body), status

    return jsonify({"ok": True, **payload})

@bp.route('/generate-script', methods=['POST'])
@login_required
def generate_script_api():
    """API接口：生成播客脚本 - 支持PDF、URL和纯文本输入"""
    try:
        data = request.json
        if not data:
            return jsonify({"error": "请求体不能为空"}), 400
            
        input_type = data.get('inputType')
        content = data.get('content')
        mode = data.get('mode')
        model = data.get('geminiModel')
        # duration参数已移除，不再需要
        
        # 新增：风格和长度参数
        style_key = data.get('styleKey')
        length_mode = data.get('lengthMode')  # 'concise' or 'detailed'
        
        # 默认值：对话=interview，单人=edu；长度默认精简
        if not style_key:
            style_key = 'interview' if mode == 'role' else 'edu'
        if length_mode not in ('concise', 'detailed'):
            length_mode = 'concise'

        if not all([input_type, content, mode, model]):
            return jsonify({"error": "缺少必要参数：inputType, content, mode, geminiModel"}), 400

        # 根据输入类型处理内容
        extracted_text = ""
        
        if input_type == 'pdf':
            try:
                # 解码Base64内容
                pdf_data = base64.b64decode(content)
                
                # 生成唯一的PDF文件名
                pdf_filename = f"pdf_{uuid.uuid4()}.pdf"
                pdf_path = PDF_STORAGE_DIR / pdf_filename
                
                # 保存PDF文件到存储目录
                with open(pdf_path, 'wb') as pdf_file:
                    pdf_file.write(pdf_data)
                
                try:
                    # 使用PyMuPDF提取文本
                    doc = fitz.open(pdf_path)
                    extracted_text = ""
                    for page_num in range(len(doc)):
                        page = doc.load_page(page_num)
                        extracted_text += page.get_text()
                    doc.close()
                    
                    if not extracted_text.strip():
                        # 删除无效的PDF文件
                        if pdf_path.exists():
                            pdf_path.unlink()
                        return jsonify({"error": "PDF文件中未找到可提取的文本内容"}), 400
                    
                    # 设置提取的文本，继续处理
                    extracted_text = extracted_text
                        
                except Exception as e:
                    # 如果文本提取失败，删除PDF文件
                    if pdf_path.exists():
                        pdf_path.unlink()
                    raise e
                    
            except Exception as e:
                logging.error(f"PDF处理失败: {e}")
                return jsonify({"error": f"PDF处理失败: {str(e)}"}), 500
                
        elif input_type == 'url':
            try:
                payload, error_body, status = _extract_url_payload(content, include_title=False)
            except Exception:
                logging.exception("生成脚本前的URL解析内部异常")
                return jsonify({
                    "error": "链接解析服务内部错误，请稍后重试",
                    "error_type": "INTERNAL_ERROR",
                }), 500

            if error_body:
                return jsonify({
                    "error": error_body["error"],
                    "error_type": error_body.get("error_type"),
                }), 400 if status and status < 500 else status

            extracted_text = payload["text"]
                
        elif input_type == 'text':
            # 直接使用纯文本内容
            extracted_text = content.strip()
            if not extracted_text:
                return jsonify({"error": "文本内容不能为空"}), 400
        else:
            return jsonify({"error": "不支持的输入类型，请使用 'pdf', 'url' 或 'text'"}), 400

        # 硬护栏：验证正文抽取是否成功（仅对URL/PDF生效）
        if input_type in ('url', 'pdf') and len(extracted_text.strip()) < MIN_ARTICLE_CHARS:
            return jsonify({"error": "正文抽取失败，已中止生成", "error_type": "CONTENT_TOO_SHORT"}), 422

        # 调用Gemini生成脚本
        title, script = create_podcast_script_with_gemini(
            extracted_text, mode, model, style_key=style_key, length_mode=length_mode
        )
        
        # 如果是PDF类型，返回PDF文件信息
        if input_type == 'pdf':
            return jsonify({
                "title": title, 
                "script": script,
                "pdf_filename": pdf_filename,
                "pdf_path": str(pdf_path)
            })
        else:
            return jsonify({"title": title, "script": script})

    except Exception as e:
        logging.error(f"/generate-script 接口出错: {e}", exc_info=True)
        return jsonify({"error": f"脚本生成失败: {str(e)}"}), 500


# ==================== 支付系统接口 ====================

# ===== Stripe 接入 =====
# import stripe
