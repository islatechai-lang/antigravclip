"""
Automated Facecam & Streamer Detection Engine
Uses YuNet neural face detection to locate streamer facecams dynamically,
with calibrated presets and quadrant locking for rock-solid, jitter-free framing.
"""

import os
import cv2
import numpy as np
from pathlib import Path
from typing import Optional, Tuple

YUNET_MODEL_URL = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"

# High-precision calibrated streamer webcam coordinates [x, y, w, h] as ratios of 16:9 canvas
# Framed to exclude viewer counters, subscriber tickers, and stream overlays
PRESET_COORDINATES = {
    "ishowspeed": (0.008, 0.444, 0.212, 0.194),  # Lower-left clean webcam frame
    "speed": (0.008, 0.444, 0.212, 0.194),
    "tarik": (0.720, 0.600, 0.270, 0.380),       # Lower-right webcam
    "caseoh_": (0.000, 0.000, 0.350, 0.450),     # Upper-left
    "jynxzi": (0.720, 0.600, 0.270, 0.380),      # Lower-right
    "ohnepixel": (0.750, 0.610, 0.240, 0.370),   # Lower-right
    "shroud": (0.700, 0.020, 0.290, 0.370)       # Upper-right
}


class FaceTracker:
    def __init__(self, cache_dir: str = "./cache"):
        self.cache_dir = Path(cache_dir)
        self.model_path = self.cache_dir / "yunet.onnx"
        self._detector = None

    def _ensure_model(self) -> bool:
        if self.model_path.exists() and os.path.getsize(self.model_path) > 100000:
            return True
        import urllib.request
        try:
            print("[FaceTracker] Downloading YuNet face detection neural weights (230KB)...")
            self.model_path.parent.mkdir(parents=True, exist_ok=True)
            urllib.request.urlretrieve(YUNET_MODEL_URL, str(self.model_path))
            return True
        except Exception as e:
            print(f"[FaceTracker] Could not download YuNet model: {e}")
            return False

    def detect_facecam_box(
        self,
        video_path: str,
        channel_name: str = ""
    ) -> Tuple[float, float, float, float]:
        """
        Returns normalized (x, y, w, h) bounding box for the facecam crop.
        If channel matches a calibrated preset, returns it immediately to guarantee
        100% framing consistency across all generated clips.
        Otherwise uses YuNet to find the face and locks to a stable quadrant webcam box.
        """
        clean_channel = channel_name.lower().lstrip("@").strip()
        if clean_channel in PRESET_COORDINATES:
            box = PRESET_COORDINATES[clean_channel]
            print(f"[FaceTracker] Using calibrated studio preset for '{clean_channel}': x={box[0]:.3f}, y={box[1]:.3f}, w={box[2]:.3f}, h={box[3]:.3f}")
            return box

        fallback_box = (0.008, 0.444, 0.212, 0.194)

        if not self._ensure_model():
            return fallback_box

        try:
            cap = cv2.VideoCapture(video_path)
            if not cap.isOpened():
                return fallback_box

            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            if w <= 0 or h <= 0 or total_frames <= 0:
                cap.release()
                return fallback_box

            detector = cv2.FaceDetectorYN_create(str(self.model_path), "", (w, h), score_threshold=0.6)

            # Sample frames across the video
            sample_indices = np.linspace(5, min(total_frames - 1, 180), num=6, dtype=int)
            detected_faces = []

            for idx in sample_indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
                ret, frame = cap.read()
                if not ret or frame is None:
                    continue

                faces = detector.detect(frame)
                if faces[1] is not None:
                    for f in faces[1]:
                        fx, fy, fw, fh = f[:4]
                        # Discard tiny background faces or full-screen game faces
                        if 25 <= fw <= (w * 0.45) and 25 <= fh <= (h * 0.45):
                            detected_faces.append((fx / w, fy / h, fw / w, fh / h))

            cap.release()

            if not detected_faces:
                print(f"[FaceTracker] No face detected. Using fallback.")
                return fallback_box

            # Average detected face coordinates
            avg_fx = float(np.mean([f[0] for f in detected_faces]))
            avg_fy = float(np.mean([f[1] for f in detected_faces]))
            avg_fw = float(np.mean([f[2] for f in detected_faces]))
            avg_fh = float(np.mean([f[3] for f in detected_faces]))

            # Determine quadrant:
            # Bottom-left (Speed, most gaming creators)
            if avg_fx < 0.35 and avg_fy > 0.35:
                # Fixed clean webcam aspect ratio framing
                box_w = 0.22
                box_h = 0.20
                box_x = max(0.005, min(0.15, avg_fx - 0.05))
                box_y = max(0.40, min(0.55, avg_fy - 0.06))
            # Bottom-right (Tarik, Jynxzi, OhnePixel)
            elif avg_fx > 0.65 and avg_fy > 0.35:
                box_w = 0.26
                box_h = 0.36
                box_x = 0.72
                box_y = 0.60
            # Top-left (CaseOh)
            elif avg_fx < 0.35 and avg_fy < 0.35:
                box_w = 0.32
                box_h = 0.42
                box_x = 0.01
                box_y = 0.01
            # Top-right (Shroud)
            elif avg_fx > 0.65 and avg_fy < 0.35:
                box_w = 0.28
                box_h = 0.36
                box_x = 0.70
                box_y = 0.02
            else:
                # Center camera or full-screen stream
                box_w = 0.35
                box_h = 0.35
                box_x = max(0.0, min(1.0 - box_w, (avg_fx + avg_fw / 2.0) - box_w / 2.0))
                box_y = max(0.0, min(1.0 - box_h, (avg_fy + avg_fh / 2.0) - box_h / 2.0))

            print(f"[FaceTracker] Locked facecam framing at x={box_x:.3f}, y={box_y:.3f}, w={box_w:.3f}, h={box_h:.3f}")
            return (box_x, box_y, box_w, box_h)

        except Exception as e:
            print(f"[FaceTracker] Face detection error: {e}. Using fallback.")
            return fallback_box
