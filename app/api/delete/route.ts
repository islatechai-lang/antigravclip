import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import fs from "fs";
import path from "path";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { clipId, clipIds, all } = body;

    const dataPath = path.join(process.cwd(), "data", "clips.json");
    let clips: any[] = [];
    if (fs.existsSync(dataPath)) {
      try {
        clips = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
      } catch {
        clips = [];
      }
    }

    if (all) {
      // Clear all clips
      clips = [];
      try {
        fs.writeFileSync(dataPath, JSON.stringify([], null, 2), "utf-8");
      } catch {
        // Read-only filesystem on Vercel serverless
      }

      // Delete from Supabase
      try {
        await supabase.from("clips").delete().neq("id", "none");
      } catch (e) {
        console.warn("Supabase delete all error:", e);
      }

      return NextResponse.json({ success: true, count: 0, clips: [] });
    }

    const idsToDelete: string[] = clipIds || (clipId ? [clipId] : []);
    if (idsToDelete.length === 0) {
      return NextResponse.json({ error: "No clip IDs specified" }, { status: 400 });
    }

    // Filter out deleted clips
    clips = clips.filter((c) => !idsToDelete.includes(c.id));
    try {
      fs.writeFileSync(dataPath, JSON.stringify(clips, null, 2), "utf-8");
    } catch {
      // Read-only filesystem on Vercel serverless
    }

    // Delete from Supabase
    try {
      await supabase.from("clips").delete().in("id", idsToDelete);
    } catch (e) {
      console.warn("Supabase delete error:", e);
    }

    return NextResponse.json({ success: true, deletedCount: idsToDelete.length, clips });
  } catch (error: any) {
    console.error("Delete error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
