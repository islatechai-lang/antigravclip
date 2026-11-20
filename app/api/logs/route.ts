import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const backendUrl = process.env.BACKEND_API_URL;
  if (backendUrl && !backendUrl.includes("127.0.0.1") && !backendUrl.includes("localhost")) {
    try {
      const res = await fetch(`${backendUrl}/api/logs`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
    } catch {
      // ignore
    }
  }

  // Fallback: Query live logs from Supabase Cloud Bridge
  try {
    const { data, error } = await supabase
      .from("clips")
      .select("what_happens")
      .eq("id", "sys_worker_logs")
      .maybeSingle();

    if (!error && data?.what_happens) {
      const parsed = JSON.parse(data.what_happens);
      return NextResponse.json({ logs: parsed });
    }
  } catch {}

  return NextResponse.json({ logs: [] });
}

export async function POST(req: Request) {
  const backendUrl = process.env.BACKEND_API_URL;
  if (backendUrl && !backendUrl.includes("127.0.0.1") && !backendUrl.includes("localhost")) {
    try {
      const body = await req.json();
      await fetch(`${backendUrl}/api/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // ignore
    }
  }
  return NextResponse.json({ status: "logged" });
}

export async function DELETE() {
  const backendUrl = process.env.BACKEND_API_URL;
  if (backendUrl && !backendUrl.includes("127.0.0.1") && !backendUrl.includes("localhost")) {
    try {
      await fetch(`${backendUrl}/api/logs`, { method: "DELETE" });
    } catch {
      // ignore
    }
  }

  // Clear Supabase Cloud Bridge logs as well
  try {
    await supabase
      .from("clips")
      .upsert({
        id: "sys_worker_logs",
        file: "logs.json",
        what_happens: JSON.stringify([]),
        status: "cleared",
        caption: new Date().toISOString()
      });
  } catch (err) {
    console.warn("Error clearing Supabase logs:", err);
  }

  return NextResponse.json({ status: "cleared" });
}
