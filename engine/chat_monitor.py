"""
Twitch Chat Velocity & Spike Detection Engine
Connects to Twitch IRC anonymously and tracks chat velocity (messages per second).
Detects significant spikes using dynamic standard-deviation thresholds.
"""

import socket
import threading
import time
import re
from collections import deque, Counter
from typing import Callable, Optional, Dict, List, Any


class SpikeEvent:
    def __init__(
        self,
        timestamp: float,
        channel: str,
        messages_per_sec: float,
        mean_mps: float,
        std_mps: float,
        top_emotes: List[str],
        sample_messages: List[str]
    ):
        self.timestamp = timestamp
        self.channel = channel
        self.messages_per_sec = messages_per_sec
        self.mean_mps = mean_mps
        self.std_mps = std_mps
        self.top_emotes = top_emotes
        self.sample_messages = sample_messages

    def __repr__(self) -> str:
        return (
            f"<SpikeEvent ch={self.channel} mps={self.messages_per_sec:.1f} "
            f"(mean={self.mean_mps:.1f}, std={self.std_mps:.1f}) emotes={self.top_emotes[:4]}>"
        )


class ChatMonitor:
    def __init__(
        self,
        channel: str,
        platform: str = "twitch",
        baseline_window_sec: int = 60,
        sample_interval_sec: float = 2.0,
        spike_multiplier: float = 1.6,
        min_messages_per_sec: float = 4.0,
        cooldown_sec: float = 35.0,
        on_spike: Optional[Callable[[SpikeEvent], None]] = None,
    ):
        self.channel = channel.lower().lstrip("#")
        self.platform = platform.lower()
        if "youtube" in self.channel or self.channel.startswith("@") or self.channel == "ishowspeed":
            self.platform = "youtube"

        self.baseline_window_sec = baseline_window_sec
        self.sample_interval_sec = sample_interval_sec
        self.spike_multiplier = spike_multiplier
        self.min_messages_per_sec = min_messages_per_sec
        self.cooldown_sec = cooldown_sec
        self.on_spike = on_spike

        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._calculator_thread: Optional[threading.Thread] = None
        self._sock: Optional[socket.socket] = None
        self._youtube_video_id: Optional[str] = None

        # Velocity tracking state
        self._current_interval_count = 0
        self._current_messages: List[str] = []
        self._lock = threading.Lock()
        
        max_samples = max(5, int(self.baseline_window_sec / self.sample_interval_sec))
        self._history = deque(maxlen=max_samples)
        self._last_spike_time = 0.0
        self._last_heartbeat_time = 0.0

    def start(self):
        """Starts the chat listener and the velocity calculator threads."""
        self._running = True
        worker_func = self._youtube_chat_worker if self.platform == "youtube" else self._irc_worker
        self._thread = threading.Thread(target=worker_func, daemon=True, name="ChatListener-Worker")
        self._calculator_thread = threading.Thread(target=self._calculator_worker, daemon=True, name="Velocity-Worker")
        self._thread.start()
        self._calculator_thread.start()

    def stop(self):
        """Stops monitoring and closes IRC socket."""
        self._running = False
        if self._sock:
            try:
                self._sock.shutdown(socket.SHUT_RDWR)
                self._sock.close()
            except Exception:
                pass

    def feed_message(self, text: str):
        """Allows feeding messages directly (useful for testing and offline simulation)."""
        with self._lock:
            self._current_interval_count += 1
            if len(self._current_messages) < 50:
                self._current_messages.append(text)

    def _youtube_chat_worker(self):
        """Connects to YouTube Live Chat using pytchat."""
        import pytchat
        import requests

        video_id = self._youtube_video_id
        if not video_id:
            # Resolve live video id from channel url
            channel_handle = self.channel.lstrip("@")
            yt_url = f"https://www.youtube.com/@{channel_handle}/live"
            try:
                r = requests.get(yt_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=12)
                matches = re.findall(r'"videoId":"([a-zA-Z0-9_-]{11})"', r.text)
                if matches:
                    video_id = matches[0]
                    self._youtube_video_id = video_id
            except Exception as e:
                print(f"[ChatMonitor] Failed to resolve YouTube live video ID for @{channel_handle}: {e}")

        if not video_id:
            print(f"[ChatMonitor] Could not find active YouTube live stream for '{self.channel}'.")
            return

        print(f"[ChatMonitor] Connected to YouTube Live Chat (Video ID: {video_id}).")
        while self._running:
            try:
                chat = pytchat.create(video_id=video_id, interruptable=False)
                while self._running and chat.is_alive():
                    for c in chat.get().sync_items():
                        self.feed_message(c.message)
                    time.sleep(0.5)
            except Exception as e:
                print(f"[ChatMonitor] YouTube chat error: {e}")
                if self._running:
                    time.sleep(3)

    def _irc_worker(self):
        server = "irc.chat.twitch.tv"
        port = 6667
        # Anonymous Twitch guest login convention: justinfan + random 5 digits
        nickname = f"justinfan{int(time.time()) % 80000 + 10000}"

        while self._running:
            try:
                self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                self._sock.settimeout(15.0)
                self._sock.connect((server, port))

                self._sock.send(f"PASS SCHMULLUS\r\n".encode("utf-8"))
                self._sock.send(f"NICK {nickname}\r\n".encode("utf-8"))
                self._sock.send(f"JOIN #{self.channel}\r\n".encode("utf-8"))

                buffer = ""
                privmsg_regex = re.compile(r"^:[^!]+![^@]+@[^\s]+\s+PRIVMSG\s+#[^\s]+\s+:(.*)$")

                while self._running:
                    data = self._sock.recv(4096).decode("utf-8", errors="ignore")
                    if not data:
                        break
                    buffer += data
                    lines = buffer.split("\r\n")
                    buffer = lines.pop()

                    for line in lines:
                        if line.startswith("PING"):
                            self._sock.send("PONG :tmi.twitch.tv\r\n".encode("utf-8"))
                            continue

                        match = privmsg_regex.match(line)
                        if match:
                            msg_text = match.group(1).strip()
                            self.feed_message(msg_text)

            except Exception as e:
                if self._running:
                    time.sleep(3)
            finally:
                if self._sock:
                    try:
                        self._sock.close()
                    except Exception:
                        pass

    def _step_calculation(self):
        """Single deterministic calculation step for interval processing and testing."""
        with self._lock:
            count = self._current_interval_count
            messages = list(self._current_messages)
            self._current_interval_count = 0
            self._current_messages.clear()

        mps = count / self.sample_interval_sec
        now = time.time()

        if len(self._history) >= 4:
            import math
            mean = sum(self._history) / len(self._history)
            variance = sum((x - mean) ** 2 for x in self._history) / len(self._history)
            std = math.sqrt(variance)

            threshold = mean + (self.spike_multiplier * max(std, 1.0))

            # Periodic heartbeat log every 6 seconds so user knows it is live
            if (now - self._last_heartbeat_time) >= 6.0:
                self._last_heartbeat_time = now
                print(f"[ChatMonitor] 📊 Live MPS: {mps:4.1f} msg/s | Baseline: {mean:4.1f} | Trigger at: {threshold:4.1f} msg/s", flush=True)

            if (
                mps >= threshold
                and mps >= self.min_messages_per_sec
                and (now - self._last_spike_time) > self.cooldown_sec
            ):
                self._last_spike_time = now
                top_words = self._extract_top_tokens(messages)

                event = SpikeEvent(
                    timestamp=now,
                    channel=self.channel,
                    messages_per_sec=mps,
                    mean_mps=mean,
                    std_mps=std,
                    top_emotes=top_words,
                    sample_messages=messages[:10]
                )

                if self.on_spike:
                    try:
                        self.on_spike(event)
                    except Exception as ex:
                        print(f"[ChatMonitor] Error in spike callback: {ex}")

        self._history.append(mps)

    def _calculator_worker_single_step_test(self):
        self._step_calculation()

    def _calculator_worker(self):
        while self._running:
            time.sleep(self.sample_interval_sec)
            self._step_calculation()

    def _extract_top_tokens(self, messages: List[str]) -> List[str]:
        words = []
        for msg in messages:
            for w in msg.split():
                clean = re.sub(r"[^\w]", "", w)
                if len(clean) >= 2:
                    words.append(clean)
        counts = Counter(words)
        return [word for word, _ in counts.most_common(8)]
