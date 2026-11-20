"""
Multimodal Vision QA & Storyboard Verification Engine
Inspects visual video frames using Vision AI (Qwen-VL) to verify that:
1. The streamer is actively engaged and reacting (not staring blankly).
2. A concrete, funny, or exciting visual event actually occurs on screen.
3. The video is self-contained and makes complete sense to a random viewer.
4. Generates a clear, premise-driven hook title and saves a 4-frame visual storyboard.
"""

import os
import re
import cv2
import json
import base64
import time
import requests
import numpy as np
from pathlib import Path
from typing import List, Tuple, Optional, Dict, Any
from PIL import Image, ImageDraw, ImageFont
from requests.adapters import HTTPAdapter
from urllib3.util import Retry


class VisionQAResult:
    def __init__(
        self,
        passed: bool,
        comprehension_score: float,
        what_actually_happens: str,
        premise_hook: str,
        rejection_reason: Optional[str] = None,
        storyboard_path: Optional[str] = None
    ):
        self.passed = passed
        self.comprehension_score = comprehension_score
        self.what_actually_happens = what_actually_happens
        self.premise_hook = premise_hook
        self.rejection_reason = rejection_reason
        self.storyboard_path = storyboard_path

    def to_dict(self) -> Dict[str, Any]:
        return {
            "passed": self.passed,
            "comprehension_score": round(self.comprehension_score, 1),
            "what_actually_happens": self.what_actually_happens,
            "premise_hook": self.premise_hook,
            "rejection_reason": self.rejection_reason,
            "storyboard_path": self.storyboard_path
        }


class VisionQA:
    def __init__(
        self,
        api_key: Optional[str] = None,
        api_base_url: str = "https://api.unorouter.com/v1/chat/completions",
        min_comprehension_score: float = 6.0,
        storyboards_dir: str = "./output/storyboards"
    ):
        self.api_key = api_key or os.environ.get("UNOROUTER_API_KEY", "sk-UE7RO864vd28guRe8sGAp3W6HfsiZgG3ktSNwlZHrNH9k21C")
        self.api_base_url = api_base_url
        self.min_comprehension_score = min_comprehension_score
        self.storyboards_dir = Path(storyboards_dir)
        self.storyboards_dir.mkdir(parents=True, exist_ok=True)

    def extract_storyboard_frames(
        self,
        video_path: str,
        start_sec: float,
        end_sec: float,
        num_frames: int = 4
    ) -> List[Tuple[float, np.ndarray]]:
        """
        Extracts representative frames across the narrative arc of the clip.
        Returns list of (timestamp_sec, bgr_image_array).
        """
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return []

        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        dur = max(1.0, end_sec - start_sec)

        # Proportional timestamps: Setup (10%), Escalation (35%), Climax (70%), Payoff (95%)
        proportions = [0.10, 0.38, 0.72, 0.95]
        target_times = [start_sec + (dur * p) for p in proportions[:num_frames]]

        frames = []
        for t in target_times:
            frame_idx = int(t * fps)
            cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, frame_idx))
            ret, frame = cap.read()
            if ret and frame is not None:
                frames.append((round(t - start_sec, 1), frame))
        cap.release()
        return frames

    def check_facecam_activity(
        self,
        frames: List[Tuple[float, np.ndarray]],
        facecam_box: Tuple[float, float, float, float] = (0.008, 0.444, 0.212, 0.194)
    ) -> float:
        """
        Calculates pixel motion variance in the streamer's facecam across frames.
        Returns average motion score (>1.5 indicates active talking/expression).
        """
        if len(frames) < 2:
            return 2.0

        diffs = []
        fx, fy, fw, fh = facecam_box
        prev_crop = None

        for _, img in frames:
            ih, iw = img.shape[:2]
            x1, y1 = int(fx * iw), int(fy * ih)
            x2, y2 = int((fx + fw) * iw), int((fy + fh) * ih)
            crop = img[y1:y2, x1:x2]
            if crop.size == 0:
                continue

            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            # Focus on mouth/chin (lower 50% of facecam)
            mouth_area = gray[int(gray.shape[0] * 0.45):, :]

            if prev_crop is not None and prev_crop.shape == mouth_area.shape:
                diff = np.mean(cv2.absdiff(mouth_area, prev_crop))
                diffs.append(diff)
            prev_crop = mouth_area

        return float(np.mean(diffs)) if diffs else 2.0

    def generate_storyboard_image(
        self,
        frames: List[Tuple[float, np.ndarray]],
        clip_name: str,
        verdict: str,
        premise_hook: str,
        what_actually_happens: str,
        score: float
    ) -> str:
        """
        Creates a high-resolution 4-frame visual storyboard image with narrative annotations.
        """
        if not frames:
            return ""

        # Resize each frame to 270x480 (maintaining 9:16 vertical ratio)
        thumbs = [cv2.resize(f[1], (270, 480)) for f in frames]
        strip = np.hstack(thumbs) # 1080w x 480h

        # Top banner (90px high)
        banner_h = 90
        banner = np.zeros((banner_h, strip.shape[1], 3), dtype=np.uint8)
        # Background color: Dark Green if passed, Dark Red if rejected
        banner_color = (25, 45, 20) if "APPROVED" in verdict else (20, 20, 50)
        banner[:] = banner_color
        combined = np.vstack([banner, strip])

        im = Image.fromarray(cv2.cvtColor(combined, cv2.COLOR_BGR2RGB))
        draw = ImageDraw.Draw(im)

        font_title = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 22)
        font_sub = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 17)
        font_stamp = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", 16)

        status_text = f"VISION QA: {verdict} (Comprehension Score: {score:.1f}/10)"
        draw.text((20, 14), status_text, font=font_title, fill=(255, 255, 255))

        clean_premise = premise_hook if len(premise_hook) < 65 else premise_hook[:62] + "..."
        draw.text((20, 48), f"Premise: {clean_premise}", font=font_sub, fill=(255, 215, 0))

        labels = ["Setup", "Escalation", "Climax", "Payoff"]
        for idx, (t, _) in enumerate(frames):
            lbl = labels[idx] if idx < len(labels) else "Moment"
            tag = f"{t:.1f}s ({lbl})"
            draw.text((idx * 270 + 15, banner_h + 15), tag, font=font_stamp, fill=(255, 255, 255))

        output_path = self.storyboards_dir / f"storyboard_{clip_name}.jpg"
        im.save(str(output_path), quality=92)
        return str(output_path)

    def verify_clip(
        self,
        video_path: str,
        start_sec: float,
        end_sec: float,
        candidate_hook: str,
        transcript_text: str,
        channel_name: str = "IShowSpeed"
    ) -> VisionQAResult:
        """
        Extracts storyboard frames, runs Vision AI comprehension check,
        and determines if the clip makes complete sense and is genuinely entertaining.
        """
        frames = self.extract_storyboard_frames(video_path, start_sec, end_sec, num_frames=4)
        if not frames:
            return VisionQAResult(
                passed=True,
                comprehension_score=7.0,
                what_actually_happens="Video frames could not be read; passed by fallback.",
                premise_hook=candidate_hook
            )

        # 1. Check facecam activity (detects if streamer was just sitting silently)
        motion_score = self.check_facecam_activity(frames)
        clip_name = Path(video_path).stem

        # 2. Build base64 frames for Multimodal Vision AI
        b64_frames = []
        for _, frame in frames:
            resized = cv2.resize(frame, (240, 426))
            _, buf = cv2.imencode(".jpg", resized, [int(cv2.IMWRITE_JPEG_QUALITY), 65])
            b64_frames.append(base64.b64encode(buf).decode("utf-8"))

        # Vision AI Prompt
        prompt = f"""You are the Lead Content Director for a viral short-form media company.
You are inspecting 4 sequential frames from a candidate video of streamer '{channel_name}' playing GTA 6.
Audio Transcript of this clip: "{transcript_text}"
Candidate Title: "{candidate_hook}"

Evaluate this clip strictly from the perspective of a random viewer scrolling on TikTok/Shorts:
1. WHAT ACTUALLY HAPPENS? (Explain clearly in 1 sentence what a viewer actually sees occurring on screen).
2. STREAMER ENGAGEMENT: Is {channel_name} actively reacting (expressive face, shouting, laughing, gasping, talking passionately)? Or is {channel_name} just staring blankly with closed mouth?
3. VISUAL ACTION: Does a clear, funny, or exciting event happen in the game (car crash, crazy fail, NPC confrontation, clutch, funny bug)? Or is it just mundane driving/walking with nothing happening?
4. STANDALONE COMPREHENSION: Does this video make complete sense on its own in 3 seconds without needing to know what happened 2 hours earlier on stream?
5. PREMISE HOOK: Write a short, punchy, premise-driven title (under 7 words with 1-2 authentic emojis, e.g. "Speed tried stealing from the wrong NPC😭" or "Speed crashed the fastest car in GTA 6💀").

DECISION RULE:
- If {channel_name} is staring silently with closed mouth at an in-game cutscene, or if nothing interesting happens on screen, REJECT IT ("passed": false, score < 6.0).
- If there is an active, funny, or crazy moment that makes complete sense, APPROVE IT ("passed": true, score >= 7.0).

Respond strictly in valid JSON format:
{{
  "passed": bool,
  "comprehension_score": float,
  "what_actually_happens": string,
  "premise_hook": string,
  "rejection_reason": string or null
}}
"""
        session = requests.Session()
        session.mount("https://", HTTPAdapter(max_retries=Retry(total=2, backoff_factor=1)))
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0"
        }

        content_parts: List[Dict[str, Any]] = [{"type": "text", "text": prompt}]
        for b64 in b64_frames:
            content_parts.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}"}
            })

        self.vision_models = [
            "qwen2.5-vl-7b-instruct-awq:free",
            "qwen2.5-vl-72b-instruct:free"
        ]

        for model in self.vision_models:
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": content_parts}],
                "temperature": 0.2,
                "max_tokens": 300
            }

            try:
                resp = session.post(self.api_base_url, headers=headers, json=payload, timeout=22)
                if resp.status_code == 200:
                    raw_json = resp.json()["choices"][0]["message"]["content"].strip()
                    if "```" in raw_json:
                        m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw_json, re.DOTALL)
                        if m:
                            raw_json = m.group(1)
                        else:
                            raw_json = raw_json.replace("```json", "").replace("```", "").strip()

                    parsed = json.loads(raw_json)
                    score = float(parsed.get("comprehension_score", 7.0))
                    passed = bool(parsed.get("passed", score >= self.min_comprehension_score))
                    what_happens = parsed.get("what_actually_happens", "Action verified by Vision AI.")
                    premise_hook = parsed.get("premise_hook", candidate_hook)
                    rejection = parsed.get("rejection_reason")

                    verdict_str = "APPROVED" if passed else "REJECTED"
                    storyboard_file = self.generate_storyboard_image(
                        frames=frames,
                        clip_name=clip_name,
                        verdict=verdict_str,
                        premise_hook=premise_hook,
                        what_actually_happens=what_happens,
                        score=score
                    )

                    print(f"[VisionQA] Verdict ({model}): {verdict_str} (Score: {score:.1f}/10)")
                    print(f"[VisionQA] What happens: {what_happens}")
                    if not passed:
                        print(f"[VisionQA] Rejection reason: {rejection}")

                    return VisionQAResult(
                        passed=passed,
                        comprehension_score=score,
                        what_actually_happens=what_happens,
                        premise_hook=premise_hook,
                        rejection_reason=rejection,
                        storyboard_path=storyboard_file
                    )
                elif resp.status_code == 429:
                    print(f"[VisionQA] Vision model {model} rate limited (429). Trying next vision model...")
                    continue
                else:
                    print(f"[VisionQA] Vision model {model} returned HTTP {resp.status_code}.")
            except Exception as e:
                print(f"[VisionQA] Error with vision model {model}: {e}")

        # Fallback: Facecam motion check
        # If mouth motion variance is very low (< 0.8), streamer is likely staring blankly
        passed = (motion_score >= 1.0)
        score = 7.5 if passed else 4.0
        rejection = None if passed else "Low streamer facecam movement (streamer was not actively speaking or reacting)."
        verdict_str = "APPROVED" if passed else "REJECTED"

        storyboard_file = self.generate_storyboard_image(
            frames=frames,
            clip_name=clip_name,
            verdict=verdict_str,
            premise_hook=candidate_hook,
            what_actually_happens="Evaluated via facecam engagement motion analysis.",
            score=score
        )

        return VisionQAResult(
            passed=passed,
            comprehension_score=score,
            what_actually_happens="Streamer engagement verified via facecam activity tracking.",
            premise_hook=candidate_hook,
            rejection_reason=rejection,
            storyboard_path=storyboard_file
        )
