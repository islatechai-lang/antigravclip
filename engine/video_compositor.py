"""
Smart 9:16 Vertical Video Compositor & Pipeline Engine
Transforms horizontal 16:9 streams into high-retention 9:16 vertical shorts (TikTok/Reels/Shorts).
Features:
- Split layout: Top streamer facecam (consistent 100% framing) + Bottom centered gameplay.
- Viral hook card: Instagram/Reels white pill sticker with bold text & authentic full-color emojis centered on the seam.
- Word-level animated ASS subtitles burned in one pass.
- JSON metadata card generation for instant upload.
"""

import os
import subprocess
import json
import time
from pathlib import Path
from typing import Optional, Dict, Any, Tuple
from .ai_director import DirectorDecision
from .face_tracker import FaceTracker
from .sticker_generator import StickerGenerator


class VideoCompositor:
    def __init__(
        self,
        output_dir: str = "./output",
        cache_dir: str = "./cache",
        target_width: int = 1080,
        target_height: int = 1920,
        facecam_ratio: float = 0.35, # Top 35% height for facecam
        gameplay_ratio: float = 0.65, # Bottom 65% height for gameplay
        hook_banner_duration: Optional[float] = None # None means stays visible throughout the entire clip
    ):
        self.output_dir = Path(output_dir)
        self.cache_dir = Path(cache_dir)
        self.metadata_dir = self.output_dir / "metadata"
        self.target_width = target_width
        self.target_height = target_height
        self.facecam_ratio = facecam_ratio
        self.gameplay_ratio = gameplay_ratio
        self.hook_banner_duration = hook_banner_duration
        self.face_tracker = FaceTracker(cache_dir=cache_dir)
        self.sticker_generator = StickerGenerator(cache_dir=cache_dir)

        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.metadata_dir.mkdir(parents=True, exist_ok=True)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def render_short(
        self,
        source_video: str,
        decision: DirectorDecision,
        ass_subtitles_path: Optional[str] = None,
        facecam_box: Optional[Tuple[float, float, float, float]] = None,
        channel_name: str = "Streamer",
        extra_metadata: Optional[Dict[str, Any]] = None
    ) -> Optional[str]:
        """
        Renders the final 9:16 short video from source_video using decision timestamps,
        facecam stacking, authentic emoji sticker overlay, and burned subtitles.
        """
        timestamp_id = int(time.time())
        output_filename = f"clip_{channel_name.lower()}_{timestamp_id}.mp4"
        output_path = self.output_dir / output_filename
        metadata_path = self.metadata_dir / f"clip_{channel_name.lower()}_{timestamp_id}.json"

        # Calculate layout heights
        top_h = int(self.target_height * self.facecam_ratio)
        bottom_h = self.target_height - top_h
        w = self.target_width

        # Automated calibrated facecam detection
        if not facecam_box:
            facecam_box = self.face_tracker.detect_facecam_box(source_video, channel_name=channel_name)

        fx_r, fy_r, fw_r, fh_r = facecam_box
        print(f"[VideoCompositor] Using facecam crop: x={fx_r:.3f}, y={fy_r:.3f}, w={fw_r:.3f}, h={fh_r:.3f}")

        # Generate authentic emoji hook card sticker (PNG)
        sticker_png_path = self.cache_dir / f"sticker_{timestamp_id}.png"
        has_sticker = False
        try:
            self.sticker_generator.generate_sticker_card(
                hook_title=decision.hook_title,
                output_path=str(sticker_png_path)
            )
            has_sticker = sticker_png_path.exists()
        except Exception as e:
            print(f"[VideoCompositor] Failed to generate sticker card: {e}")

        # Build FFmpeg filtergraph:
        filter_parts = []
        
        # 1. Split input video for facecam and gameplay
        filter_parts.append("[0:v]split=2[raw_cam][raw_game]")
        
        # 2. Crop & scale facecam to top 35%
        filter_parts.append(
            f"[raw_cam]crop=iw*{fw_r:.3f}:ih*{fh_r:.3f}:iw*{fx_r:.3f}:ih*{fy_r:.3f},"
            f"scale={w}:{top_h}:force_original_aspect_ratio=increase,"
            f"crop={w}:{top_h}[top_cam]"
        )
        
        # 3. Crop & scale gameplay (center crop 9:16 ratio)
        filter_parts.append(
            f"[raw_game]crop=ih*({w}/{bottom_h:.0f}):ih:(iw-ih*({w}/{bottom_h:.0f}))/2:0,"
            f"scale={w}:{bottom_h}[bottom_game]"
        )
        
        # 4. Vertical stack
        filter_parts.append("[top_cam][bottom_game]vstack=inputs=2[stacked]")
        current_video_label = "[stacked]"

        # 5. Overlay white sticker pill with authentic color emojis centered on the seam
        # Stays visible throughout the entire video for consistent context and virality
        extra_inputs = []
        if has_sticker:
            extra_inputs.extend(["-i", str(sticker_png_path)])
            sticker_input_idx = 1
            if self.hook_banner_duration is not None and self.hook_banner_duration > 0:
                overlay_filter = f"overlay=(W-w)/2:{top_h}-(h/2):enable='between(t,0,{self.hook_banner_duration})'"
            else:
                overlay_filter = f"overlay=(W-w)/2:{top_h}-(h/2)"
            filter_parts.append(f"{current_video_label}[{sticker_input_idx}:v]{overlay_filter}[with_sticker]")
            current_video_label = "[with_sticker]"

        # 6. Burn kinetic subtitles if provided
        if ass_subtitles_path and os.path.exists(ass_subtitles_path):
            escaped_ass = str(Path(ass_subtitles_path).resolve()).replace("\\", "/").replace(":", "\\:")
            filter_parts.append(f"{current_video_label}ass='{escaped_ass}'[v_out]")
            current_video_label = "[v_out]"

        filtergraph = ";".join(filter_parts)

        duration = max(1.0, round(decision.clip_end_sec - decision.clip_start_sec, 2))
        cmd = [
            "ffmpeg",
            "-y",
            "-ss", str(decision.clip_start_sec),
            "-t", str(duration),
            "-i", str(source_video),
        ] + extra_inputs + [
            "-filter_complex", filtergraph,
            "-map", current_video_label,
            "-map", "0:a?",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "20",
            "-c:a", "aac",
            "-b:a", "128k",
            "-movflags", "+faststart",
            str(output_path)
        ]

        print(f"[VideoCompositor] Rendering 9:16 short ({decision.clip_start_sec:.1f}s -> {decision.clip_end_sec:.1f}s, dur {duration:.1f}s)...")
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            if res.returncode != 0:
                print(f"[VideoCompositor] FFmpeg render failed:\n{res.stderr[-600:]}")
                return None

            # Clean up temporary sticker
            if sticker_png_path.exists():
                try:
                    sticker_png_path.unlink()
                except Exception:
                    pass

            # Write metadata card inside output/metadata/
            metadata = {
                "file": output_filename,
                "channel": channel_name,
                "hook_title": decision.hook_title,
                "caption": decision.caption,
                "virality_score": decision.virality_score,
                "reasoning": decision.reasoning,
                "duration_seconds": round(decision.clip_end_sec - decision.clip_start_sec, 2),
                "created_at": time.strftime("%Y-%m-%d %H:%M:%S")
            }
            if extra_metadata:
                metadata.update(extra_metadata)

            with open(metadata_path, "w", encoding="utf-8") as f:
                json.dump(metadata, f, indent=2)

            print(f"[VideoCompositor] Successfully rendered: {output_path}")
            print(f"[VideoCompositor] Metadata card saved to: {metadata_path}")
            return str(output_path)

        except Exception as e:
            print(f"[VideoCompositor] Error during rendering: {e}")
            return None
