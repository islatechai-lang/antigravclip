"""
Autonomous AI Clipper Cloud Backend Server (FastAPI)
Provides REST API endpoints for starting, pausing, stopping, and monitoring
live clipping on any streamer handle (Twitch/YouTube) 24/7 in the cloud (Render/Railway/Docker).
"""

import os
import sys
import time
import threading
from typing import Optional
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

# Global orchestrator state
class EngineState:
    def __init__(self):
        self.orchestrator: Optional[ClipperOrchestrator] = None
        self.worker_thread: Optional[threading.Thread] = None
        self.is_running: bool = False
        self.current_channel: str = "ishowspeed"
        self.current_platform: str = "youtube"
        self.started_at: Optional[float] = None

state = EngineState()
clip_store = ClipStore()


class StartClipperRequest(BaseModel):
    channel: str
    platform: Optional[str] = "twitch" # "twitch" or "youtube"


@app.get("/")
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

    if state.is_running:
        if state.current_channel == clean_channel:
            return {"status": "already_running", "channel": clean_channel}
        # Stop existing monitor
        stop_clipper()
        time.sleep(1)

    config = load_config("config.yaml")
    platform = req.platform or ("youtube" if clean_channel in ["ishowspeed"] else "twitch")
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

    print("[Cloud Backend] Stopping active clipper...")
    try:
        if state.orchestrator.chat_monitor:
            state.orchestrator.chat_monitor.stop()
        if state.orchestrator.stream_buffer:
            state.orchestrator.stream_buffer.stop_recording()
    except Exception as e:
        print(f"[Cloud Backend] Warning during stop: {e}")

    state.is_running = False
    state.started_at = None
    return {"status": "stopped", "channel": state.current_channel}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=None)
    args, _ = parser.parse_known_args()

    port = args.port or int(os.environ.get("BACKEND_PORT", 8000))
    print(f"🚀 Starting AntigravClip Cloud Backend on port {port}...")
    uvicorn.run("backend_server:app", host="0.0.0.0", port=port, reload=False)
