import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AntigravClip Studio • AI Stream Clipper & Social Approver",
  description: "Autonomous live stream clipper with AI Director, Multimodal Vision QA, and one-click Buffer social publisher.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#0a0d14] text-slate-100 antialiased selection:bg-purple-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
