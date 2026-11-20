import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  const backendUrl = process.env.BACKEND_API_URL;
  if (backendUrl && !backendUrl.includes("127.0.0.1") && !backendUrl.includes("localhost")) {
    try {
      const res = await fetch(`${backendUrl}/api/status`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
    } catch {
      // fallback to Supabase
    }
  }

  // Supabase Cloud Bridge fallback
  try {
    const { data, error } = await supabase
      .from("clips")
      .select("*")
      .eq("id", "sys_worker_control")
      .maybeSingle();

    if (!error && data) {
      return NextResponse.json({
        is_running: data.status === "running" || data.status === "start",
        channel: data.channel || "ishowspeed",
        platform: data.hook_title || "twitch",
        last_updated: data.caption
      });
    }
  } catch (err: any) {
    console.warn("Supabase worker status check:", err);
  }

  return NextResponse.json({ is_running: false, channel: "ishowspeed", platform: "twitch" });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = body.action || "start"; // "start" or "stop"
    const channel = (body.channel || "ishowspeed").trim().replace(/^[@#]/, "");
    const platform = body.platform || "twitch";

    // 1. Try local/direct backend URL if configured
    const backendUrl = process.env.BACKEND_API_URL;
    if (backendUrl && !backendUrl.includes("127.0.0.1") && !backendUrl.includes("localhost")) {
      try {
        const endpoint = action === "stop" ? `${backendUrl}/api/stop` : `${backendUrl}/api/start`;
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel, platform })
        });
        if (res.ok) {
          const data = await res.json();
          return NextResponse.json(data);
        }
      } catch {
        // Fallback to Supabase bridge
      }
    }

    // 2. Post command to Supabase Cloud Bridge
    try {
      const { error } = await supabase
        .from("clips")
        .upsert({
          id: "sys_worker_control",
          file: "control.json",
          channel,
          hook_title: platform,
          status: action === "stop" ? "stop" : "start",
          caption: new Date().toISOString(),
          virality_score: 0.0,
          duration_seconds: 0.0
        });

      if (!error) {
        return NextResponse.json({
          status: action === "stop" ? "stopped" : "started",
          channel,
          platform
        });
      }
    } catch (e: any) {
      console.warn("Supabase bridge error:", e);
    }

    return NextResponse.json({
      status: action === "stop" ? "stopped" : "started",
      channel,
      platform
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
