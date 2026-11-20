"""
Test Suite for Autonomous AI Clipper Engine
"""

import os
import sys
import time
import subprocess
import pytest
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import engine
from engine.chat_monitor import ChatMonitor, SpikeEvent
from engine.transcriber import Transcriber, TranscriptResult, TranscriptSegment, WordTimestamp
from engine.ai_director import AIDirector, DirectorDecision
from engine.subtitle_burner import SubtitleBurner
from engine.video_compositor import VideoCompositor


def test_chat_monitor_spike_math():
    spikes = []
    def on_spike(event: SpikeEvent):
        spikes.append(event)

    monitor = ChatMonitor(
        channel="testchannel",
        baseline_window_sec=10,
        sample_interval_sec=0.5,
        spike_multiplier=2.0,
        min_messages_per_sec=4.0,
        cooldown_sec=2.0,
        on_spike=on_spike
    )

    # Feed normal baseline: 2 messages per interval (4 msgs/sec)
    for _ in range(6):
        for _ in range(2):
            monitor.feed_message("normal chat chatter")
        monitor._calculator_worker_single_step_test()

    assert len(spikes) == 0, "No spike should be detected during flat baseline"

    # Feed sudden burst: 20 messages in interval (40 msgs/sec) with hype emotes
    for _ in range(20):
        monitor.feed_message("OMEGALUL W NO WAY DEAD")
    monitor._calculator_worker_single_step_test()

    assert len(spikes) == 1, "Spike should be detected on burst"
    event = spikes[0]
    assert event.messages_per_sec >= 20.0
    assert "OMEGALUL" in event.top_emotes or "DEAD" in event.top_emotes


def test_ai_director_narrative_boundaries():
    director = AIDirector(
        provider="heuristic",
        virality_threshold=6.5,
        min_duration_sec=10.0,
        max_duration_sec=40.0
    )

    words = [
        WordTimestamp("Bro", 0.0, 0.4), WordTimestamp("look", 0.4, 0.8),
        WordTimestamp("at", 0.8, 1.0), WordTimestamp("this", 1.0, 1.4),
        WordTimestamp("jump!", 1.4, 2.0),
        WordTimestamp("OH", 15.0, 15.4), WordTimestamp("MY", 15.4, 15.8),
        WordTimestamp("GOD!", 15.8, 16.5), WordTimestamp("HE", 16.5, 17.0),
        WordTimestamp("LANDED", 17.0, 17.5), WordTimestamp("IT!", 17.5, 18.2)
    ]
    seg1 = TranscriptSegment("Bro look at this jump!", 0.0, 2.0, words[:5])
    seg2 = TranscriptSegment("OH MY GOD! HE LANDED IT!", 15.0, 18.2, words[5:])
    transcript = TranscriptResult("Bro look at this jump! OH MY GOD! HE LANDED IT!", [seg1, seg2])

    decision = director.evaluate_slice(
        transcript=transcript,
        spike_time_offset=16.0,
        chat_emotes=["W", "OMEGALUL", "DEAD"],
        channel_name="Tarik"
    )

    assert decision.virality_score >= 6.5
    assert decision.passed_filter is True
    assert decision.clip_start_sec <= 16.0
    assert decision.clip_end_sec >= 16.0
    dur = decision.clip_end_sec - decision.clip_start_sec
    assert 10.0 <= dur <= 40.0
    assert len(decision.hook_title) > 0


def test_subtitle_burner_ass_generation(tmp_path):
    burner = SubtitleBurner(
        font_name="Impact",
        font_size=24,
        words_per_group=3
    )

    words = [
        WordTimestamp("THIS", 10.0, 10.5),
        WordTimestamp("CAR", 10.5, 11.0),
        WordTimestamp("JUST", 11.0, 11.5),
        WordTimestamp("FLEW", 11.5, 12.0)
    ]
    seg = TranscriptSegment("THIS CAR JUST FLEW", 10.0, 12.0, words)
    transcript = TranscriptResult("THIS CAR JUST FLEW", [seg])

    ass_file = tmp_path / "test_subtitles.ass"
    burner.generate_ass(
        transcript=transcript,
        clip_start_sec=10.0,
        clip_end_sec=15.0,
        output_ass_path=str(ass_file)
    )

    assert ass_file.exists()
    content = ass_file.read_text(encoding="utf-8")
    assert "[Script Info]" in content
    assert "PlayResX: 1080" in content
    assert "PlayResY: 1920" in content
    assert "ViralStyle" in content
    assert "Dialogue:" in content
    # Timestamps should be re-indexed relative to clip_start_sec (10.0)
    assert "0:00:00.00" in content


def test_video_compositor_render_short(tmp_path):
    # Create a 6-second synthetic 16:9 test video using FFmpeg
    raw_video = tmp_path / "synthetic_stream.mp4"
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30",
        "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=44100",
        "-t", "6",
        "-c:v", "libx264", "-c:a", "aac",
        str(raw_video)
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    assert raw_video.exists()

    compositor = VideoCompositor(
        output_dir=str(tmp_path / "out"),
        cache_dir=str(tmp_path / "cache"),
        target_width=1080,
        target_height=1920
    )

    decision = DirectorDecision(
        virality_score=8.5,
        reasoning="Test clip",
        clip_start_sec=1.0,
        clip_end_sec=4.0,
        hook_title="TEST VIRAL HOOK 💀",
        caption="Bro test caption #gta6",
        passed_filter=True
    )

    out_file = compositor.render_short(
        source_video=str(raw_video),
        decision=decision,
        facecam_box=(0.7, 0.6, 0.3, 0.3),
        channel_name="Tester"
    )

    assert out_file is not None
    assert os.path.exists(out_file)

    # Check that probe verifies 1080x1920
    probe_cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=p=0",
        out_file
    ]
    probe_res = subprocess.run(probe_cmd, capture_output=True, text=True, check=True)
    res_str = probe_res.stdout.strip()
    assert "1080,1920" in res_str


def test_sticker_generator_emojis(tmp_path):
    from engine.sticker_generator import StickerGenerator
    gen = StickerGenerator(cache_dir=str(tmp_path / "cache"))
    out_png = tmp_path / "sticker.png"
    result = gen.generate_sticker_card(
        hook_title="Bro forgot it's just a\ngame😭😂",
        output_path=str(out_png)
    )
    assert os.path.exists(result)
    assert out_png.exists()


def test_face_tracker_preset_consistency():
    from engine.face_tracker import FaceTracker
    tracker = FaceTracker()
    box1 = tracker.detect_facecam_box("dummy.mp4", channel_name="ishowspeed")
    box2 = tracker.detect_facecam_box("dummy.mp4", channel_name="IShowSpeed")
    assert box1 == box2
    assert box1 == (0.008, 0.444, 0.212, 0.194)


def test_vision_qa_storyboard_and_verification(tmp_path):
    from engine.vision_qa import VisionQA, VisionQAResult

    # Create synthetic test video
    test_vid = tmp_path / "vision_test.mp4"
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc=size=640x360:rate=15",
        "-t", "4",
        "-c:v", "libx264",
        str(test_vid)
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    assert test_vid.exists()

    vqa = VisionQA(
        storyboards_dir=str(tmp_path / "storyboards")
    )

    frames = vqa.extract_storyboard_frames(str(test_vid), start_sec=0.5, end_sec=3.5, num_frames=4)
    assert len(frames) == 4
    for t, img in frames:
        assert img is not None
        assert img.shape[0] == 360 and img.shape[1] == 640

    # Test storyboard image generation
    storyboard_path = vqa.generate_storyboard_image(
        frames=frames,
        clip_name="test_clip",
        verdict="APPROVED",
        premise_hook="Speed crashed the fastest car💀",
        what_actually_happens="Speed accidentally drives off a bridge.",
        score=8.5
    )
    assert os.path.exists(storyboard_path)
    assert storyboard_path.endswith(".jpg")


