"""
Autonomous AI Stream Clipper - Orchestrator & CLI
Runs continuous live stream monitoring or offline video processing.
Features automatic stream health watchdog and duplicate detection to prevent repeated clips.
"""

import os
import sys
import time
import argparse
import yaml
import difflib
from pathlib import Path

import engine
from engine.chat_monitor import ChatMonitor, SpikeEvent
from engine.stream_buffer import StreamBuffer
from engine.transcriber import Transcriber
from engine.ai_director import AIDirector
from engine.subtitle_burner import SubtitleBurner
from engine.video_compositor import VideoCompositor
from engine.vision_qa import VisionQA
from engine.notifier import ClipNotifier
from engine.clip_store import ClipStore


def load_config(config_path: str = "config.yaml") -> dict:
    if os.path.exists(config_path):
        with open(config_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)
    return {}


class ClipperOrchestrator:
    def __init__(self, config: dict, channel_override: str = None, platform_override: str = None):
        self.config = config
        self.channel = (channel_override or config.get("target", {}).get("channel", "tarik")).lower().lstrip("#").lstrip("@")
        
        target_platform = (platform_override or config.get("target", {}).get("platform") or "twitch").lower()
        self.platform = target_platform
        self._running = False
        
        # Initialize modules
        c_mon = config.get("chat_monitor", {})
        self.chat_monitor = ChatMonitor(
            channel=self.channel,
            platform=self.platform,
            baseline_window_sec=c_mon.get("baseline_window_sec", 60),
            sample_interval_sec=c_mon.get("sample_interval_sec", 2.0),
            spike_multiplier=c_mon.get("spike_std_multiplier", 2.8),
            min_messages_per_sec=c_mon.get("min_messages_per_sec", 4.0),
            cooldown_sec=c_mon.get("cooldown_sec", 45.0),
            on_spike=self.handle_spike
        )

        s_buf = config.get("stream_buffer", {})
        self.stream_buffer = StreamBuffer(
            channel=self.channel,
            platform=self.platform,
            cache_dir=config.get("storage", {}).get("cache_dir", "./cache"),
            buffer_duration_sec=s_buf.get("buffer_duration_sec", 300),
            stream_quality=s_buf.get("stream_quality", "720p60,720p,best")
        )
        self.slice_pre_spike = s_buf.get("slice_pre_spike_sec", 50)
        self.slice_post_spike = s_buf.get("slice_post_spike_sec", 25)

        self.transcriber = Transcriber(model_size="base.en", device="cpu", compute_type="int8")

        ai_cfg = config.get("ai_director", {})
        self.ai_director = AIDirector(
            provider=ai_cfg.get("provider", "unorouter"),
            model_name=ai_cfg.get("model", "deepseek-v4.1-flash-1017:free"),
            virality_threshold=ai_cfg.get("virality_threshold", 7.0),
            min_duration_sec=ai_cfg.get("min_clip_duration_sec", 15.0),
            max_duration_sec=ai_cfg.get("max_clip_duration_sec", 58.0),
            api_key=ai_cfg.get("api_key"),
            api_base_url=ai_cfg.get("api_base_url")
        )

        sub_cfg = config.get("video_compositor", {}).get("subtitles", {})
        self.subtitle_burner = SubtitleBurner(
            font_name=sub_cfg.get("font", "Impact"),
            font_size=sub_cfg.get("font_size", 44),
            primary_color=sub_cfg.get("base_color", "&H00FFFFFF"),
            highlight_color=sub_cfg.get("highlight_color", "&H0000E5FF"),
            words_per_group=sub_cfg.get("words_per_group", 2)
        )

        v_cfg = config.get("video_compositor", {})
        self.compositor = VideoCompositor(
            output_dir=config.get("storage", {}).get("output_dir", "./output"),
            cache_dir=config.get("storage", {}).get("cache_dir", "./cache"),
            target_width=v_cfg.get("width", 1080),
            target_height=v_cfg.get("height", 1920),
            facecam_ratio=v_cfg.get("facecam", {}).get("canvas_ratio", 0.35),
            gameplay_ratio=v_cfg.get("gameplay", {}).get("canvas_ratio", 0.65)
        )

        self.facecam_coords = tuple(v_cfg.get("facecam", {}).get("default_box", [0.72, 0.65, 0.28, 0.35]))

        vqa_cfg = config.get("vision_qa", {})
        self.vision_qa = VisionQA(
            api_key=vqa_cfg.get("api_key") or config.get("ai_director", {}).get("api_key"),
            api_base_url=vqa_cfg.get("api_base_url", "https://api.unorouter.com/v1/chat/completions"),
            min_comprehension_score=vqa_cfg.get("min_comprehension_score", 6.0),
            storyboards_dir=config.get("storage", {}).get("storyboards_dir", "./output/storyboards")
        )

        # Clip Store & Notifications
        self.clip_store = ClipStore(
            data_dir=config.get("storage", {}).get("data_dir", "./data"),
            output_dir=config.get("storage", {}).get("output_dir", "./output"),
            metadata_dir=str(Path(config.get("storage", {}).get("output_dir", "./output")) / "metadata"),
            storyboards_dir=config.get("storage", {}).get("storyboards_dir", "./output/storyboards")
        )
        notif_cfg = config.get("notifications", {})
        self.notifier = ClipNotifier(
            api_key=notif_cfg.get("resend_api_key"),
            from_email=notif_cfg.get("from_email"),
            to_email=notif_cfg.get("to_email"),
            dashboard_url=notif_cfg.get("dashboard_url", "http://localhost:3000")
        )

        # Deduplication state
        self.recent_transcripts = []
        self.last_clip_rendered_time = 0.0

    def stop(self):
        print(f"[ClipperOrchestrator] Stopping engine for {self.platform.upper()} #{self.channel}...")
        self._running = False
        if self.chat_monitor:
            self.chat_monitor.stop()
        if self.stream_buffer:
            self.stream_buffer.stop_recording()

    def start_live(self):
        self._running = True
        print("=" * 60)
        print(f"🚀 AUTONOMOUS AI CLIPPER ENGINE STARTED")
        print(f"Target Channel : #{self.channel} ({self.platform.upper()})")
        print(f"AI Provider    : {self.ai_director.provider} ({self.ai_director.model_name})")
        print(f"Virality Gate  : >= {self.ai_director.virality_threshold}/10.0")
        print(f"Output Vault   : {self.compositor.output_dir.resolve()}")
        print("=" * 60)

        # Check live stream status
        stream_url = self.stream_buffer.get_channel_url()
        print(f"[StreamBuffer] Probing stream for {stream_url}...")
        is_live = self.stream_buffer.is_stream_live()
        if is_live:
            print(f"🟢 [StreamBuffer] Broadcast is LIVE! Starting circular video buffer...")
            self.stream_buffer.start_recording()
        else:
            print(f"⚠️ [StreamBuffer] Streamer @{self.channel} is currently OFFLINE on {self.platform.upper()}. Standing by for broadcast...")

        # Start chat monitor
        self.chat_monitor.start()
        print(f"[ChatMonitor] Listening to chat velocity on {self.platform.upper()} #{self.channel}...")

        consecutive_offline_checks = 0
        try:
            while self._running:
                # Sleep in short slices to allow prompt shutdown when requested
                for _ in range(15):
                    if not self._running:
                        break
                    time.sleep(1)

                if not self._running:
                    break

                # If buffer is actively flowing and healthy, no need to probe streamlink
                if self.stream_buffer._running and self.stream_buffer.is_healthy():
                    consecutive_offline_checks = 0
                    continue

                # Buffer is stopped or stalled, check live status to reconnect
                is_live = self.stream_buffer.is_stream_live()
                if is_live:
                    print(f"🔄 [StreamBuffer] Live broadcast active! Re-attaching recording buffer...")
                    self.stream_buffer.start_recording()
                    consecutive_offline_checks = 0
                else:
                    consecutive_offline_checks += 1
                    # Only log standby after 2 consecutive failed probes (~30s)
                    if consecutive_offline_checks >= 2 and consecutive_offline_checks % 4 == 2:
                        print(f"⏳ [StreamBuffer] Standby: @{self.channel} is offline on {self.platform.upper()}. Waiting for live broadcast...")
        except KeyboardInterrupt:
            print("\nShutting down clipper engine...")
        finally:
            self.stop()
            print(f"✅ Clipper engine stopped cleanly for #{self.channel}.")

    def handle_spike(self, event: SpikeEvent):
        # Short cooldown to prevent duplicate cuts of the same reaction
        now = time.time()
        if now - self.last_clip_rendered_time < 25.0:
            print(f"[Pipeline] Spike ignored: in brief cooldown ({now - self.last_clip_rendered_time:.1f}s < 25s).")
            return

        print("\n" + "=" * 50)
        print(f"🔥 CHAT VELOCITY SPIKE DETECTED on #{event.channel}!")
        print(f"Velocity: {event.messages_per_sec:.1f} msgs/sec (Threshold was {event.mean_mps + 2.8*event.std_mps:.1f})")
        print(f"Top Emotes: {', '.join(event.top_emotes)}")
        print("=" * 50)

        # Wait for the post-spike aftermath to record into buffer
        print(f"[Pipeline] Waiting {self.slice_post_spike}s to buffer stream aftermath...")
        time.sleep(self.slice_post_spike)

        slice_total_dur = self.slice_pre_spike + self.slice_post_spike
        slice_path = self.compositor.cache_dir / f"slice_{int(event.timestamp)}.mp4"

        print(f"[Pipeline] Extracting {slice_total_dur}s rolling slice...")
        extracted = self.stream_buffer.extract_slice_from_buffer(
            output_path=str(slice_path),
            slice_duration_sec=slice_total_dur
        )

        if not extracted or not os.path.exists(extracted):
            print("[Pipeline] Buffer slice extraction yielded no fresh video. Skipping.")
            return

        self.process_candidate(
            video_slice_path=extracted,
            spike_offset_sec=float(self.slice_pre_spike),
            chat_emotes=event.top_emotes,
            channel_name=event.channel
        )

    def _is_duplicate_transcript(self, text: str) -> bool:
        """Checks if a transcript is substantially identical to an already clipped moment."""
        clean = " ".join(text.lower().split())
        if len(clean) < 20:
            return False

        for prev in self.recent_transcripts:
            # Check prefix match or sequence similarity
            if clean[:80] == prev[:80]:
                return True
            ratio = difflib.SequenceMatcher(None, clean, prev).ratio()
            if ratio > 0.70:
                return True
        return False

    def process_candidate(
        self,
        video_slice_path: str,
        spike_offset_sec: float,
        chat_emotes: list,
        channel_name: str
    ):
        try:
            print(f"[Pipeline] Transcribing audio with word-level timestamps...")
            transcript = self.transcriber.transcribe(video_slice_path)
            print(f"[Pipeline] Transcript text ({len(transcript.full_text)} chars): \"{transcript.full_text[:120]}...\"")

            # Duplicate content check
            if self._is_duplicate_transcript(transcript.full_text):
                print("⚠️ [Pipeline] Duplicate audio detected from an earlier processed clip. Skipping to prevent identical outputs.")
                return

            print(f"[Pipeline] Consulting AI Director for narrative boundaries & virality score...")
            decision = self.ai_director.evaluate_slice(
                transcript=transcript,
                spike_time_offset=spike_offset_sec,
                chat_emotes=chat_emotes,
                channel_name=channel_name
            )

            print(f"[AI Director] Score: {decision.virality_score}/10 | Passed: {decision.passed_filter}")
            print(f"[AI Director] Cut: {decision.clip_start_sec:.1f}s -> {decision.clip_end_sec:.1f}s (Dur: {decision.clip_end_sec - decision.clip_start_sec:.1f}s)")
            print(f"[AI Director] Hook: {decision.hook_title}")
            print(f"[AI Director] Reasoning: {decision.reasoning}")

            if not decision.passed_filter:
                print(f"❌ [AI Director] Clip discarded. Did not meet virality threshold ({decision.virality_score} < {self.ai_director.virality_threshold}).")
                return

            # Multimodal Vision QA & Comprehension Verification
            print(f"[Pipeline] Running Multimodal Vision QA (comprehension & streamer engagement check)...")
            vision_res = self.vision_qa.verify_clip(
                video_path=video_slice_path,
                start_sec=decision.clip_start_sec,
                end_sec=decision.clip_end_sec,
                candidate_hook=decision.hook_title,
                transcript_text=transcript.full_text,
                channel_name=channel_name
            )

            if not vision_res.passed:
                print(f"❌ [Vision QA] Clip REJECTED (Score: {vision_res.comprehension_score:.1f}/10)")
                print(f"   Reason: {vision_res.rejection_reason}")
                print(f"   Storyboard logged: {vision_res.storyboard_path}")
                return

            print(f"✅ [Vision QA] Clip APPROVED (Score: {vision_res.comprehension_score:.1f}/10)")
            print(f"   Action: {vision_res.what_actually_happens}")
            print(f"   Premise Hook: {vision_res.premise_hook}")
            if vision_res.premise_hook:
                decision.hook_title = vision_res.premise_hook

            # Add to recent transcripts memory (keep last 30)
            clean = " ".join(transcript.full_text.lower().split())
            self.recent_transcripts.append(clean)
            if len(self.recent_transcripts) > 30:
                self.recent_transcripts.pop(0)

            # Generate animated ASS subtitles
            ass_path = str(self.compositor.cache_dir / f"subtitles_{int(time.time())}.ass")
            print(f"[Pipeline] Generating kinetic animated ASS subtitles...")
            self.subtitle_burner.generate_ass(
                transcript=transcript,
                clip_start_sec=decision.clip_start_sec,
                clip_end_sec=decision.clip_end_sec,
                output_ass_path=ass_path
            )

            # Render 9:16 vertical short (with calibrated facecam & authentic emoji sticker)
            print(f"[Pipeline] Rendering final 9:16 short video...")
            output_file = self.compositor.render_short(
                source_video=video_slice_path,
                decision=decision,
                ass_subtitles_path=ass_path,
                facecam_box=None,
                channel_name=channel_name,
                extra_metadata={"vision_qa": vision_res.to_dict()}
            )

            if output_file:
                self.last_clip_rendered_time = time.time()
                print(f"✅ [SUCCESS] Finished ready-to-post vertical short: {output_file}")
                
                # Sync into data/clips.json for dashboard
                try:
                    self.clip_store.sync_from_metadata()
                except Exception as e:
                    print(f"[Pipeline] Warning: Clip store sync failed: {e}")

                # Send email notification via Resend
                try:
                    hashtags = ["#gta6", "#ishowspeed", "#gaming", "#shorts", "#viral", "#fyp"]
                    self.notifier.send_new_clip_alert(
                        clip_name=os.path.basename(output_file),
                        hook_title=decision.hook_title,
                        virality_score=decision.virality_score,
                        caption=decision.caption,
                        hashtags=hashtags,
                        what_happens=vision_res.what_actually_happens,
                        duration_sec=round(decision.clip_end_sec - decision.clip_start_sec, 1)
                    )
                except Exception as e:
                    print(f"[Pipeline] Warning: Notification sending failed: {e}")
        finally:
            # Clean up temporary candidate slice to preserve disk space
            if "slice_" in os.path.basename(video_slice_path) and os.path.exists(video_slice_path):
                try:
                    os.unlink(video_slice_path)
                except Exception:
                    pass
            if 'ass_path' in locals() and ass_path and os.path.exists(ass_path):
                try:
                    os.unlink(ass_path)
                except Exception:
                    pass


def main():
    parser = argparse.ArgumentParser(description="Autonomous AI Stream Clipper Engine")
    parser.add_argument("--config", default="config.yaml", help="Path to config.yaml")
    parser.add_argument("--channel", default=None, help="Target streamer channel name")
    parser.add_argument("--mode", default="live", choices=["live", "process-video", "clip-now", "test"], help="Running mode")
    parser.add_argument("--video", default=None, help="Input video for process-video mode")
    parser.add_argument("--threshold", type=float, default=None, help="Override virality threshold")
    parser.add_argument("--provider", default=None, choices=["unorouter", "gemini", "openai", "heuristic"], help="AI provider")
    args = parser.parse_args()

    cfg = load_config(args.config)
    if args.threshold is not None:
        cfg.setdefault("ai_director", {})["virality_threshold"] = args.threshold
    if args.provider is not None:
        cfg.setdefault("ai_director", {})["provider"] = args.provider

    orchestrator = ClipperOrchestrator(cfg, channel_override=args.channel)

    if args.mode == "live":
        orchestrator.start_live()
    elif args.mode == "clip-now":
        print(f"Instantly clipping last 60 seconds from active buffer for {orchestrator.channel}...")
        slice_path = orchestrator.compositor.cache_dir / f"slice_manual_{int(time.time())}.mp4"
        extracted = orchestrator.stream_buffer.extract_slice_from_buffer(str(slice_path), slice_duration_sec=60.0)
        if extracted:
            orchestrator.process_candidate(
                video_slice_path=extracted,
                spike_offset_sec=35.0,
                chat_emotes=["W", "L", "CLIP", "SUI", "DEAD"],
                channel_name=orchestrator.channel
            )
        else:
            print("No buffer segments available yet to clip.")
    elif args.mode == "process-video":
        if not args.video or not os.path.exists(args.video):
            print(f"Error: Video file not found: {args.video}")
            sys.exit(1)
        print(f"Processing offline video: {args.video}")
        orchestrator.process_candidate(
            video_slice_path=args.video,
            spike_offset_sec=15.0,
            chat_emotes=["OMEGALUL", "W", "DEAD"],
            channel_name=orchestrator.channel
        )
    elif args.mode == "test":
        print("Self-test mode...")


if __name__ == "__main__":
    main()
