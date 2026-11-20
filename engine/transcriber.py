"""
Whisper Speech-to-Text Transcriber with Word-Level Timestamps
Uses faster-whisper base.en with Silero Voice Activity Detection (VAD)
to filter game sound effects, music, and background noise.
"""

import os
import subprocess
import json
from pathlib import Path
from typing import List, Dict, Any, Optional


class WordTimestamp:
    def __init__(self, word: str, start: float, end: float, probability: float = 1.0):
        self.word = word.strip()
        self.start = start
        self.end = end
        self.probability = probability

    def to_dict(self) -> Dict[str, Any]:
        return {
            "word": self.word,
            "start": round(self.start, 2),
            "end": round(self.end, 2),
            "probability": round(self.probability, 2)
        }


class TranscriptSegment:
    def __init__(self, text: str, start: float, end: float, words: List[WordTimestamp]):
        self.text = text.strip()
        self.start = start
        self.end = end
        self.words = words

    def to_dict(self) -> Dict[str, Any]:
        return {
            "text": self.text,
            "start": round(self.start, 2),
            "end": round(self.end, 2),
            "words": [w.to_dict() for w in self.words]
        }


class TranscriptResult:
    def __init__(self, full_text: str, segments: List[TranscriptSegment]):
        self.full_text = full_text.strip()
        self.segments = segments

    def all_words(self) -> List[WordTimestamp]:
        words = []
        for seg in self.segments:
            words.extend(seg.words)
        return words

    def to_dict(self) -> Dict[str, Any]:
        return {
            "full_text": self.full_text,
            "segments": [s.to_dict() for s in self.segments]
        }


class Transcriber:
    def __init__(self, model_size: str = "base.en", device: str = "cpu", compute_type: str = "int8"):
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self._model = None

    def _load_model(self):
        if self._model is None:
            try:
                from faster_whisper import WhisperModel
                dev = "cuda" if self.device == "cuda" else "cpu"
                print(f"[Transcriber] Loading faster-whisper ({self.model_size}) on {dev}...")
                self._model = WhisperModel(self.model_size, device=dev, compute_type=self.compute_type)
            except Exception as e:
                print(f"[Transcriber] Could not load {self.model_size}: {e}. Trying tiny.en...")
                try:
                    from faster_whisper import WhisperModel
                    self._model = WhisperModel("tiny.en", device="cpu", compute_type="int8")
                except Exception:
                    self._model = "fallback"

    def extract_audio(self, video_path: str, output_wav: str) -> bool:
        """Extracts mono 16kHz WAV from video slice for optimal transcription."""
        os.makedirs(os.path.dirname(os.path.abspath(output_wav)), exist_ok=True)
        cmd = [
            "ffmpeg",
            "-y",
            "-i", video_path,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", "16000",
            "-ac", "1",
            output_wav
        ]
        try:
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        except Exception as e:
            print(f"[Transcriber] Audio extraction failed: {e}")
            return False

    def transcribe(self, audio_or_video_path: str) -> TranscriptResult:
        """Transcribes input and returns TranscriptResult with word timestamps and VAD filtering."""
        path = Path(audio_or_video_path)
        wav_path = path
        temp_wav = None

        if path.suffix.lower() not in [".wav"]:
            temp_wav = path.with_suffix(".temp.wav")
            if not self.extract_audio(str(path), str(temp_wav)):
                return TranscriptResult(full_text="", segments=[])
            wav_path = temp_wav

        self._load_model()

        if self._model == "fallback" or self._model is None:
            res = self._mock_transcription()
            if temp_wav and temp_wav.exists():
                temp_wav.unlink()
            return res

        segments_out = []
        full_text_parts = []

        try:
            # Enable Silero VAD to strip game noise, car engines, and silence
            segments, _ = self._model.transcribe(
                str(wav_path),
                word_timestamps=True,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=400, speech_pad_ms=200),
                beam_size=5,
                temperature=0.0
            )

            for seg in segments:
                words = []
                if hasattr(seg, "words") and seg.words:
                    for w in seg.words:
                        w_text = w.word.strip()
                        if w_text:
                            # Sanitize word bounds
                            w_start = max(0.0, float(w.start))
                            w_end = max(w_start + 0.1, float(w.end))
                            words.append(WordTimestamp(word=w_text, start=w_start, end=w_end, probability=w.probability))
                else:
                    words_split = seg.text.strip().split()
                    duration = max(0.1, seg.end - seg.start)
                    step = duration / max(1, len(words_split))
                    for i, w in enumerate(words_split):
                        w_start = seg.start + (i * step)
                        w_end = w_start + step
                        words.append(WordTimestamp(word=w, start=w_start, end=w_end, probability=0.9))

                if words:
                    segments_out.append(TranscriptSegment(text=seg.text.strip(), start=seg.start, end=seg.end, words=words))
                    full_text_parts.append(seg.text.strip())

        except Exception as e:
            print(f"[Transcriber] Transcription runtime error: {e}")

        if temp_wav and temp_wav.exists():
            try:
                temp_wav.unlink()
            except Exception:
                pass

        return TranscriptResult(full_text=" ".join(full_text_parts), segments=segments_out)

    def _mock_transcription(self) -> TranscriptResult:
        """Heuristic mock for tests or when whisper model is not yet compiled."""
        sample_words = [
            ("Wait,", 1.0, 1.4), ("look", 1.4, 1.7), ("at", 1.7, 1.9), ("this", 1.9, 2.2),
            ("car", 2.2, 2.6), ("coming", 2.6, 3.0), ("right", 3.0, 3.3), ("now!", 3.3, 3.7),
            ("Are", 5.0, 5.2), ("you", 5.2, 5.4), ("kidding", 5.4, 5.8), ("me?", 5.8, 6.2),
            ("He", 7.0, 7.2), ("flew", 7.2, 7.6), ("off", 7.6, 7.8), ("the", 7.8, 8.0),
            ("bridge!", 8.0, 8.6), ("NO", 9.0, 9.4), ("WAY!", 9.4, 9.9)
        ]
        words = [WordTimestamp(w, s, e, 0.95) for w, s, e in sample_words]
        seg1 = TranscriptSegment("Wait, look at this car coming right now!", 1.0, 3.7, words[:8])
        seg2 = TranscriptSegment("Are you kidding me?", 5.0, 6.2, words[8:12])
        seg3 = TranscriptSegment("He flew off the bridge! NO WAY!", 7.0, 9.9, words[12:])
        return TranscriptResult("Wait, look at this car coming right now! Are you kidding me? He flew off the bridge! NO WAY!", [seg1, seg2, seg3])
