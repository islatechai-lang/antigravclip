"""
Animated Subtitle Engine (Advanced SubStation Alpha - ASS)
Generates high-retention, large-format animated subtitles for vertical 9:16 video.
Features strictly non-overlapping lines, middle-center anchored positioning (never stacks upward),
multi-speaker diarization color coding, and bold viral word-pop highlights without resetting styles.
"""

from typing import List
from pathlib import Path
from .transcriber import TranscriptResult, WordTimestamp


class SubtitleBurner:
    def __init__(
        self,
        font_name: str = "Impact",
        font_size: int = 44,                   # Renders at 88pt in 1080x1920 (large, punchy, mobile-first)
        primary_color: str = "&H00FFFFFF",     # Crisp Pure White (ASS: &HAABBGGRR)
        highlight_color: str = "&H0000E5FF",   # Speaker 0: Vibrant Cyber Gold / Neon Yellow
        speaker2_color: str = "&H00FFFF00",    # Speaker 1+: Electric Cyan / Bright Aqua
        outline_color: str = "&H00000000",     # Deep Solid Black outline
        outline_width: int = 9,                # Extra-thick 9px border for max contrast
        shadow_width: int = 4,                 # 4px drop shadow
        words_per_group: int = 2,              # Snappy 2-word groups (OpusClip/TikTok standard)
        pos_y: int = 1320                      # Anchored in safe lower-middle area (below facecam, above TikTok UI)
    ):
        self.font_name = font_name
        self.font_size = font_size
        self.primary_color = primary_color
        self.highlight_color = highlight_color
        self.speaker2_color = speaker2_color
        self.outline_color = outline_color
        self.outline_width = outline_width
        self.shadow_width = shadow_width
        self.words_per_group = words_per_group
        self.pos_y = pos_y

    def generate_ass(
        self,
        transcript: TranscriptResult,
        clip_start_sec: float,
        clip_end_sec: float,
        output_ass_path: str
    ) -> str:
        """
        Creates an .ass subtitle file with non-overlapping word-level highlight animation,
        explicitly anchored at (540, pos_y) so lines NEVER stack awkwardly on top of each other.
        Supports multi-speaker color-coding (Speaker 0 Cyber Gold, Speaker 1+ Electric Cyan).
        """
        all_words = transcript.all_words()
        
        # Filter words within the trimmed window
        clip_words = [
            w for w in all_words
            if (w.end >= clip_start_sec and w.start <= clip_end_sec)
        ]

        if not clip_words:
            # Empty subtitle file if no words
            Path(output_ass_path).parent.mkdir(parents=True, exist_ok=True)
            with open(output_ass_path, "w", encoding="utf-8") as f:
                f.write("[Script Info]\nTitle: Empty\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n[Events]\n")
            return output_ass_path

        # Re-index timestamps with positive durations
        reindexed: List[WordTimestamp] = []
        for w in clip_words:
            adj_start = max(0.0, float(w.start) - clip_start_sec)
            adj_end = max(adj_start + 0.10, float(w.end) - clip_start_sec)
            reindexed.append(WordTimestamp(
                word=w.word.upper(),
                start=adj_start,
                end=adj_end,
                probability=w.probability,
                speaker=getattr(w, "speaker", 0)
            ))

        # Group words into short punchy phrases (default 2 words, splitting on pauses, punctuation, or speaker change)
        groups: List[List[WordTimestamp]] = []
        current_group: List[WordTimestamp] = []

        for i, word in enumerate(reindexed):
            # Split immediately if the speaker changes
            if current_group and word.speaker != current_group[-1].speaker:
                groups.append(current_group)
                current_group = []

            current_group.append(word)

            pause_after = False
            if i + 1 < len(reindexed):
                gap = reindexed[i + 1].start - word.end
                if gap > 0.28:
                    pause_after = True

            has_punctuation = any(word.word.endswith(p) for p in [".", "!", "?", ","])

            if len(current_group) >= self.words_per_group or pause_after or has_punctuation:
                groups.append(current_group)
                current_group = []

        if current_group:
            groups.append(current_group)

        # Build ASS file header (PlayRes: 1080x1920 vertical)
        # Alignment=5 (middle-center) + explicit \pos ensures ZERO collisions/stacking
        header = f"""[Script Info]
Title: TikTok Viral Subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ViralStyle,{self.font_name},{self.font_size * 2},{self.primary_color},&H000000FF,{self.outline_color},&H80000000,1,0,0,0,100,100,2,0,1,{self.outline_width},{self.shadow_width},5,40,40,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
        dialogue_lines = []

        for g_idx, group in enumerate(groups):
            if not group:
                continue

            # Ensure word timestamps inside the group are monotonic
            for idx in range(len(group) - 1):
                if group[idx].end > group[idx + 1].start:
                    group[idx].end = max(group[idx].start + 0.08, group[idx + 1].start)

            # Determine the hard boundary for the end of this group:
            # Next group's start time prevents ANY overlapping dialogue events!
            next_group_start = None
            if g_idx + 1 < len(groups) and groups[g_idx + 1]:
                next_group_start = groups[g_idx + 1][0].start

            for active_idx, active_word in enumerate(group):
                w_start = active_word.start

                if active_idx + 1 < len(group):
                    w_end = max(w_start + 0.10, group[active_idx + 1].start)
                else:
                    # Last word in this group
                    if next_group_start is not None:
                        w_end = min(active_word.end + 0.10, next_group_start)
                    else:
                        w_end = active_word.end + 0.15

                # Guard against zero or negative duration
                if w_end <= w_start:
                    w_end = w_start + 0.08

                w_start_str = self._format_ass_time(w_start)
                w_end_str = self._format_ass_time(w_end)

                styled_text_parts = []
                for idx, w in enumerate(group):
                    # Multi-speaker color attribution:
                    # Speaker 0: Cyber Gold (self.highlight_color)
                    # Speaker 1+: Electric Cyan (self.speaker2_color)
                    word_active_color = self.speaker2_color if w.speaker >= 1 else self.highlight_color

                    if idx == active_idx:
                        # Popped active word in vibrant highlight color (without \r style wipe)
                        styled_text_parts.append(f"{{\\c{word_active_color}\\fscx112\\fscy112}}{w.word}{{\\c{self.primary_color}\\fscx100\\fscy100}}")
                    else:
                        styled_text_parts.append(f"{{\\c{self.primary_color}\\fscx100\\fscy100}}{w.word}")

                line_text = " ".join(styled_text_parts)
                # \an5\pos(540, pos_y) locks position so new lines never jump or stack on top of each other!
                dialogue_lines.append(f"Dialogue: 0,{w_start_str},{w_end_str},ViralStyle,,0,0,0,,{{\\an5\\pos(540,{self.pos_y})}}{line_text}")

        content = header + "\n".join(dialogue_lines) + "\n"

        Path(output_ass_path).parent.mkdir(parents=True, exist_ok=True)
        with open(output_ass_path, "w", encoding="utf-8") as f:
            f.write(content)

        return output_ass_path

    def _format_ass_time(self, seconds: float) -> str:
        """Converts float seconds to ASS format: H:MM:SS.cs"""
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        centisecs = int(round((seconds - int(seconds)) * 100))
        if centisecs >= 100:
            centisecs = 99
        return f"{hours}:{minutes:02d}:{secs:02d}.{centisecs:02d}"
