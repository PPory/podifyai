from flask import Flask, request, jsonify, Response
import time
import random

app = Flask(__name__)

# 按 key 定义行为：ok/rl(429)/auth(401)/flaky(随机500)
KEY_BEHAVIOR = {
    "sk-ok-1": "ok",
    "sk-ok-2": "ok",
    "sk-rl": "rl",
    "sk-bad": "auth",
    "sk-flaky": "flaky",
}

def pick_behavior():
    auth = request.headers.get("Authorization", "")
    key = auth.replace("Bearer ", "").strip()
    return KEY_BEHAVIOR.get(key, "ok")

@app.route("/v1/audio/speech", methods=["POST"])
def sf_tts():
    b = pick_behavior()
    if b == "auth":
        return jsonify({"error": "unauthorized"}), 401
    if b == "rl":
        return jsonify({"error": "rate limit"}), 429
    if b == "flaky" and random.random() < 0.4:
        return jsonify({"error": "server error"}), 503
    # 模拟轻微延迟与音频字节
    time.sleep(random.uniform(0.05, 0.2))
    # 伪装一个最小 WAV header + 垃圾字节，够让流程走完（你的业务最后也有兜底直接写原始字节）
    wav = b"RIFFxxxxWAVEfmt " + bytes([255] * 2048)
    return Response(wav, mimetype="audio/wav"), 200

@app.route("/v1/chat/completions", methods=["POST"])
def chat():
    b = pick_behavior()
    if b == "auth":
        return jsonify({"error": "unauthorized"}), 401
    if b == "rl":
        return jsonify({"error": "rate limit"}), 429
    if b == "flaky" and random.random() < 0.3:
        return jsonify({"error": "server error"}), 500
    time.sleep(random.uniform(0.05, 0.15))
    return jsonify({
        "id": "cmpl-test",
        "choices": [{"message": {"content": "hello from fake"}}]
    }), 200

if __name__ == "__main__":
    # 在 5001 端口起本地假服务
    app.run(host="127.0.0.1", port=5001, debug=False)
