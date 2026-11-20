"""
Autonomous AI Stream Clipper Engine
"""
import os
import sys
import shutil

__version__ = "1.0.0"

# Ensure newly installed Winget FFmpeg path is always discovered in Python subprocesses
def _ensure_ffmpeg_path():
    if not shutil.which("ffmpeg"):
        winget_ffmpeg_dir = os.path.expanduser(
            r"~\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin"
        )
        if os.path.isdir(winget_ffmpeg_dir):
            os.environ["PATH"] = winget_ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")

_ensure_ffmpeg_path()
