"""
End-to-End Demonstration Script
Generates a sample 16:9 gaming stream clip with audio,
and runs the complete Clipper Pipeline to produce a ready-to-post 9:16 Short.
"""

import os
import subprocess
from pathlib import Path
import engine
from run_clipper import ClipperOrchestrator, load_config

def main():
    sample_dir = Path("./sample")
    sample_dir.mkdir(exist_ok=True)
    sample_video = sample_dir / "sample_stream.mp4"

    print("Generating simulated 16:9 stream clip...")
    # Generate 16:9 720p video with speech/sine and colored boxes
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
        "-t", "20",
        "-c:v", "libx264", "-c:a", "aac",
        str(sample_video)
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"Sample video generated: {sample_video}")

    cfg = load_config("config.yaml")
    cfg.setdefault("ai_director", {})["provider"] = "heuristic"
    orchestrator = ClipperOrchestrator(cfg, channel_override="StreamerX")

    print("\nRunning complete Clipper Pipeline...")
    orchestrator.process_candidate(
        video_slice_path=str(sample_video),
        spike_offset_sec=10.0,
        chat_emotes=["OMEGALUL", "W", "DEAD", "NO WAY"],
        channel_name="StreamerX"
    )

if __name__ == "__main__":
    main()
