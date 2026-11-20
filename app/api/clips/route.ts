import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import clipsFallback from "@/data/clips.json";
import fs from "fs";
import path from "path";

export async function GET() {
  try {
    let clips: any[] = [];

    // 1. Try querying Supabase Database
    try {
      const { data, error } = await supabase
        .from("clips")
        .select("*")
        .neq("status", "deleted")
        .order("virality_score", { ascending: false });

      if (!error && data) {
        clips = data.filter((c: any) => c.status !== "deleted" && !c.id.startsWith("test_"));
      }
    } catch (e) {
      console.warn("Supabase query fallback to local/bundled clips:", e);
    }

    // 2. Fallback to local data/clips.json if Supabase is empty or table not created yet
    if (clips.length === 0) {
      const dataPath = path.join(process.cwd(), "data", "clips.json");
      if (fs.existsSync(dataPath)) {
        try {
          const raw = fs.readFileSync(dataPath, "utf-8");
          clips = JSON.parse(raw);
        } catch {
          clips = clipsFallback as any[];
        }
      } else {
        clips = clipsFallback as any[];
      }
      clips = (clips || []).filter((c: any) => c.status !== "deleted" && !c.id.startsWith("test_"));
    }

    // Ensure every clip has a valid public video_url for cloud playback & Buffer
    clips = clips.map((c: any) => {
      if (!c.video_url || c.video_url.startsWith("output") || c.video_url.includes("\\")) {
        c.video_url = `https://github.com/islatechai-lang/antigravclip/releases/download/v1-clips/${c.file}`;
      }
      return c;
    });

    const stats = {
      total: clips.length,
      pending: clips.filter((c: any) => c.status === "pending").length,
      posted: clips.filter((c: any) => c.status === "posted" || c.status === "approved").length,
      declined: clips.filter((c: any) => c.status === "declined").length,
      avgVirality: clips.length
        ? (clips.reduce((acc: number, c: any) => acc + (c.virality_score || 0), 0) / clips.length).toFixed(1)
        : "0.0",
    };

    return NextResponse.json({ clips, stats });
  } catch (error: any) {
    console.error("Failed to load clips:", error);
    return NextResponse.json({ clips: clipsFallback, stats: { total: clipsFallback.length, pending: clipsFallback.length, posted: 0, declined: 0, avgVirality: "8.5" } });
  }
}
