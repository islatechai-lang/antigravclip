"""
Rolling Video Buffer & Slice Extraction Engine
Uses streamlink to acquire live streams and maintains a continuous rolling circular buffer via FFmpeg.
Features active health monitoring, auto-reconnection, and staleness detection to guarantee fresh slices.
"""

import os
import subprocess
import time
import shutil
import glob
from pathlib import Path
from typing import Optional, List


class StreamBuffer:
    def __init__(
        self,
        channel: str,
        platform: str = "twitch",
        cache_dir: str = "./cache",
        buffer_duration_sec: int = 300,
        segment_time_sec: int = 4,
        stream_quality: str = "720p60,720p,best"
    ):
        self.channel = channel.lower().lstrip("#")
        self.platform = platform.lower()
        self.cache_dir = Path(cache_dir)
        self.buffer_dir = self.cache_dir / f"buffer_{self.channel}"
        self.buffer_duration_sec = buffer_duration_sec
        self.segment_time_sec = segment_time_sec
        self.stream_quality = stream_quality

        self.num_segments = max(10, int(buffer_duration_sec / segment_time_sec))
        self._process: Optional[subprocess.Popen] = None
        self._streamlink_proc: Optional[subprocess.Popen] = None
        self._running = False
        self._start_time = 0.0

    def get_channel_url(self) -> str:
        """Constructs target live stream URL."""
        clean_name = self.channel.lstrip("@").lower()
        if self.platform == "youtube":
            return f"https://www.youtube.com/@{clean_name}/live"
        return f"https://twitch.tv/{clean_name}"

    def is_stream_live(self) -> bool:
        """Probes streamlink to determine if the broadcast is currently live."""
        channel_url = self.get_channel_url()
        try:
            cmd = ["streamlink", "--stream-timeout", "15", "--stream-url", channel_url]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
            return res.returncode == 0 and res.stdout.strip().startswith("http")
        except Exception:
            return False

    def start_recording(self) -> bool:
        """Starts streamlink piped to FFmpeg rolling segmenter for continuous recording."""
        self.stop_recording()
        self.buffer_dir.mkdir(parents=True, exist_ok=True)
        
        # Clear existing old segments
        for f in self.buffer_dir.glob("*.ts"):
            try:
                f.unlink()
            except Exception:
                pass

        clean_name = self.channel.lstrip("@").lower()
        channel_url = self.get_channel_url()

        output_pattern = str(self.buffer_dir / "segment_%04d.ts")

        try:
            streamlink_cmd = [
                "streamlink",
                "--retry-streams", "5",
                "--retry-max", "10",
                "--hls-live-restart",
                "--stream-timeout", "20",
                "-O",
                channel_url,
                self.stream_quality
            ]
            ffmpeg_cmd = [
                "ffmpeg",
                "-y",
                "-i", "pipe:0",
                "-c", "copy",
                "-f", "segment",
                "-segment_time", str(self.segment_time_sec),
                "-segment_wrap", str(self.num_segments),
                "-reset_timestamps", "1",
                str(output_pattern)
            ]

            self._streamlink_proc = subprocess.Popen(
                streamlink_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL
            )
            self._process = subprocess.Popen(
                ffmpeg_cmd,
                stdin=self._streamlink_proc.stdout,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
            # Allow streamlink to receive SIGPIPE if ffmpeg exits
            self._streamlink_proc.stdout.close()

            self._running = True
            self._start_time = time.time()
            print(f"[StreamBuffer] Continuous rolling streamlink->FFmpeg buffer started ({self.num_segments} x {self.segment_time_sec}s).")
            return True
        except Exception as e:
            print(f"[StreamBuffer] Failed to start piped buffer: {e}")
            return False

    def is_healthy(self, max_staleness_sec: float = 25.0) -> bool:
        """
        Checks if the buffer processes are still alive and actively writing fresh segments.
        Returns False if processes exited or the newest segment is older than max_staleness_sec.
        """
        if not self._running:
            return False

        if self._streamlink_proc and self._streamlink_proc.poll() is not None:
            return False
        if self._process and self._process.poll() is not None:
            return False

        # Check latest segment write time
        segments = list(self.buffer_dir.glob("segment_*.ts"))
        if not segments:
            # If just started within 15 seconds, give it time
            return (time.time() - self._start_time) < 18.0

        latest_mtime = max(os.path.getmtime(s) for s in segments)
        age = time.time() - latest_mtime
        return age <= max_staleness_sec

    def ensure_healthy(self) -> bool:
        """Restarts recording automatically if streamlink or FFmpeg died or stalled."""
        if not self.is_healthy():
            print("[StreamBuffer] Buffer health check failed (stalled or disconnected). Auto-reconnecting stream...")
            return self.start_recording()
        return True

    def stop_recording(self):
        """Stops the rolling buffer processes."""
        self._running = False
        for p in [getattr(self, "_process", None), getattr(self, "_streamlink_proc", None)]:
            if p:
                try:
                    p.terminate()
                    p.wait(timeout=2)
                except Exception:
                    try:
                        p.kill()
                    except Exception:
                        pass
        self._process = None
        self._streamlink_proc = None

    def extract_slice_from_buffer(
        self,
        output_path: str,
        slice_duration_sec: float = 70.0
    ) -> Optional[str]:
        """
        Gathers the most recent segments totaling slice_duration_sec and stitches them into output_path.
        Guarantees that the extracted slice is fresh and not from a stalled buffer.
        """
        segments = sorted(self.buffer_dir.glob("segment_*.ts"), key=os.path.getmtime)
        if not segments:
            print("[StreamBuffer] No segments found in buffer to extract slice.")
            self.ensure_healthy()
            return None

        # Staleness check: guarantee segments were recorded within the last 30 seconds
        latest_mtime = max(os.path.getmtime(s) for s in segments)
        age_sec = time.time() - latest_mtime
        if age_sec > 30.0:
            print(f"[StreamBuffer] Buffer is stale ({age_sec:.1f}s old). Skipping slice and reconnecting live stream...")
            self.start_recording()
            return None

        segments_needed = min(len(segments), int(slice_duration_sec / self.segment_time_sec) + 2)
        selected_segments = segments[-segments_needed:]

        concat_list_file = self.buffer_dir / f"concat_{int(time.time())}.txt"
        with open(concat_list_file, "w", encoding="utf-8") as f:
            for seg in selected_segments:
                abs_path = str(seg.resolve()).replace("\\", "/")
                f.write(f"file '{abs_path}'\n")

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

        cmd = [
            "ffmpeg",
            "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(concat_list_file),
            "-c", "copy",
            str(output_path)
        ]

        try:
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                concat_list_file.unlink()
            except Exception:
                pass
            return output_path
        except Exception as e:
            print(f"[StreamBuffer] Failed to extract video slice: {e}")
            return None

    def extract_offline_slice(
        self,
        source_video: str,
        start_sec: float,
        duration_sec: float,
        output_path: str
    ) -> Optional[str]:
        """Utility for offline videos / testing: cuts a slice from an existing file."""
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        cmd = [
            "ffmpeg",
            "-y",
            "-ss", str(start_sec),
            "-i", str(source_video),
            "-t", str(duration_sec),
            "-c:v", "libx264",
            "-c:a", "aac",
            str(output_path)
        ]
        try:
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return output_path
        except Exception as e:
            print(f"[StreamBuffer] Offline slice extraction failed: {e}")
            return None
