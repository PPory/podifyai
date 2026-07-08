# Claude Notes

This is a historical maintenance note. It is kept for context only and may not match the current PodifyAI product README.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MOSS-TTSD is an open-source bilingual (Chinese/English) spoken dialogue synthesis model that transforms dialogue scripts between two speakers into natural, expressive conversational speech. It supports voice cloning and long-form audio generation (up to 960s), making it ideal for AI podcast production, interviews, and dialogues.

The project consists of:
1. **Core TTS Model**: Built on unified semantic-acoustic neural audio codec with pre-trained LLM
2. **Web Application**: Flask-based web UI with user authentication, subscription management, and credits system
3. **Fine-tuning Framework**: Tools for custom model training with full-parameter or LoRA fine-tuning
4. **Podcast Generation Pipeline**: Automated conversion of PDFs/URLs/text to podcasts using Gemini API

## Key Architecture Components

### 1. Model Architecture

**Core Components:**
- `modeling_asteroid.py`: Main `AsteroidTTSInstruct` model implementation (transformer-based)
- `research/generation_utils.py`: Model loading, JSONL processing, and batch inference utilities
- `XY_Tokenizer/`: Speech codec module (1kbps RVQ8 quantization at 12.5Hz)
  - Dual-channel architecture: semantic + acoustic modeling
  - Converts audio ↔ discrete tokens with minimal quality loss

**Inference Scripts:**
- `research/inference.py`: Standard batch inference
- `streamer.py`: Streaming inference (chunked decoding, ~20s chunks)
- `research/gradio_demo.py`: Gradio web UI for local testing

### 2. Web Application (app.py)

**Backend Stack:**
- Flask + Flask-SQLAlchemy + Flask-Login + Flask-Migrate
- SQLite database (`app.db`)
- CORS enabled for frontend

**Key Systems:**
- **Authentication**: Email/password login, OTP verification, password reset
- **Credits System**: Pay-per-use model (configurable credits per audio)
- **Subscription Management**: Stripe integration for paid plans
- **Audio Synthesis**: Integration with SiliconFlow TTS API
- **History Management**: Stores generated audio with metadata, source tracking
- **Voice Library**: User-uploaded reference voices for cloning
- **Audio Post-processing**: WebRTC VAD, silence trimming, format conversion (pydub)

**Environment Configuration:**
- Uses `.env.local` file (loaded with `override=True`)
- Critical vars: `SECRET_KEY`, `SILICONFLOW_API_KEY`, `STRIPE_*`, `SENDGRID_*`, `OPENAI_API_KEY`
- Security: Requires proper `SECRET_KEY`, CORS origin whitelist

### 3. Frontend

**Structure:**
- `podifyai/templates/`: Login/register HTML pages
- `podifyai/static/`: Main JS files
  - `script.js`: Primary UI logic (synthesis, history, voice library, player)
  - `auth.js`: Authentication flows

**Features:**
- Dual-mode synthesis: dialogue (2 speakers) vs. single speaker
- Voice preview and management
- Audio history with playback
- PDF/URL/text input for podcast generation
- Global audio player with playlist

### 4. Fine-tuning System

**Location:** `finetune/` directory

**Scripts:**
- `data_preprocess.py`: Convert JSONL → tokenized `.pkl` + `_metas.npy` files
- `finetune.py`: Training script (full or LoRA)
- `finetune_workflow.py`: One-click workflow (preprocess + train)
- Configuration: `training_config.yaml`, `lora_config.yaml`, `finetune_config.yaml`

**Training:**
- Supports multi-GPU via `torchrun`
- LoRA for memory efficiency (configurable rank, alpha, target modules)
- Uses `transformers.Trainer` API

## Common Development Commands

### Environment Setup

**Create environment:**
```bash
# Using conda (recommended)
conda create -n moss_ttsd python=3.10 -y && conda activate moss_ttsd
pip install -r requirements.txt
pip install flash-attn

# Download XY_Tokenizer weights
mkdir -p XY_Tokenizer/weights
huggingface-cli download fnlp/XY_Tokenizer_TTSD_V0 xy_tokenizer.ckpt --local-dir ./XY_Tokenizer/weights/
```

**Windows Note:** Set `--attn_implementation sdpa` or `eager` (flash_attention_2 not supported)

### Running the Application

**Local Inference:**
```bash
python research/inference.py --jsonl examples/examples.jsonl --output_dir outputs --seed 42 --use_normalize --silence_duration 0
```

**Streaming Inference:**
```bash
python streamer.py --jsonl examples/examples.jsonl --output_dir outputs/streamer --dtype bf16 --attn_implementation flash_attention_2 --use_tqdm
```

**Gradio Demo:**
```bash
python research/gradio_demo.py
```

**Flask Web App:**
```bash
python app.py
```

### Podcast Generation

**Requirements:** Set `OPENAI_API_KEY` and `OPENAI_API_BASE` (Gemini API)
```bash
export OPENAI_API_KEY="your_gemini_api_key"
export OPENAI_API_BASE="https://generativelanguage.googleapis.com/v1beta/openai/"

# Generate from URL/PDF/text
python podcast_generate.py "https://example.com/article"
python podcast_generate.py "examples/paper.pdf"
python podcast_generate.py "examples/text.txt" -l en  # English output
```

### API Usage (SiliconFlow Batch Processing)

```bash
export SILICONFLOW_API_KEY="your_key"
export SILICONFLOW_API_BASE="https://api.siliconflow.cn/v1"

python use_api.py --jsonl_file data.jsonl --output_dir api_outputs --max_workers 8
```

### Fine-tuning Workflow

**1. Prepare Data:**
```bash
python finetune/data_preprocess.py \
  --jsonl <path_to_jsonl> \
  --model_path fnlp/MOSS-TTSD-v0.5 \
  --output_dir <output_dir> \
  --data_name processed_data \
  --use_normalize
```

**2. Fine-tune (Full):**
```bash
python finetune/finetune.py \
  --model_path fnlp/MOSS-TTSD-v0.5 \
  --data_dir <processed_data_dir> \
  --output_dir <output_model_dir> \
  --training_config finetune/training_config.yaml
```

**3. Fine-tune (LoRA):**
```bash
python finetune/finetune.py \
  --model_path fnlp/MOSS-TTSD-v0.5 \
  --data_dir <processed_data_dir> \
  --output_dir <output_model_dir> \
  --training_config finetune/training_config.yaml \
  --lora_config finetune/lora_config.yaml \
  --lora
```

**4. Multi-GPU Training:**
```bash
torchrun --nproc_per_node=8 --master_port=29500 finetune/finetune.py \
  --model_path fnlp/MOSS-TTSD-v0.5 \
  --data_dir <data_dir> \
  --output_dir <output_dir> \
  --training_config finetune/training_config.yaml \
  --lora --lora_config finetune/lora_config.yaml
```

**5. One-Click Workflow:**
```bash
# Edit finetune/finetune_config.yaml first
python finetune/finetune_workflow.py --config finetune/finetune_config.yaml
```

### Database Management

**Initialize database:**
```bash
python tools/init_db.py
```

**Create admin user:**
```bash
python tools/create_admin_user.py
```

**Run migrations:**
```bash
flask db init
flask db migrate -m "migration message"
flask db upgrade
```

## JSONL Input Format

The model supports three input formats:

**Format 1: Text-only (no voice cloning)**
```json
{"text": "[S1]Speaker 1 content[S2]Speaker 2 content"}
```

**Format 2: Separate speaker references**
```json
{
  "base_path": "/path/to/audio/",
  "text": "[S1]Hello[S2]Hi there",
  "prompt_audio_speaker1": "speaker1.wav",
  "prompt_text_speaker1": "Reference text 1",
  "prompt_audio_speaker2": "speaker2.wav",
  "prompt_text_speaker2": "Reference text 2"
}
```

**Format 3: Shared reference**
```json
{
  "base_path": "/path/to/audio/",
  "text": "[S1]Hello[S2]Hi there",
  "prompt_audio": "shared_reference.wav",
  "prompt_text": "[S1]Ref for speaker 1[S2]Ref for speaker 2"
}
```

**Fine-tuning Data Formats:**

Format 1: Single audio with transcript
```json
{
  "file_path": "/path/to/audio.wav",
  "full_transcript": "[S1]Content[S2]Content..."
}
```

Format 2: Reference + main audio
```json
{
  "reference_audio": "/path/to/reference.wav",
  "reference_text": "[S1]Reference[S2]Reference",
  "audio": "/path/to/main.wav",
  "text": "[S1]Content[S2]Content"
}
```

## Important Implementation Details

### Speaker Tags
- Use `[S1]` and `[S2]` tags to mark speaker turns in dialogue text
- Example: `[S1]Hello, how are you?[S2]I'm great, thanks!`

### GPU Memory Requirements
- Formula: `VRAM_GB = 0.00172 * audio_seconds + 5.8832`
- 120s audio ≈ 6.08GB, 600s audio ≈ 6.91GB
- Streaming inference reduces memory footprint

### Audio Processing Pipeline
1. **Input**: Reference audio (10-20s recommended) + dialogue text
2. **Tokenization**: Text → tokens via AutoTokenizer
3. **Generation**: Model produces speech tokens
4. **Decoding**: XY_Tokenizer converts tokens → 24kHz audio
5. **Post-processing**: VAD-based trimming, silence removal (optional)

### Model Paths
- Default model: `fnlp/MOSS-TTSD-v0.5` (HuggingFace)
- XY_Tokenizer config: `XY_Tokenizer/config/xy_tokenizer_config.yaml`
- XY_Tokenizer weights: `XY_Tokenizer/weights/xy_tokenizer.ckpt`

### Text Normalization
- Use `--use_normalize` flag for better results (recommended)
- Normalizes numbers, dates, symbols, etc.

### Silence Duration Parameter
- `--silence_duration`: Seconds of silence between reference and generated audio
- Default: 0 seconds
- Use 0.1 if noise appears at start of generated audio (continuation of prompt tail)

## Testing Strategy

- Many test files exist for specific features (prefix `test_*.py` or `test_*.html`)
- Smoke tests in `tests/`: `smoke_sf_request.py`, `smoke_gemini.py`, etc.
- Integration tests: `test_auth_api.py`, `test_stripe_integration.py`, `test_complete_functionality.py`

## Known Limitations

1. Model occasionally shows speaker switching errors and timbre cloning deviations
2. Streaming inference currently supports batch_size=1 only
3. Windows users must use `sdpa` or `eager` attention (not flash_attention_2)
4. Reference audio longer than examples increases VRAM usage

## Critical Files to Understand

- **app.py** (239KB): Main Flask application, all API routes and business logic
- **generation_utils.py**: Core inference utilities, JSONL processing
- **modeling_asteroid.py**: Model architecture definition
- **config.py**: Application configuration (credits, TTS settings, auth flags)
- **migrations/versions/*.py**: Database schema evolution

## External Dependencies

- **SiliconFlow API**: TTS generation in web app (requires API key)
- **Gemini API**: Podcast script generation (via OpenAI-compatible endpoint)
- **Stripe**: Payment processing for subscriptions
- **SendGrid**: Email delivery for OTP and password reset
- **FFmpeg**: Audio format conversion (pydub dependency)
