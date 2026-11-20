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
      // 1. Mark ALL non-system clips as deleted in Supabase
      try {
        await supabase
          .from("clips")
          .update({ status: "deleted" })
          .not("id", "like", "sys_%");
      } catch (e) {
        console.warn("Supabase soft delete all error:", e);
      }

      // 2. Also attempt hard delete in Supabase
      try {
        await supabase
          .from("clips")
          .delete()
          .not("id", "like", "sys_%");
      } catch (e) {
        console.warn("Supabase hard delete all error:", e);
      }

      // 3. Clear local clips if writable
      try {
        fs.writeFileSync(dataPath, JSON.stringify([], null, 2), "utf-8");
      } catch {
        // Read-only filesystem on Vercel serverless
      }

      // 4. Signal local backend engine via sys_worker_control to wipe local cache & metadata
      try {
        await supabase
          .from("clips")
          .update({ status: "clear_all" })
          .eq("id", "sys_worker_control");
      } catch (e) {
        console.warn("Could not post clear_all command to bridge:", e);
      }

      // 5. Also notify local backend daemon if accessible
      try {
        await fetch("http://localhost:8001/api/clips/all", { method: "DELETE" }).catch(() => {});
      } catch {}

      return NextResponse.json({ success: true, count: 0, clips: [] });
    }

    const idsToDelete: string[] = clipIds || (clipId ? [clipId] : []);
    if (idsToDelete.length === 0) {
      return NextResponse.json({ error: "No clip IDs specified" }, { status: 400 });
    }

    // 1. Soft delete in Supabase (status: "deleted")
    try {
      await supabase
        .from("clips")
        .update({ status: "deleted" })
        .in("id", idsToDelete);
    } catch (e) {
      console.warn("Supabase soft delete error:", e);
    }

    // 2. Also hard delete in Supabase
    try {
      await supabase
        .from("clips")
        .delete()
        .in("id", idsToDelete);
    } catch (e) {
      console.warn("Supabase delete error:", e);
    }

    // 3. Filter out deleted clips locally if writable
    clips = clips.filter((c) => !idsToDelete.includes(c.id));
    try {
      fs.writeFileSync(dataPath, JSON.stringify(clips, null, 2), "utf-8");
    } catch {
      // Read-only filesystem on Vercel serverless
    }

    // 4. Also notify local backend daemon
    for (const id of idsToDelete) {
      try {
        await fetch(`http://localhost:8001/api/clips/${id}`, { method: "DELETE" }).catch(() => {});
      } catch {}
    }

    return NextResponse.json({ success: true, deletedCount: idsToDelete.length, clips });
  } catch (error: any) {
    console.error("Delete error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
