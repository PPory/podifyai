"""
MOSS-TTSD SiliconFlow API diagnostic script.

Runs three tests to isolate the voice cloning issue:

  1. diag_official.mp3  - official docs example (Charles/Claire HTTPS URLs)
  2. diag_user.mp3      - user voice as base64 data URL
  3. diag_voice_uri.mp3 - user voice uploaded to SiliconFlow voice bank,
                          then used as a speech:xxx URI in references

Run: python tools/diagnose_moss_ttsd.py
"""
from __future__ import annotations

import base64
import io
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

DIAG_INPUT = (
    "[S1]你好，这是一段来自诊断脚本的测试文本。"
    "[S2]很高兴见到你，我们正在验证音色克隆的效果。"
    "[S1]希望合成的声音和参考音色一致。"
    "[S2]好的，我们拭目以待。"
)
USER_REF_TEXT = (
    "你好！这是 PodifyAI 的单人旁白试听文本。"
    "通过这段统一语料，你可以直观感受不同音色的音质和风格，"
    "帮助你为作品挑选最合适的声音。"
)


def load_env_local() -> None:
    env_file = REPO_ROOT / ".env.local"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def build_client():
    from openai import OpenAI
    api_key = os.environ.get("SILICONFLOW_API_KEY")
    if not api_key:
        raise RuntimeError("SILICONFLOW_API_KEY missing (not in env or .env.local)")
    base_url = os.environ.get("SILICONFLOW_API_BASE", "https://api.siliconflow.cn/v1")
    return OpenAI(api_key=api_key, base_url=base_url)


def moss_params(refs: list, input_text: str = DIAG_INPUT) -> dict:
    """Build MOSS-TTSD request params aligned with official example."""
    return {
        "model": "fnlp/MOSS-TTSD-v0.5",
        "voice": "",
        "input": input_text,
        "response_format": "mp3",
        "speed": 1,
        "extra_body": {
            "references": refs,
            "max_tokens": 1600,
            "stream": True,
            "gain": 0,
        },
    }


def save_stream(client, params: dict, out_path: Path) -> None:
    print(f"  -> calling SiliconFlow, output: {out_path.name}")
    with client.audio.speech.with_streaming_response.create(**params) as resp:
        data = resp.read()
    out_path.write_bytes(data)
    print(f"     wrote {len(data)} bytes")


# ---------------------------------------------------------------------------
# Test 1: Official docs example (HTTPS URLs)
# ---------------------------------------------------------------------------
def test_official(client) -> None:
    print("[1/3] Official example (Charles/Claire HTTPS refs)")
    refs = [
        {
            "audio": "https://sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com/Charles.mp3",
            "text": "He lay there again, his body felt heavy, and a feeling of exhaustion washed over him.",
        },
        {
            "audio": "https://sf-maas-uat-prod.oss-cn-shanghai.aliyuncs.com/Claire.mp3",
            "text": "He lay there again, his body felt heavy, and a feeling of exhaustion washed over him.",
        },
    ]
    save_stream(client, moss_params(refs), REPO_ROOT / "diag_official.mp3")


# ---------------------------------------------------------------------------
# Test 2: User voice as base64 data URL
# ---------------------------------------------------------------------------
def audio_to_base64_data_uri(path: Path) -> str:
    from pydub import AudioSegment
    audio = AudioSegment.from_file(path).set_channels(1).set_frame_rate(16000)
    if len(audio) > 10_000:
        audio = audio[:10_000]
    buf = io.BytesIO()
    audio.export(buf, format="mp3", bitrate="192k")
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:audio/mp3;base64,{b64}"


def test_user_base64(client, voice_path: Path) -> None:
    print(f"[2/3] User voice (base64) - {voice_path.name}")
    if not voice_path.exists():
        print(f"     SKIP: file not found: {voice_path}")
        return
    data_uri = audio_to_base64_data_uri(voice_path)
    print(f"     data URI length = {len(data_uri)} chars")
    ref = {"audio": data_uri, "text": USER_REF_TEXT}
    save_stream(client, moss_params([ref, ref]), REPO_ROOT / "diag_user.mp3")


# ---------------------------------------------------------------------------
# Test 3: Upload voice → get speech:xxx URI → use in references
# ---------------------------------------------------------------------------
def upload_voice(voice_path: Path, api_key: str, base_url: str) -> str | None:
    """Upload audio to SiliconFlow voice bank. Returns speech:xxx URI or None."""
    import requests
    url = base_url.rstrip("/") + "/uploads/audio/voice"
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    data = {
        "model": "FunAudioLLM/CosyVoice2-0.5B",
        "customName": "diag_qian_voice",
        "text": USER_REF_TEXT,
    }
    suffix = voice_path.suffix.lower()
    mime = {".mp3": "audio/mpeg", ".wav": "audio/wav"}.get(suffix, "audio/wav")
    print(f"     uploading {voice_path.name} ({mime}) ...")
    with open(voice_path, "rb") as f:
        resp = requests.post(url, headers=headers, data=data,
                             files={"file": (voice_path.name, f, mime)}, timeout=60)
    if resp.status_code in (200, 201):
        j = resp.json()
        uri = j.get("voice") or j.get("voice_uri") or j.get("uri")
        if uri:
            print(f"     upload OK → {uri}")
            return uri
        print(f"     upload OK but no URI in response: {j}")
        return None
    print(f"     upload FAILED {resp.status_code}: {resp.text[:200]}")
    return None


def test_voice_uri(client, voice_path: Path) -> None:
    print(f"[3/3] User voice uploaded → speech:xxx URI in references - {voice_path.name}")
    if not voice_path.exists():
        print(f"     SKIP: file not found: {voice_path}")
        return
    api_key = os.environ["SILICONFLOW_API_KEY"]
    base_url = os.environ.get("SILICONFLOW_API_BASE", "https://api.siliconflow.cn/v1")
    uri = upload_voice(voice_path, api_key, base_url)
    if not uri:
        print("     SKIP: upload failed, cannot test voice URI path")
        return
    ref = {"audio": uri, "text": USER_REF_TEXT}
    save_stream(client, moss_params([ref, ref]), REPO_ROOT / "diag_voice_uri.mp3")


def test_voice_field(client, voice_path: Path) -> None:
    """Try speech:xxx URI in the top-level `voice` field with MOSS-TTSD."""
    print(f"[4/4] MOSS-TTSD + speech:xxx as `voice` field - {voice_path.name}")
    if not voice_path.exists():
        print(f"     SKIP: file not found: {voice_path}")
        return
    api_key = os.environ["SILICONFLOW_API_KEY"]
    base_url = os.environ.get("SILICONFLOW_API_BASE", "https://api.siliconflow.cn/v1")
    uri = upload_voice(voice_path, api_key, base_url)
    if not uri:
        print("     SKIP: upload failed")
        return
    params = {
        "model": "fnlp/MOSS-TTSD-v0.5",
        "voice": uri,
        "input": DIAG_INPUT,
        "response_format": "mp3",
        "speed": 1,
        "extra_body": {
            "max_tokens": 1600,
            "stream": True,
            "gain": 0,
        },
    }
    save_stream(client, params, REPO_ROOT / "diag_voice_field.mp3")


def test_cosyvoice(client, voice_path: Path) -> None:
    """CosyVoice2 model + speech:xxx URI — the original working path before MOSS-TTSD."""
    print(f"[5/5] CosyVoice2 + speech:xxx as `voice` field - {voice_path.name}")
    if not voice_path.exists():
        print(f"     SKIP: file not found: {voice_path}")
        return
    api_key = os.environ["SILICONFLOW_API_KEY"]
    base_url = os.environ.get("SILICONFLOW_API_BASE", "https://api.siliconflow.cn/v1")
    uri = upload_voice(voice_path, api_key, base_url)
    if not uri:
        print("     SKIP: upload failed")
        return
    # Single-speaker input (no [S1]/[S2] tags — CosyVoice2 doesn't use them)
    single_input = (
        "你好，这是一段来自诊断脚本的测试文本。"
        "很高兴见到你，我们正在验证音色克隆的效果。"
        "希望合成的声音和参考音色一致。"
    )
    params = {
        "model": "FunAudioLLM/CosyVoice2-0.5B",
        "voice": uri,
        "input": single_input,
        "response_format": "mp3",
        "speed": 1,
    }
    print(f"     voice URI: {uri}")
    save_stream(client, params, REPO_ROOT / "diag_cosyvoice.mp3")


# ---------------------------------------------------------------------------
def main() -> None:
    load_env_local()
    client = build_client()

    voice_path = REPO_ROOT / "voices_audio" / "4beb3790-ffa1-4fea-807f-cc60cf0267f3.WAV"

    for label, fn in [
        ("official",    lambda: test_official(client)),
        ("base64",      lambda: test_user_base64(client, voice_path)),
        ("voice_uri",   lambda: test_voice_uri(client, voice_path)),
        ("voice_field", lambda: test_voice_field(client, voice_path)),
        ("cosyvoice",   lambda: test_cosyvoice(client, voice_path)),
    ]:
        try:
            fn()
        except Exception as e:
            print(f"  !! {label} test failed: {e}")

    print()
    print("done. output files:")
    for name in ("diag_official.mp3", "diag_user.mp3", "diag_voice_uri.mp3", "diag_voice_field.mp3", "diag_cosyvoice.mp3"):
        p = REPO_ROOT / name
        size = f"{p.stat().st_size} bytes" if p.exists() else "not created"
        print(f"  {name:<25} {size}")
    print()
    print("listen and compare:")
    print("  diag_voice_uri.mp3 = qian voice  → speech:xxx URI path works, use this in production")
    print("  diag_voice_uri.mp3 = wrong voice  → MOSS-TTSD voice cloning is broken on SiliconFlow")


if __name__ == "__main__":
    main()
