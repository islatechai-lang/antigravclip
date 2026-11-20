import { NextResponse } from "next/server";

export async function GET() {
  const token = process.env.BUFFER_API_TOKEN;
  const orgId = process.env.BUFFER_ORG_ID || "6aff3390741beb0c722bd52e";

  const fallbackChannels = [
    { id: "6aff36d6ece6dfde5f223b82", name: "antigravclip", service: "tiktok" },
    { id: "6aff37d0ece6dfde5f224463", name: "Chatguru A.I", service: "youtube" },
    { id: "6aff398dece6dfde5f226a6a", name: "AntigravClips", service: "facebook" },
  ];

  try {
    const q = `
      query GetChannels($input: ChannelsInput!) {
        channels(input: $input) {
          id
          name
          service
        }
      }
    `;
    const resp = await fetch("https://api.buffer.com", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "AntigravClip/1.0"
      },
      body: JSON.stringify({
        query: q,
        variables: { input: { organizationId: orgId } }
      }),
      cache: "no-store"
    });

    if (resp.ok) {
      const data = await resp.json();
      const channels = data?.data?.channels || fallbackChannels;
      return NextResponse.json({ channels });
    }
    return NextResponse.json({ channels: fallbackChannels });
  } catch (err) {
    return NextResponse.json({ channels: fallbackChannels });
  }
}
