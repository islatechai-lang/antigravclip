import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { supabase } from "@/lib/supabase";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { clipId } = body;

    if (!clipId) {
      return NextResponse.json({ error: "Missing clipId" }, { status: 400 });
    }

    const dataPath = path.join(process.cwd(), "data", "clips.json");
    if (fs.existsSync(dataPath)) {
      try {
        const raw = fs.readFileSync(dataPath, "utf-8");
        const clips = JSON.parse(raw);
        const target = clips.find((c: any) => c.id === clipId);
        if (target) {
          target.status = "declined";
          target.declined_at = new Date().toISOString();
          fs.writeFileSync(dataPath, JSON.stringify(clips, null, 2), "utf-8");
        }
      } catch {
        // Read-only filesystem on Vercel serverless
      }
    }

    try {
      await supabase
        .from("clips")
        .update({
          status: "declined",
          declined_at: new Date().toISOString()
        })
        .eq("id", clipId);
    } catch (e) {
      console.warn("Supabase decline skipped:", e);
    }

    return NextResponse.json({ success: true, clipId, status: "declined" });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
