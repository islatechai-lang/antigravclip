import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import clipsFallback from "@/data/clips.json";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    let clips: any[] = [];
    let supabaseLoaded = false;

    // 1. Try querying Supabase Database
    try {
      const { data, error } = await supabase
        .from("clips")
        .select("*")
        .order("virality_score", { ascending: false });

      if (!error && Array.isArray(data)) {
        supabaseLoaded = true;
        // Supabase is active: filter out deleted, test, and system rows
        clips = data.filter((c: any) => 
          c.status !== "deleted" && 
          !c.id.startsWith("test_") && 
          !c.id.startsWith("sys_")
        );
      }
    } catch (e) {
      console.warn("Supabase query fallback to local/bundled clips:", e);
    }

    // 2. ONLY fallback to local data/clips.json if Supabase connection failed entirely
    if (!supabaseLoaded) {
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
      clips = (clips || []).filter((c: any) => c.status !== "deleted" && !c.id.startsWith("test_") && !c.id.startsWith("sys_"));
    }

    // Ensure every clip has a valid public video_url for cloud playback & Buffer
    clips = clips.map((c: any) => {
      if (!c.video_url || c.video_url.startsWith("output") || c.video_url.includes("\\") || !c.video_url.endsWith(".mp4")) {
        const file = (c.file && c.file.endsWith(".mp4")) ? c.file : `${c.id}.mp4`;
        c.video_url = `https://github.com/islatechai-lang/antigravclip/releases/download/v1-clips/${file}`;
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
    return NextResponse.json({ clips: [], stats: { total: 0, pending: 0, posted: 0, declined: 0, avgVirality: "0.0" } });
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const clipId = url.searchParams.get("id");
    const all = url.searchParams.get("all") === "true";

    if (all) {
      await supabase.from("clips").update({ status: "deleted" }).not("id", "like", "sys_%");
      await supabase.from("clips").delete().not("id", "like", "sys_%");
      return NextResponse.json({ success: true, count: 0, clips: [] });
    }

    if (clipId) {
      await supabase.from("clips").update({ status: "deleted" }).eq("id", clipId);
      await supabase.from("clips").delete().eq("id", clipId);
      return NextResponse.json({ success: true, deletedCount: 1 });
    }

    return NextResponse.json({ error: "No clip id or all flag provided" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
