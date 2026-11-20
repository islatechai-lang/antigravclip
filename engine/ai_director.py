"""
AI Narrative Director & Virality Gate Engine
Analyzes speech transcripts and chat velocity with strict speaker attribution,
complete story-arc boundary detection, and dynamic multi-model failover on Uno Router.
"""

import os
import json
import re
import time
from typing import Optional, Dict, Any, List
from .transcriber import TranscriptResult, TranscriptSegment


class DirectorDecision:
    def __init__(
        self,
        virality_score: float,
        reasoning: str,
        clip_start_sec: float,
        clip_end_sec: float,
        hook_title: str,
        caption: str,
        passed_filter: bool
    ):
        self.virality_score = virality_score
        self.reasoning = reasoning
        self.clip_start_sec = clip_start_sec
        self.clip_end_sec = clip_end_sec
        self.hook_title = hook_title
        self.caption = caption
        self.passed_filter = passed_filter

    def to_dict(self) -> Dict[str, Any]:
        return {
            "virality_score": round(self.virality_score, 1),
            "reasoning": self.reasoning,
            "clip_start_sec": round(self.clip_start_sec, 2),
            "clip_end_sec": round(self.clip_end_sec, 2),
            "duration_sec": round(self.clip_end_sec - self.clip_start_sec, 2),
            "hook_title": self.hook_title,
            "caption": self.caption,
            "passed_filter": self.passed_filter
        }


class AIDirector:
    def __init__(
        self,
        provider: str = "unorouter",
        model_name: str = "gpt-4o:free",
        virality_threshold: float = 6.0,      # Adjusted threshold to capture exciting moments
        min_duration_sec: float = 12.0,
        max_duration_sec: float = 58.0,
        api_key: Optional[str] = None,
        api_base_url: Optional[str] = None
    ):
        self.provider = provider.lower()
        self.model_name = model_name
        self.virality_threshold = virality_threshold
        self.min_duration_sec = min_duration_sec
        self.max_duration_sec = max_duration_sec
        self.api_key = api_key
        self.api_base_url = api_base_url or "https://api.unorouter.com/v1/chat/completions"

        # Model pool on Uno Router for instantaneous failover on 429 rate limits
        self.model_pool = [
            "gpt-4o:free",
            "llama-3.3-70b:free",
            "deepseek-v4.1-flash-1017:free"
        ]

    def evaluate_slice(
        self,
        transcript: TranscriptResult,
        spike_time_offset: float,
        chat_emotes: List[str],
        channel_name: str = "Streamer"
    ) -> DirectorDecision:
        """
        Takes full slice transcript and chat context, then decides:
        1. Exact start and end timestamps for the clip.
        2. Virality score (1-10).
        3. Hook title and social caption.
        """
        unorouter_key = self.api_key or os.environ.get("UNOROUTER_API_KEY")

        if self.provider == "unorouter" and unorouter_key:
            try:
                return self._call_unorouter_pool(transcript, spike_time_offset, chat_emotes, channel_name, unorouter_key)
            except Exception as e:
                print(f"[AIDirector] Uno Router pool failed ({e}). Using smart sentence heuristic.")

        return self._heuristic_decision(transcript, spike_time_offset, chat_emotes, channel_name)

    def _call_unorouter_pool(
        self,
        transcript: TranscriptResult,
        spike_offset: float,
        chat_emotes: List[str],
        channel_name: str,
        api_key: str
    ) -> DirectorDecision:
        import requests
        from requests.adapters import HTTPAdapter
        from urllib3.util import Retry

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0"
        }
        prompt = self._build_prompt(transcript, spike_offset, chat_emotes, channel_name)

        session = requests.Session()
        session.mount("https://", HTTPAdapter(max_retries=Retry(total=2, backoff_factor=0.5)))

        # Try models in pool sequentially if any model hits a rate limit (429) or error
        last_error = None
        for model in self.model_pool:
            payload = {
                "model": model,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "You are an elite short-form video editor for TikTok, Instagram Reels, and YouTube Shorts. "
                            "You edit clips of popular streamers like IShowSpeed, Kai Cenat, and Jynxzi. "
                            "Respond strictly in valid JSON format without markdown wrapping."
                        )
                    },
                    {"role": "user", "content": prompt}
                ],
                "temperature": 0.25
            }

            try:
                resp = session.post(self.api_base_url, headers=headers, json=payload, timeout=18)
                if resp.status_code == 200:
                    data = resp.json()
                    raw_text = data["choices"][0]["message"]["content"].strip()
                    clean_json = raw_text

                    if "```" in clean_json:
                        match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", clean_json, re.DOTALL)
                        if match:
                            clean_json = match.group(1)
                        else:
                            clean_json = clean_json.replace("```json", "").replace("```", "").strip()

                    parsed = json.loads(clean_json)

                    score = float(parsed.get("virality_score", 7.0))
                    start_sec = float(parsed.get("clip_start_sec", max(0.0, spike_offset - 20.0)))
                    end_sec = float(parsed.get("clip_end_sec", spike_offset + 14.0))

                    dur = end_sec - start_sec
                    if dur > self.max_duration_sec:
                        end_sec = start_sec + self.max_duration_sec
                    elif dur < self.min_duration_sec:
                        end_sec = start_sec + self.min_duration_sec

                    passed = bool(parsed.get("passed_filter", score >= self.virality_threshold))

                    print(f"[AIDirector] Successfully evaluated using {model} (Score: {score:.1f}, Passed: {passed})")

                    return DirectorDecision(
                        virality_score=score,
                        reasoning=parsed.get("reasoning", f"{model} evaluation"),
                        clip_start_sec=start_sec,
                        clip_end_sec=end_sec,
                        hook_title=parsed.get("hook_title", "Wait for the ending... 😭😂"),
                        caption=parsed.get("caption", f"Unreal moment on {channel_name}'s stream 💀 #gta6 #ishowspeed #fyp"),
                        passed_filter=passed
                    )
                elif resp.status_code == 429:
                    print(f"[AIDirector] Model {model} hit rate limit (429). Rotating to next model in pool...")
                    last_error = f"Model {model} rate limited"
                    continue
                else:
                    last_error = f"HTTP {resp.status_code}: {resp.text[:120]}"
            except Exception as e:
                last_error = str(e)
                print(f"[AIDirector] Error calling {model}: {e}. Trying fallback model...")

        raise RuntimeError(f"All models in pool failed: {last_error}")

    def _build_prompt(
        self,
        transcript: TranscriptResult,
        spike_offset: float,
        chat_emotes: List[str],
        channel_name: str
    ) -> str:
        transcript_json = json.dumps(transcript.to_dict(), indent=2)
        return f"""You are the lead viral editor for a top short-form clipping channel (TikTok, YouTube Shorts, Instagram Reels).
A live stream from '{channel_name}' had a massive chat velocity reaction spike around {spike_offset:.1f}s.
Chat reaction emotes: {', '.join(chat_emotes)}

AUDIO TRANSCRIPT WITH TIMESTAMPS:
{transcript_json}

============================================================
HOW TO EDIT THIS CLIP FOR MAXIMUM SHORT-FORM VIRALITY:
============================================================

1. WHAT MAKES A CLIP VIRAL FOR {channel_name}:
   - HIGH ENERGY REACTIONS: Screaming, sudden shock, laughing hysterically, repeating something in disbelief (e.g. "WHAT IS THIS BRO?!"), raging, barking, or reacting with pure emotion. THESE ARE HIGH-VALUE VIRAL MOMENTS (Score 7.5 - 9.5)!
   - GTA 6 MOMENTS: Funny car crashes, hilarious NPC encounters, police chases, mission fails, or unexpected game physics.
   - CHAT INTERACTIONS: Streamer roasting chat, answering a ridiculous question, or chat trolling the streamer.

2. SPEAKER ATTRIBUTION (CRITICAL):
   - The audio has {channel_name} on their mic AND in-game sound (game NPCs, story cutscenes).
   - NEVER attribute an NPC's voice or line to {channel_name}.
   - If the moment is ONLY an in-game cutscene where {channel_name} stays quiet and has NO reaction, reject it: "passed_filter": false, "virality_score": 4.0.
   - If {channel_name} is actively reacting, talking, shouting, or laughing, ACCEPT IT: "passed_filter": true!

3. COMPLETE NARRATIVE ARC (NO INCOMPLETE CUTS):
   - "clip_start_sec": MUST start cleanly at the beginning of the setup sentence or reaction (NEVER cut in the middle of a word).
   - "clip_end_sec": MUST include the full reaction climax PLUS 1.5 to 2.5 seconds of the streamer's reaction and laughter aftermath so the viewer sees the complete payoff.
   - Target duration: {self.min_duration_sec}s to {self.max_duration_sec}s.

4. HOOK TITLE & CAPTION:
   - "hook_title": A punchy, conversational title formatted for a white Reels/Shorts sticker with 1-2 authentic emojis (e.g. "Bro forgot it's just a\\ngame😭😂", "He cannot be serious💀", "Speed had a complete meltdown🤣🔥"). Under 7 words.
   - "caption": 1 short catchy sentence with 3-4 trending hashtags.

Respond strictly in valid JSON format:
{{
  "virality_score": float,
  "passed_filter": bool,
  "reasoning": string,
  "clip_start_sec": float,
  "clip_end_sec": float,
  "hook_title": string,
  "caption": string
}}
"""

    def _heuristic_decision(
        self,
        transcript: TranscriptResult,
        spike_offset: float,
        chat_emotes: List[str],
        channel_name: str
    ) -> DirectorDecision:
        """Intelligent sentence-aligned heuristic fallback."""
        segments = transcript.segments

        spike_seg_idx = -1
        for i, s in enumerate(segments):
            if s.start <= spike_offset <= s.end or (s.start > spike_offset and spike_seg_idx == -1):
                spike_seg_idx = i
                break

        if spike_seg_idx == -1 and segments:
            spike_seg_idx = len(segments) - 1

        start_sec = max(0.0, spike_offset - 18.0)
        end_sec = spike_offset + 12.0

        if segments and spike_seg_idx >= 0:
            for i in range(spike_seg_idx, -1, -1):
                seg = segments[i]
                if (spike_offset - seg.start) >= 5.0:
                    start_sec = seg.start
                    break
            for i in range(spike_seg_idx, len(segments)):
                seg = segments[i]
                if (seg.end - spike_offset) >= 5.0:
                    end_sec = min(seg.end + 2.0, start_sec + self.max_duration_sec)
                    break

        dur = end_sec - start_sec
        if dur > self.max_duration_sec:
            end_sec = start_sec + self.max_duration_sec
        elif dur < self.min_duration_sec:
            end_sec = start_sec + self.min_duration_sec

        hook = "Bro thought he was safe😭😂"
        caption = f"Bro was not ready for this 💀 #gta6 #ishowspeed #gaming"

        return DirectorDecision(
            virality_score=7.5,
            reasoning="Sentence-aligned reaction moment during chat spike.",
            clip_start_sec=start_sec,
            clip_end_sec=end_sec,
            hook_title=hook,
            caption=caption,
            passed_filter=True
        )
