import requests
import re
import pytchat
import time

url = "https://www.youtube.com/@IShowSpeed/live"
headers = {"User-Agent": "Mozilla/5.0"}
resp = requests.get(url, headers=headers, timeout=10)

matches = re.findall(r'"videoId":"([a-zA-Z0-9_-]{11})"', resp.text)
if not matches:
    print("No videoId found")
    exit(1)

video_id = matches[0]
print("Found Speed Live Video ID:", video_id)

print("Connecting pytchat to Speed's live chat...")
chat = pytchat.create(video_id=video_id)
msg_count = 0
start = time.time()

while chat.is_alive() and msg_count < 25:
    for c in chat.get().sync_items():
        print(f"[{c.datetime}] {c.author.name}: {c.message}")
        msg_count += 1
        if msg_count >= 25:
            break
    time.sleep(0.5)

dur = time.time() - start
print(f"Read {msg_count} messages in {dur:.2f}s (~{msg_count/dur:.1f} msgs/sec)")
