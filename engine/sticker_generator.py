"""
Viral Sticker Generator for 9:16 Shorts
Generates high-retention Instagram/Reels style white rounded sticker cards
with bold typography and authentic, full-color emojis (Apple / Twemoji style).
"""

import os
import re
import urllib.request
from pathlib import Path
from typing import Tuple, List
from PIL import Image, ImageDraw, ImageFont


class StickerGenerator:
    def __init__(self, cache_dir: str = "./cache"):
        self.cache_dir = Path(cache_dir)
        self.emoji_cache_dir = self.cache_dir / "emojis"
        self.emoji_cache_dir.mkdir(parents=True, exist_ok=True)
        
        # Prefer system fonts for crisp bold text
        self.font_candidates = [
            "C:/Windows/Fonts/arialbd.ttf",   # Arial Bold
            "C:/Windows/Fonts/segoeuib.ttf",  # Segoe UI Bold
            "C:/Windows/Fonts/calibrib.ttf",  # Calibri Bold
        ]
        self.font_path = "C:/Windows/Fonts/arialbd.ttf"
        for fc in self.font_candidates:
            if os.path.exists(fc):
                self.font_path = fc
                break

    def _get_emoji_image(self, emoji_char: str, target_size: int) -> Image.Image:
        """
        Retrieves authentic full-color Apple/Twemoji PNG for a given emoji character.
        Caches locally in cache/emojis/ to avoid repeat downloads.
        """
        # Convert character(s) to hex codepoints (e.g., 1f62d)
        codepoints = "-".join(f"{ord(c):x}" for c in emoji_char)
        local_png = self.emoji_cache_dir / f"{codepoints}.png"

        if not local_png.exists():
            # Try Apple Emoji source first (authentic iOS look as in user reference)
            urls = [
                f"https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/{codepoints}.png",
                f"https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/{codepoints}.png"
            ]
            for url in urls:
                try:
                    urllib.request.urlretrieve(url, str(local_png))
                    if local_png.exists() and local_png.stat().st_size > 0:
                        break
                except Exception:
                    continue

        if local_png.exists() and local_png.stat().st_size > 0:
            try:
                img = Image.open(str(local_png)).convert("RGBA")
                return img.resize((target_size, target_size), Image.Resampling.LANCZOS)
            except Exception:
                pass

        # Fallback: render using Windows Segoe UI Emoji if present
        segui_font = "C:/Windows/Fonts/seguiemj.ttf"
        if os.path.exists(segui_font):
            try:
                fallback_font = ImageFont.truetype(segui_font, target_size)
                fallback_img = Image.new("RGBA", (target_size + 10, target_size + 10), (0, 0, 0, 0))
                draw = ImageDraw.Draw(fallback_img)
                draw.text((0, 0), emoji_char, font=fallback_font, embedded_color=True)
                return fallback_img.resize((target_size, target_size), Image.Resampling.LANCZOS)
            except Exception:
                pass

        # Return empty transparent fallback if completely unavailable
        return Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))

    def _wrap_text_and_emojis(self, text: str, max_chars_per_line: int = 24) -> List[str]:
        """Intelligently splits hook titles into 1 or 2 balanced lines."""
        text = text.strip()
        if "\n" in text:
            return [l.strip() for l in text.split("\n") if l.strip()]

        words = text.split()
        if len(words) <= 4 or len(text) <= max_chars_per_line:
            return [text]

        # Balance into 2 lines
        midpoint = len(words) // 2
        line1 = " ".join(words[:midpoint])
        line2 = " ".join(words[midpoint:])
        return [line1, line2]

    def generate_sticker_card(
        self,
        hook_title: str,
        output_path: str = "./cache/hook_sticker.png",
        font_size: int = 58
    ) -> str:
        """
        Renders a photo-accurate Instagram/Reels white pill sticker with bold black text
        and authentic full-color emojis, centered and formatted.
        """
        font = ImageFont.truetype(self.font_path, font_size)
        lines = self._wrap_text_and_emojis(hook_title)

        # Regex matching emoji ranges
        emoji_pattern = re.compile(
            r"([\U00010000-\U0010ffff]|[\u2600-\u27ff]|\u200d)+",
            flags=re.UNICODE
        )

        parsed_lines = []
        line_metrics = []

        for line in lines:
            segments = []
            last_idx = 0
            for match in emoji_pattern.finditer(line):
                start, end = match.span()
                if start > last_idx:
                    segments.append(("text", line[last_idx:start]))
                raw_emoji = match.group(0)
                # Split compound emojis or add space separation
                for char in raw_emoji:
                    if ord(char) > 127:
                        segments.append(("emoji", char))
                last_idx = end
            if last_idx < len(line):
                segments.append(("text", line[last_idx:]))

            # Calculate width & height of this line
            line_w = 0
            line_h = font_size + 14
            for idx, (seg_type, val) in enumerate(segments):
                if seg_type == "text":
                    bbox = font.getbbox(val)
                    line_w += (bbox[2] - bbox[0])
                else:
                    # Add tiny padding before emoji if preceded by text without trailing space
                    if idx > 0 and segments[idx - 1][0] == "text" and not segments[idx - 1][1].endswith(" "):
                        line_w += 6
                    line_w += font_size + 6

            parsed_lines.append(segments)
            line_metrics.append((line_w, line_h))

        max_line_w = max(m[0] for m in line_metrics)
        total_text_h = sum(m[1] for m in line_metrics)

        # High-retention Reels pill proportions
        pad_x = 48
        pad_y = 30
        corner_radius = 30

        sticker_w = max_line_w + (pad_x * 2)
        sticker_h = total_text_h + (pad_y * 2)

        # Create transparent canvas with margin for soft drop shadow
        canvas_margin = 16
        canvas_w = sticker_w + (canvas_margin * 2)
        canvas_h = sticker_h + (canvas_margin * 2)

        img = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        # Soft drop shadow
        shadow_rect = [
            canvas_margin,
            canvas_margin + 4,
            canvas_margin + sticker_w,
            canvas_margin + sticker_h + 4
        ]
        draw.rounded_rectangle(shadow_rect, radius=corner_radius, fill=(0, 0, 0, 75))

        # Solid pure white card background
        card_rect = [
            canvas_margin,
            canvas_margin,
            canvas_margin + sticker_w,
            canvas_margin + sticker_h
        ]
        draw.rounded_rectangle(card_rect, radius=corner_radius, fill=(255, 255, 255, 255))

        # Render lines centered
        curr_y = canvas_margin + pad_y
        for segments, (lw, lh) in zip(parsed_lines, line_metrics):
            curr_x = canvas_margin + (sticker_w - lw) / 2
            for idx, (seg_type, val) in enumerate(segments):
                if seg_type == "text":
                    draw.text((curr_x, curr_y), val, font=font, fill=(0, 0, 0, 255))
                    bbox = font.getbbox(val)
                    curr_x += (bbox[2] - bbox[0])
                else:
                    if idx > 0 and segments[idx - 1][0] == "text" and not segments[idx - 1][1].endswith(" "):
                        curr_x += 6
                    emoji_img = self._get_emoji_image(val, font_size)
                    # Align emoji with font baseline
                    img.alpha_composite(emoji_img, (int(curr_x), int(curr_y + 4)))
                    curr_x += font_size + 6
            curr_y += lh

        out_path = Path(output_path)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(str(out_path))
        print(f"[StickerGenerator] Generated viral sticker: {out_path} ({canvas_w}x{canvas_h})")
        return str(out_path)
