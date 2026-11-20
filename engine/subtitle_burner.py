"""
Animated Subtitle Engine (Advanced SubStation Alpha - ASS)
Generates high-retention, large-format animated subtitles for vertical 9:16 video.
Features continuous group display, zero-flicker timing, and bold word-pop highlights.
"""

from typing import List
from pathlib import Path
from .transcriber import TranscriptResult, WordTimestamp


class SubtitleBurner:
    def __init__(
        self,
        font_name: str = "Impact",
        font_size: int = 36,                   # Renders at 72pt in 1080x1920
        primary_color: str = "&H00FFFFFF",     # Crisp White (ASS: &HAABBGGRR)
        highlight_color: str = "&H0000FFFF",   # Vibrant Yellow
        outline_color: str = "&H00000000",     # Deep Black border
        outline_width: int = 8,                # Bold outline for instant mobile readability
        words_per_group: int = 3,
        margin_v: int = 560                    # Placed in the sweet spot of the gameplay area
    ):
        self.font_name = font_name
        self.font_size = font_size
        self.primary_color = primary_color
        self.highlight_color = highlight_color
        self.outline_color = outline_color
        self.outline_width = outline_width
        self.words_per_group = words_per_group
        self.margin_v = margin_v

    def generate_ass(
        self,
        transcript: TranscriptResult,
        clip_start_sec: float,
        clip_end_sec: float,
        output_ass_path: str
    ) -> str:
        """
        Creates an .ass subtitle file with clean continuous word-level highlight animation,
        re-indexed to start at 0:00 relative to clip_start_sec.
        """
        all_words = transcript.all_words()
        
        # Filter words within the trimmed window
        clip_words = [
            w for w in all_words
            if (w.end >= clip_start_sec and w.start <= clip_end_sec)
        ]

        # Re-index timestamps with positive durations
        reindexed: List[WordTimestamp] = []
        for w in clip_words:
            adj_start = max(0.0, float(w.start) - clip_start_sec)
            adj_end = max(adj_start + 0.12, float(w.end) - clip_start_sec)
            reindexed.append(WordTimestamp(w.word.upper(), adj_start, adj_end))

        # Group words into natural phrases (2-3 words, splitting on pauses or punctuation)
        groups: List[List[WordTimestamp]] = []
        current_group: List[WordTimestamp] = []

        for i, word in enumerate(reindexed):
            current_group.append(word)

            # Check if we should close this group
            pause_after = False
            if i + 1 < len(reindexed):
                gap = reindexed[i + 1].start - word.end
                if gap > 0.35:
                    pause_after = True

            has_punctuation = any(word.word.endswith(p) for p in [".", "!", "?", ","])

            if len(current_group) >= self.words_per_group or pause_after or has_punctuation:
                groups.append(current_group)
                current_group = []

        if current_group:
            groups.append(current_group)

        # Build ASS file header
        header = f"""[Script Info]
Title: TikTok Viral Subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ViralStyle,{self.font_name},{self.font_size * 2},{self.primary_color},&H000000FF,{self.outline_color},&H80000000,1,0,0,0,100,100,2,0,1,{self.outline_width},2,2,40,40,{self.margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
        dialogue_lines = []

        for group in groups:
            if not group:
                continue

            # Ensure words inside group are sequentially ordered
            for idx in range(len(group) - 1):
                if group[idx].end > group[idx + 1].start:
                    group[idx].end = max(group[idx].start + 0.1, group[idx + 1].start)

            # Generate active highlight for each word while preserving continuous group presence
            for active_idx, active_word in enumerate(group):
                # Word start time
                w_start = active_word.start
                # Word active until next word starts, or active_word.end + 0.15s for last word
                if active_idx + 1 < len(group):
                    w_end = max(w_start + 0.12, group[active_idx + 1].start)
                else:
                    w_end = max(w_start + 0.15, active_word.end + 0.15)

                w_start_str = self._format_ass_time(w_start)
                w_end_str = self._format_ass_time(w_end)

                styled_text_parts = []
                for idx, w in enumerate(group):
                    if idx == active_idx:
                        # Highlight active word with scale pop and vibrant yellow
                        styled_text_parts.append(f"{{\\c{self.highlight_color}\\fscx112\\fscy112}}{w.word}{{\\r\\c{self.primary_color}}}")
                    else:
                        styled_text_parts.append(f"{{\\c{self.primary_color}}}{w.word}")

                line_text = " ".join(styled_text_parts)
                dialogue_lines.append(f"Dialogue: 0,{w_start_str},{w_end_str},ViralStyle,,0,0,0,,{line_text}")

        content = header + "\n".join(dialogue_lines) + "\n"

        Path(output_ass_path).parent.mkdir(parents=True, exist_ok=True)
        with open(output_ass_path, "w", encoding="utf-8") as f:
            f.write(content)

        return output_ass_path

    def _format_ass_time(self, seconds: float) -> str:
        """Formats seconds into ASS timestamp: H:MM:SS.cc"""
        hrs = int(seconds // 3600)
        mins = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        centis = int(round((seconds - int(seconds)) * 100))
        if centis >= 100:
            centis = 99
        return f"{hrs}:{mins:02d}:{secs:02d}.{centis:02d}"
