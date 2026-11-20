"""
Resend Email Notification Engine
Sends instant alerts with clip details, virality scores, and review links whenever a fresh clip is ready.
"""

import os
import requests
from typing import Optional, Dict, Any
from requests.adapters import HTTPAdapter
from urllib3.util import Retry


class ClipNotifier:
    def __init__(
        self,
        api_key: Optional[str] = None,
        from_email: Optional[str] = None,
        to_email: Optional[str] = None,
        dashboard_url: str = "http://localhost:3000"
    ):
        # Read from environment or local .env
        self.api_key = api_key or os.environ.get("RESEND_API_KEY")
        self.from_email = from_email or os.environ.get("RESEND_FROM_EMAIL", "onboarding@resend.dev")
        self.to_email = to_email or os.environ.get("NOTIFICATION_EMAIL", "princederder44@gmail.com")
        self.dashboard_url = dashboard_url

        if not self.api_key and os.path.exists(".env"):
            with open(".env", "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("RESEND_API_KEY="):
                        self.api_key = line.strip().split("=", 1)[1]
                    elif line.startswith("NOTIFICATION_EMAIL="):
                        self.to_email = line.strip().split("=", 1)[1]
                    elif line.startswith("RESEND_FROM_EMAIL="):
                        self.from_email = line.strip().split("=", 1)[1]

        self.session = requests.Session()
        self.session.mount("https://", HTTPAdapter(max_retries=Retry(total=3, backoff_factor=1)))

    def send_new_clip_alert(
        self,
        clip_name: str,
        hook_title: str,
        virality_score: float,
        caption: str,
        hashtags: list,
        what_happens: str,
        duration_sec: float,
        storyboard_url: Optional[str] = None
    ) -> bool:
        """
        Sends an HTML email notification via Resend with clip metadata and review link.
        """
        if not self.api_key or not self.to_email:
            print("[ClipNotifier] Missing Resend API key or notification email. Skipping.")
            return False

        hashtag_str = " ".join(hashtags) if hashtags else "#gta6 #ishowspeed #gaming #shorts #viral"
        score_badge = "🔥 VIRAL POTENTIAL" if virality_score >= 8.0 else "⚡ GOOD MOMENT"
        score_color = "#FF4500" if virality_score >= 8.0 else "#FFB800"

        html_body = f"""
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0b0f19; color: #f3f4f6; margin: 0; padding: 24px; }}
    .card {{ max-width: 580px; margin: 0 auto; background: #161e2e; border: 1px solid #2d3748; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }}
    .header {{ background: linear-gradient(135deg, #7928ca 0%, #ff0080 100%); padding: 24px; text-align: center; }}
    .header h1 {{ margin: 0; color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }}
    .header p {{ margin: 6px 0 0; color: rgba(255,255,255,0.85); font-size: 14px; }}
    .content {{ padding: 28px 24px; }}
    .badge {{ display: inline-block; background: {score_color}22; color: {score_color}; border: 1px solid {score_color}55; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 700; margin-bottom: 16px; }}
    .hook-title {{ font-size: 22px; font-weight: 800; color: #ffffff; line-height: 1.3; margin: 0 0 12px; }}
    .stat-row {{ display: flex; background: #111827; border-radius: 10px; padding: 12px 16px; margin: 16px 0; }}
    .stat-item {{ flex: 1; text-align: center; }}
    .stat-label {{ font-size: 11px; text-transform: uppercase; color: #9ca3af; letter-spacing: 0.5px; }}
    .stat-val {{ font-size: 18px; font-weight: 800; color: #60a5fa; margin-top: 2px; }}
    .narrative-box {{ background: #1f2937; border-left: 4px solid #8b5cf6; padding: 14px 16px; border-radius: 6px; margin: 16px 0; }}
    .narrative-box p {{ margin: 0; font-size: 14px; line-height: 1.5; color: #e5e7eb; }}
    .caption-box {{ background: #111827; border: 1px dashed #374151; padding: 14px; border-radius: 8px; margin: 16px 0; }}
    .caption-box p {{ margin: 0 0 8px; font-size: 14px; color: #d1d5db; }}
    .hashtags {{ color: #3b82f6; font-size: 13px; font-weight: 600; margin: 0; }}
    .btn-wrap {{ text-align: center; margin-top: 28px; }}
    .btn {{ display: inline-block; background: linear-gradient(135deg, #00c6ff 0%, #0072ff 100%); color: #ffffff !important; text-decoration: none; padding: 14px 32px; border-radius: 30px; font-weight: 700; font-size: 16px; box-shadow: 0 4px 15px rgba(0, 114, 255, 0.4); }}
    .footer {{ text-align: center; padding: 16px; font-size: 12px; color: #6b7280; border-top: 1px solid #1f2937; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>🎬 AntigravClip: New Clip Ready</h1>
      <p>Autonomous AI Stream Clipper • IShowSpeed</p>
    </div>
    <div class="content">
      <div class="badge">{score_badge} • {virality_score:.1f} / 10.0</div>
      <h2 class="hook-title">{hook_title}</h2>
      
      <div class="stat-row">
        <div class="stat-item">
          <div class="stat-label">Virality Score</div>
          <div class="stat-val">{virality_score:.1f}/10</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Duration</div>
          <div class="stat-val">{duration_sec:.1f}s</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Format</div>
          <div class="stat-val">9:16 Short</div>
        </div>
      </div>

      <div class="narrative-box">
        <div style="font-size: 12px; font-weight: 700; color: #a78bfa; margin-bottom: 4px; text-transform: uppercase;">Vision QA Breakdown</div>
        <p>{what_happens}</p>
      </div>

      <div class="caption-box">
        <div style="font-size: 11px; font-weight: 700; color: #9ca3af; margin-bottom: 6px; text-transform: uppercase;">Ready-to-Post Social Caption</div>
        <p>{caption}</p>
        <p class="hashtags">{hashtag_str}</p>
      </div>

      <div class="btn-wrap">
        <a href="{self.dashboard_url}" class="btn">Review & Approve in Dashboard →</a>
      </div>
    </div>
    <div class="footer">
      Generated automatically by AntigravClip Autonomous AI Engine.
    </div>
  </div>
</body>
</html>
"""
        payload = {
            "from": self.from_email,
            "to": [self.to_email],
            "subject": f"🔥 New Clip ({virality_score:.1f}/10): {hook_title}",
            "html": html_body
        }

        try:
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            resp = self.session.post("https://api.resend.com/emails", headers=headers, json=payload, timeout=12)
            if resp.status_code in [200, 201]:
                print(f"📧 [ClipNotifier] Notification email sent to {self.to_email} (ID: {resp.json().get('id')})")
                return True
            else:
                print(f"⚠️ [ClipNotifier] Failed to send email (HTTP {resp.status_code}): {resp.text}")
                return False
        except Exception as e:
            print(f"⚠️ [ClipNotifier] Error sending notification email: {e}")
            return False
