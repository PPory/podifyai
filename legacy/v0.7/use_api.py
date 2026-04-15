# -*- coding: utf-8 -*-
import json
import base64
import librosa
import soundfile as sf
from pathlib import Path
from openai import OpenAI
import tempfile
import os
import concurrent.futures
import threading
from functools import partial
from pydub import AudioSegment
from pydub.silence import detect_nonsilent

# Get API credentials from environment variables
API_KEY = os.getenv("SILICONFLOW_API_KEY")
BASE_URL = os.getenv("SILICONFLOW_API_BASE", "https://api.siliconflow.cn/v1")

if not API_KEY:
    raise ValueError("Please set the SILICONFLOW_API_KEY environment variable")

client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

# Thread-safe file writing lock
write_lock = threading.Lock()

def trim_with_vad(audio, sr, head_margin_ms=120, tail_margin_ms=120, max_duration_s=10.0):
    """
    Trim audio using VAD (Voice Activity Detection) with margins
    """
    try:
        import webrtcvad
        import numpy as np
        
        # Initialize VAD
        vad = webrtcvad.Vad(2)  # Aggressiveness level 2
        frame_length = int(sr * 0.03)  # 30ms frames
        hop_length = frame_length
        
        # Convert to int16 for VAD
        audio_int16 = (audio * 32768).astype(np.int16)
        
        # Detect speech frames
        speech_frames = []
        for i in range(0, len(audio_int16) - frame_length, hop_length):
            frame = audio_int16[i:i+frame_length].tobytes()
            is_speech = vad.is_speech(frame, sr)
            speech_frames.append(is_speech)
        
        # Find first and last speech frames
        speech_indices = [i for i, is_speech in enumerate(speech_frames) if is_speech]
        
        if not speech_indices:
            # No speech detected, return original audio
            return audio
        
        first_speech_frame = speech_indices[0]
        last_speech_frame = speech_indices[-1]
        
        # Convert frame indices to sample indices
        first_speech_sample = first_speech_frame * hop_length
        last_speech_sample = (last_speech_frame + 1) * hop_length
        
        # Add margins
        head_margin_samples = int(sr * head_margin_ms / 1000)
        tail_margin_samples = int(sr * tail_margin_ms / 1000)
        
        start_sample = max(0, first_speech_sample - head_margin_samples)
        end_sample = min(len(audio), last_speech_sample + tail_margin_samples)
        
        # Trim audio
        trimmed_audio = audio[start_sample:end_sample]
        
        # Limit duration
        max_samples = int(sr * max_duration_s)
        if len(trimmed_audio) > max_samples:
            trimmed_audio = trimmed_audio[:max_samples]
        
        return trimmed_audio
        
    except ImportError:
        print("[WARNING] webrtcvad not available, using energy-based trimming")
        # Fallback to energy-based trimming
        import numpy as np
        
        # Calculate RMS energy
        frame_length = int(sr * 0.03)  # 30ms frames
        hop_length = frame_length
        
        energy = []
        for i in range(0, len(audio) - frame_length, hop_length):
            frame = audio[i:i+frame_length]
            energy.append(np.sqrt(np.mean(frame**2)))
        
        # Find energy threshold (10% of max energy)
        max_energy = max(energy)
        threshold = max_energy * 0.1
        
        # Find first and last frames above threshold
        speech_frames = [i for i, e in enumerate(energy) if e > threshold]
        
        if not speech_frames:
            return audio
        
        first_speech_frame = speech_frames[0]
        last_speech_frame = speech_frames[-1]
        
        # Convert to sample indices
        first_speech_sample = first_speech_frame * hop_length
        last_speech_sample = (last_speech_frame + 1) * hop_length
        
        # Add margins
        head_margin_samples = int(sr * head_margin_ms / 1000)
        tail_margin_samples = int(sr * tail_margin_ms / 1000)
        
        start_sample = max(0, first_speech_sample - head_margin_samples)
        end_sample = min(len(audio), last_speech_sample + tail_margin_samples)
        
        # Trim audio
        trimmed_audio = audio[start_sample:end_sample]
        
        # Limit duration
        max_samples = int(sr * max_duration_s)
        if len(trimmed_audio) > max_samples:
            trimmed_audio = trimmed_audio[:max_samples]
        
        return trimmed_audio

def audio_to_base64(audio_path, target_sr=16000, target_channels=1):
    """
    Convert audio file to 16k mono WAV format with VAD trimming and encode to base64
    """
    import io
    import tempfile
    
    # Check if file exists
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")
    
    try:
        # Load audio file with librosa for initial processing
        audio, sr = librosa.load(audio_path, sr=target_sr, mono=True)
        
        # S2：参考音频"只用干净 WAV + 先裁头裁尾"
        audio = trim_with_vad(audio, sr, head_margin_ms=120, tail_margin_ms=120, max_duration_s=10.0)
        
        # Write temporary WAV file for pydub processing
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_wav_file:
            temp_wav_path = temp_wav_file.name
        
        # Write WAV to temporary file
        sf.write(temp_wav_path, audio, target_sr, format='WAV', subtype='PCM_16')
        
        # --- 参考音色预处理：去尾静音/嘶气 & 轻微淡出 ---
        seg = AudioSegment.from_wav(temp_wav_path)
        # 去除两端超长静音（阈值：片段均值-28dB，最小静音切除 180ms）
        non_silent = detect_nonsilent(seg, min_silence_len=180, silence_thresh=seg.dBFS - 28)
        if non_silent:
            start, end = non_silent[0][0], non_silent[-1][1]
            # 仅收缩尾端 200~600ms 的气音/静音，不积极截断前端
            end = min(len(seg), end + 10)
            seg = seg[:end]
        # 轻微淡出，避免尾巴硬切导致模型延续噪声
        seg = seg.fade_out(80)
        seg.export(temp_wav_path, format="wav")
        
        # Read processed WAV file and convert to base64
        with open(temp_wav_path, 'rb') as f:
            wav_bytes = f.read()
        
        # Clean up temporary file
        os.unlink(temp_wav_path)
        
        # Convert to base64
        base64_encoded = base64.b64encode(wav_bytes).decode('utf-8')
        
        return base64_encoded, "audio/wav"
        
    except Exception as e:
        print(f"[ERROR] Audio processing failed: {e}")
        raise

def process_single_item(line_data, output_dir, line_num, output_jsonl_path):
    """
    Process single data item (for concurrent execution)
    Supports two formats:
    1. Separate format: prompt_audio_speaker1, prompt_text_speaker1, prompt_audio_speaker2, prompt_text_speaker2
    2. Merged format: prompt_audio, prompt_text
    """
    try:
        # Extract text
        input_text = line_data["text"]
        
        # Check which format
        if "prompt_audio_speaker1" in line_data and "prompt_audio_speaker2" in line_data:
            # Separate format (original format)
            prompt_audio_speaker1_path = os.path.join(line_data["base_path"], line_data["prompt_audio_speaker1"])
            prompt_audio_speaker2_path = os.path.join(line_data["base_path"], line_data["prompt_audio_speaker2"])
            
            # Check if audio files exist
            if not os.path.exists(prompt_audio_speaker1_path):
                raise FileNotFoundError(f"Speaker1 audio file not found: {prompt_audio_speaker1_path}")
            if not os.path.exists(prompt_audio_speaker2_path):
                raise FileNotFoundError(f"Speaker2 audio file not found: {prompt_audio_speaker2_path}")
            
            # Convert audio to base64
            audio1_base64, mime1 = audio_to_base64(prompt_audio_speaker1_path)
            audio2_base64, mime2 = audio_to_base64(prompt_audio_speaker2_path)
            
            # Build reference data
            references = [
                {
                    "audio": f"data:{mime1};base64,{audio1_base64}",
                    "text": f"[S1]{line_data['prompt_text_speaker1']}"
                },
                {
                    "audio": f"data:{mime2};base64,{audio2_base64}",
                    "text": f"[S2]{line_data['prompt_text_speaker2']}"
                }
            ]
            
            # Build output record
            output_record = {
                "text": line_data["text"],
                "prompt_audio_speaker1": line_data["prompt_audio_speaker1"],
                "prompt_text_speaker1": line_data["prompt_text_speaker1"],
                "prompt_audio_speaker2": line_data["prompt_audio_speaker2"],
                "prompt_text_speaker2": line_data["prompt_text_speaker2"],
                "output_audio": None  # Will be set later
            }
            
        elif "prompt_audio" in line_data and "prompt_text" in line_data:
            # Merged format (new format)
            prompt_audio_path = os.path.join(line_data["base_path"], line_data["prompt_audio"])
            
            # Check if audio file exists
            if not os.path.exists(prompt_audio_path):
                raise FileNotFoundError(f"Reference audio file not found: {prompt_audio_path}")
            
            # Convert audio to base64
            audio_base64, mime = audio_to_base64(prompt_audio_path)
            
            # Build reference data (using single audio and text)
            references = [
                {
                    "audio": f"data:{mime};base64,{audio_base64}",
                    "text": f"[S1]{line_data['prompt_text'].lstrip()}"
                }
            ]
            
            # Build output record
            output_record = {
                "text": line_data["text"],
                "prompt_audio": line_data["prompt_audio"],
                "prompt_text": line_data["prompt_text"],
                "output_audio": None  # Will be set later
            }
            
        else:
            raise ValueError("Unsupported data format. Must contain one of the following field sets:\n"
                           "1. prompt_audio_speaker1, prompt_text_speaker1, prompt_audio_speaker2, prompt_text_speaker2\n"
                           "2. prompt_audio, prompt_text")
        
        # Generate output path (using line number as filename)
        output_filename = f"output_{line_num:04d}.wav"
        output_path = os.path.join(output_dir, output_filename)
        output_path = os.path.abspath(output_path)
        
        # Generate speech
        generate_speech(input_text, references, output_path, line_num)
        
        # Set output audio path
        output_record["output_audio"] = output_path
        
        # Thread-safe writing to output JSONL file
        with write_lock:
            with open(output_jsonl_path, 'a', encoding='utf-8') as output_f:
                output_f.write(json.dumps(output_record, ensure_ascii=False) + '\n')
        
        return f"Line {line_num} processed successfully"
        
    except Exception as e:
        error_msg = f"Error processing line {line_num}: {e}"
        print(f"[ERROR] {error_msg}")
        return error_msg

def generate_speech(input_text, references, output_path, line_num):
    """
    Generate speech
    """
    # Create request parameters
    params = dict(
        model="fnlp/MOSS-TTSD-v0.5", 
        input=input_text,
        response_format="wav",
        voice="",
        extra_body={
            "references": references,
            "max_tokens": 16384,
        }
    )
    
    import time
    start_time = time.time()
    
    try:
        with client.audio.speech.with_streaming_response.create(**params) as response:
            data = response.read()
            
            with open(output_path, "wb") as f:
                f.write(data)
            
            # Verify if file was written successfully
            if not os.path.exists(output_path):
                print(f"[ERROR] Line {line_num} - File write failed, file does not exist: {output_path}")
        
        end_time = time.time()
        print(f"Line {line_num} - Audio generation time: {end_time - start_time:.2f} seconds")
        
    except Exception as e:
        print(f"[ERROR] Line {line_num} - API call failed: {e}")
        raise

def main(jsonl_file_path, output_dir, max_workers=4):
    """
    Main function: process JSONL file concurrently
    """
    print(f"Starting to process JSONL file: {jsonl_file_path}")
    print(f"Output directory: {output_dir}")
    print(f"Max workers: {max_workers}")
    
    # Check if JSONL file exists
    if not os.path.exists(jsonl_file_path):
        print(f"[ERROR] JSONL file not found: {jsonl_file_path}")
        return
    
    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)
    
    # Create output JSONL file path
    output_jsonl_path = os.path.join(output_dir, "output_results.jsonl")
    
    # Clear output file (if exists)
    with open(output_jsonl_path, 'w', encoding='utf-8') as f:
        pass
    
    with open(jsonl_file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        print(f"Total {len(lines)} lines of data")
        
        # Prepare all tasks
        tasks = []
        for line_num, line in enumerate(lines, 1):
            try:
                line_data = json.loads(line.strip())
                tasks.append((line_data, line_num))
            except json.JSONDecodeError as e:
                print(f"[ERROR] Line {line_num} JSON parsing failed: {e}")
                continue
        
        print(f"Prepared {len(tasks)} valid tasks")
        
        # Use thread pool for concurrent processing
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all tasks
            future_to_line = {
                executor.submit(process_single_item, line_data, output_dir, line_num, output_jsonl_path): line_num 
                for line_data, line_num in tasks
            }
            
            # Process completed tasks
            completed = 0
            for future in concurrent.futures.as_completed(future_to_line):
                line_num = future_to_line[future]
                completed += 1
                try:
                    result = future.result()
                    print(f"({completed}/{len(tasks)}) {result}")
                except Exception as exc:
                    print(f"[ERROR] Line {line_num} generated exception: {exc}")
    
    print(f"\nAll processing completed!")
    print(f"Output audio files saved in: {output_dir}")
    print(f"Output JSONL file saved in: {output_jsonl_path}")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='MOSS-TTSD API batch processing tool')
    parser.add_argument('--jsonl_file', type=str, default="examples/examples.jsonl",
                       help='Input JSONL file path (default: examples/examples.jsonl)')
    parser.add_argument('--output_dir', type=str, default="api_outputs",
                       help='Output directory path (default: api_outputs)')
    parser.add_argument('--max_workers', type=int, default=8,
                       help='Maximum number of concurrent workers (default: 8)')
    
    args = parser.parse_args()
    
    main(args.jsonl_file, args.output_dir, args.max_workers)