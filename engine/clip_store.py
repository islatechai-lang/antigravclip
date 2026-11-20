"""
Synchronized Clip Store & State Database
Tracks all generated clips, their review states (pending/approved/declined/posted),
hashtags, and social post records. Keeps data/clips.json updated for the dashboard.
"""

import os
import json
import glob
import requests
from pathlib import Path
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

load_dotenv()


class ClipStore:
    def __init__(
        self,
        data_dir: str = "./data",
        output_dir: str = "./output",
        metadata_dir: str = "./output/metadata",
        storyboards_dir: str = "./output/storyboards"
    ):
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = self.data_dir / "clips.json"
        self.output_dir = Path(output_dir)
        self.metadata_dir = Path(metadata_dir)
        self.storyboards_dir = Path(storyboards_dir)

        if not self.db_path.exists():
            self._save_db([])

    def _load_db(self) -> List[Dict[str, Any]]:
        if self.db_path.exists():
            try:
                with open(self.db_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return []
        return []

    def _save_db(self, clips: List[Dict[str, Any]]) -> None:
        with open(self.db_path, "w", encoding="utf-8") as f:
            json.dump(clips, f, indent=2)

    def sync_from_metadata(self) -> List[Dict[str, Any]]:
        """Scans output/metadata/*.json and merges any new clips into data/clips.json."""
        existing = {c["id"]: c for c in self._load_db()}
        meta_files = glob.glob(str(self.metadata_dir / "*.json"))

        default_hashtags = ["#gta6", "#ishowspeed", "#gaming", "#shorts", "#viral", "#fyp"]

        for mf in sorted(meta_files):
            try:
                with open(mf, "r", encoding="utf-8") as f:
                    meta = json.load(f)
            except Exception:
                continue

            file_name = meta.get("file", os.path.basename(mf).replace(".json", ".mp4"))
            clip_id = Path(file_name).stem

            # Find matching storyboard if available
            storyboard = meta.get("vision_qa", {}).get("storyboard_path")
            if not storyboard:
                sb_matches = glob.glob(str(self.storyboards_dir / f"storyboard_*{clip_id.split('_')[-1]}*.jpg"))
                if sb_matches:
                    storyboard = sb_matches[0]

            if clip_id not in existing:
                existing[clip_id] = {
                    "id": clip_id,
                    "file": file_name,
                    "video_path": str(self.output_dir / file_name),
                    "channel": meta.get("channel", "ishowspeed"),
                    "hook_title": meta.get("hook_title", "Viral GTA 6 Moment"),
                    "caption": meta.get("caption", "Watch this crazy moment on stream!"),
                    "hashtags": default_hashtags,
                    "virality_score": meta.get("virality_score", 7.5),
                    "reasoning": meta.get("reasoning", ""),
                    "duration_seconds": meta.get("duration_seconds", 30.0),
                    "what_happens": meta.get("vision_qa", {}).get("what_actually_happens", "Moment verified by AI Director."),
                    "storyboard_path": storyboard,
                    "status": "pending", # 'pending', 'approved', 'declined', 'posted'
                    "created_at": meta.get("created_at"),
                    "posted_channels": [],
                    "buffer_post_ids": {}
                }
            else:
                # Update storyboard or what_happens if missing
                if storyboard and not existing[clip_id].get("storyboard_path"):
                    existing[clip_id]["storyboard_path"] = storyboard
                if not existing[clip_id].get("what_happens"):
                    existing[clip_id]["what_happens"] = meta.get("vision_qa", {}).get("what_actually_happens", "")

        # Sort descending by creation time / id
        clip_list = sorted(existing.values(), key=lambda x: str(x.get("id")), reverse=True)
        self._save_db(clip_list)

        # Sync any newly discovered clips to Supabase cloud
        for c in clip_list:
            if not c.get("synced_to_supabase"):
                synced = self._sync_to_supabase(c)
                if synced:
                    c["synced_to_supabase"] = True
        self._save_db(clip_list)

        return clip_list

    def _sync_to_supabase(self, clip: Dict[str, Any]) -> bool:
        """Pushes a local clip directly into the Supabase Cloud database so Vercel dashboard sees it immediately."""
        supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        supabase_key = os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
        if not supabase_url or not supabase_key:
            return False

        headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates"
        }

        # Upload to video vault if missing
        video_path = clip.get("video_path")
        if video_path and os.path.exists(video_path) and not clip.get("video_url"):
            try:
                from .video_vault import upload_clip_to_vault
                clip["video_url"] = upload_clip_to_vault(video_path)
            except Exception as e:
                print(f"[ClipStore] Video upload warning: {e}")

        payload = {
            "id": clip["id"],
            "file": clip.get("file", f"{clip['id']}.mp4"),
            "channel": clip.get("channel", "streamer"),
            "hook_title": clip.get("hook_title", "Viral Clip"),
            "caption": clip.get("caption", ""),
            "hashtags": clip.get("hashtags", []),
            "virality_score": float(clip.get("virality_score", 7.0)),
            "reasoning": clip.get("reasoning", ""),
            "duration_seconds": float(clip.get("duration_seconds", 30.0)),
            "what_happens": clip.get("what_happens", ""),
            "status": clip.get("status", "pending"),
            "video_url": clip.get("video_url"),
            "storyboard_path": clip.get("storyboard_path")
        }

        try:
            r = requests.post(f"{supabase_url}/rest/v1/clips", headers=headers, json=payload, timeout=15)
            if r.status_code in [200, 201]:
                print(f"[ClipStore] ☁️ Clip '{clip['id']}' synchronized to Supabase Cloud!")
                return True
        except Exception as e:
            print(f"[ClipStore] Supabase sync warning: {e}")
        return False

    def get_all(self, status: Optional[str] = None) -> List[Dict[str, Any]]:
        self.sync_from_metadata()
        clips = self._load_db()
        if status:
            return [c for c in clips if c.get("status") == status]
        return clips

    def update_clip_status(
        self,
        clip_id: str,
        status: str,
        posted_channels: Optional[List[str]] = None,
        buffer_post_ids: Optional[Dict[str, Any]] = None,
        caption: Optional[str] = None,
        hashtags: Optional[List[str]] = None
    ) -> Optional[Dict[str, Any]]:
        clips = self._load_db()
        target = None
        for c in clips:
            if c.get("id") == clip_id:
                c["status"] = status
                if posted_channels is not None:
                    c["posted_channels"] = posted_channels
                if buffer_post_ids is not None:
                    c.setdefault("buffer_post_ids", {}).update(buffer_post_ids)
                if caption is not None:
                    c["caption"] = caption
                if hashtags is not None:
                    c["hashtags"] = hashtags
                target = c
                break

        if target:
            self._save_db(clips)
        return target
