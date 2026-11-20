"""
Autonomous AI Clipper Cloud Backend Server (FastAPI)
Provides REST API endpoints for starting, pausing, stopping, and monitoring
live clipping on any streamer handle (Twitch/YouTube) 24/7 in the cloud (Render/Railway/Docker).
"""

import os
import sys
import time
import threading
from typing import Optional, List
from collections import deque
from datetime import datetime
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import yaml

from run_clipper import ClipperOrchestrator, load_config
from engine.clip_store import ClipStore

app = FastAPI(title="AntigravClip Cloud Engine API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global logging system
class LogManager:
    def __init__(self, maxlen=500):
        self.logs = deque(maxlen=maxlen)
        self._lock = threading.Lock()
        self.add("[System] AntigravClip Cloud Engine initialized and listening", source="System", level="info")

    def add(self, message: str, source: str = "Engine", level: str = "info"):
        now = datetime.now().strftime("%H:%M:%S")
        entry = {
            "id": f"{time.time()}_{len(self.logs)}",
            "time": now,
            "message": message.strip(),
            "source": source,
            "level": level
        }
        with self._lock:
            self.logs.append(entry)

    def get_all(self, limit: int = 200):
        with self._lock:
            return list(self.logs)[-limit:]

    def clear(self):
        with self._lock:
            self.logs.clear()
            self.add("[System] Console logs cleared by user", source="System", level="info")

log_manager = LogManager()


class StdoutCapture:
    def __init__(self, original_stdout, log_mgr):
        self.original_stdout = original_stdout
        self.log_mgr = log_mgr

    def write(self, s):
        self.original_stdout.write(s)
        self.original_stdout.flush()
        text = s.strip()
        if text:
            level = "info"
            lower = text.lower()
            if "error" in lower or "exception" in lower or "fail" in lower:
                level = "error"
            elif "spike detected" in lower or "warning" in lower or "warn" in lower:
                level = "warning"
            elif "success" in lower or "passed" in lower or "rendered" in lower or "ready-to-post" in lower:
                level = "success"

            source = "Engine"
            if text.startswith("["):
                end_bracket = text.find("]")
                if end_bracket > 0:
                    source = text[1:end_bracket].strip()

            self.log_mgr.add(text, source=source, level=level)

    def flush(self):
        self.original_stdout.flush()

    def isatty(self):
        return getattr(self.original_stdout, "isatty", lambda: False)()

    def fileno(self):
        return getattr(self.original_stdout, "fileno", lambda: 1)()

    def __getattr__(self, name):
        return getattr(self.original_stdout, name)

sys.stdout = StdoutCapture(sys.stdout, log_manager)

# Global orchestrator state
class EngineState:
    def __init__(self):
        self.orchestrator: Optional[ClipperOrchestrator] = None
        self.worker_thread: Optional[threading.Thread] = None
        self.is_running: bool = False
        self.current_channel: str = ""
        self.current_platform: str = "twitch"
        self.started_at: Optional[float] = None

state = EngineState()
clip_store = ClipStore()


class StartClipperRequest(BaseModel):
    channel: str
    platform: Optional[str] = "twitch" # "twitch" or "youtube"


@app.api_route("/", methods=["GET", "HEAD"])
def root():
    return {"status": "online", "service": "AntigravClip Cloud Engine"}


@app.get("/api/status")
def get_status():
    uptime = time.time() - state.started_at if state.started_at and state.is_running else 0
    clips = clip_store.get_all()
    
    return {
        "is_running": state.is_running,
        "channel": state.current_channel,
        "platform": state.current_platform,
        "uptime_seconds": int(uptime),
        "total_clips": len(clips),
        "pending_clips": len([c for c in clips if c.get("status") == "pending"]),
        "posted_clips": len([c for c in clips if c.get("status") in ["posted", "approved"]]),
    }


class AddLogRequest(BaseModel):
    message: str
    source: Optional[str] = "UI"
    level: Optional[str] = "info"


@app.get("/api/logs")
def get_logs(limit: int = 150):
    return {"logs": log_manager.get_all(limit)}


@app.post("/api/logs")
def add_log(req: AddLogRequest):
    log_manager.add(req.message, source=req.source, level=req.level)
    return {"status": "logged"}


@app.delete("/api/logs")
def clear_logs():
    log_manager.clear()
    return {"status": "cleared"}


def _run_clipper_loop(config: dict, channel: str, platform: str):
    try:
        state.orchestrator = ClipperOrchestrator(config, channel_override=channel, platform_override=platform)
        state.is_running = True
        state.started_at = time.time()
        print(f"[Cloud Backend] Clipper started for {platform} #{channel}")
        state.orchestrator.start_live()
    except Exception as e:
        print(f"[Cloud Backend] Clipper encountered error: {e}")
    finally:
        state.is_running = False
        state.started_at = None
        print(f"[Cloud Backend] Clipper stopped for {platform} #{channel}")


@app.post("/api/start")
def start_clipper(req: StartClipperRequest):
    clean_channel = req.channel.strip().lower().lstrip("#").lstrip("@")
    if not clean_channel:
        raise HTTPException(status_code=400, detail="Channel handle cannot be empty")

    platform = (req.platform or "twitch").strip().lower()
    if platform not in ["twitch", "youtube"]:
        platform = "twitch"

    if state.is_running:
        if state.current_channel == clean_channel and state.current_platform == platform:
            return {"status": "already_running", "channel": clean_channel, "platform": platform}
        # Stop existing monitor
        stop_clipper()
        time.sleep(1)

    config = load_config("config.yaml")
    state.current_channel = clean_channel
    state.current_platform = platform

    state.worker_thread = threading.Thread(
        target=_run_clipper_loop,
        args=(config, clean_channel, platform),
        daemon=True
    )
    state.worker_thread.start()

    return {
        "status": "started",
        "channel": clean_channel,
        "platform": platform
    }


@app.post("/api/stop")
def stop_clipper():
    if not state.is_running or not state.orchestrator:
        return {"status": "not_running"}

    print(f"[Cloud Backend] Stopping active clipper for {state.current_platform} #{state.current_channel}...")
    try:
        state.orchestrator.stop()
    except Exception as e:
        print(f"[Cloud Backend] Warning during stop: {e}")

    state.is_running = False
    state.started_at = None
    return {"status": "stopped", "channel": state.current_channel, "platform": state.current_platform}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=None)
    args, _ = parser.parse_known_args()

    port = args.port or int(os.environ.get("BACKEND_PORT", 8000))
    print(f"🚀 Starting AntigravClip Cloud Backend on port {port}...")
    uvicorn.run("backend_server:app", host="0.0.0.0", port=port, reload=False)
