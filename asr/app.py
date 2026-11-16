import asyncio
import logging
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from faster_whisper import WhisperModel


logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("dclaw-asr")

MODEL_NAME = os.getenv("ASR_MODEL", "small").strip() or "small"
DEVICE = os.getenv("ASR_DEVICE", "cpu").strip() or "cpu"
COMPUTE_TYPE = os.getenv("ASR_COMPUTE_TYPE", "int8").strip() or "int8"
DOWNLOAD_ROOT = os.getenv("ASR_DOWNLOAD_ROOT", "/models/faster-whisper")
CPU_THREADS = max(1, int(os.getenv("ASR_CPU_THREADS", "4")))
BEAM_SIZE = max(1, int(os.getenv("ASR_BEAM_SIZE", "5")))
MAX_AUDIO_BYTES = max(1, int(os.getenv("ASR_MAX_AUDIO_BYTES", str(12 * 1024 * 1024))))
ALLOWED_SUFFIXES = {".mp3", ".m4a", ".mp4", ".ogg", ".wav", ".webm"}
ALLOWED_CONTENT_TYPES = {"audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm", "video/mp4"}


def load_model():
    logger.info("Loading ASR model=%s device=%s compute_type=%s", MODEL_NAME, DEVICE, COMPUTE_TYPE)
    model = WhisperModel(
        MODEL_NAME,
        device=DEVICE,
        compute_type=COMPUTE_TYPE,
        cpu_threads=CPU_THREADS,
        num_workers=1,
        download_root=DOWNLOAD_ROOT,
    )
    logger.info("ASR model ready")
    return model


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.model = await asyncio.to_thread(load_model)
    app.state.transcription_lock = asyncio.Lock()
    yield


app = FastAPI(title="DClaw Local ASR", version="1.0.0", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"ok": True, "service": "dclaw-asr", "model": MODEL_NAME, "device": DEVICE}


def transcribe_file(model, file_path: str, language: str):
    segments, info = model.transcribe(
        file_path,
        language=language or "zh",
        beam_size=BEAM_SIZE,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 300},
        condition_on_previous_text=False,
    )
    text = "".join(segment.text for segment in segments).strip()
    return text, getattr(info, "language", language or "zh"), getattr(info, "duration", None)


@app.post("/v1/audio/transcriptions")
async def transcriptions(
    file: UploadFile = File(...),
    model: str = Form(default=""),
    language: str = Form(default="zh"),
):
    del model  # The server controls the loaded model to keep memory usage predictable.
    if file.content_type and file.content_type.lower() not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail="不支持的语音格式")
    payload = await file.read(MAX_AUDIO_BYTES + 1)
    if not payload:
        raise HTTPException(status_code=400, detail="语音内容为空")
    if len(payload) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="语音文件过大")

    suffix = Path(file.filename or "voice.mp3").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        suffix = ".mp3"

    temporary_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temporary:
            temporary.write(payload)
            temporary_path = temporary.name
        async with app.state.transcription_lock:
            text, detected_language, duration = await asyncio.to_thread(
                transcribe_file,
                app.state.model,
                temporary_path,
                language.strip() or "zh",
            )
    except HTTPException:
        raise
    except Exception as error:
        logger.exception("ASR transcription failed")
        raise HTTPException(status_code=500, detail="语音识别失败") from error
    finally:
        if temporary_path:
            Path(temporary_path).unlink(missing_ok=True)

    if not text:
        raise HTTPException(status_code=422, detail="未识别到有效语音")
    return {"text": text, "language": detected_language, "duration": duration}

