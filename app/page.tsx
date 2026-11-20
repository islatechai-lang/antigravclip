"use client";

import React, { useState, useEffect } from "react";
import { 
  Play, 
  CheckCircle, 
  XCircle, 
  Share2, 
  Flame, 
  Clock, 
  Tv, 
  Tag, 
  RefreshCw,
  Send,
  Eye,
  Sparkles,
  ExternalLink
} from "lucide-react";

interface ClipItem {
  id: string;
  file: string;
  channel: string;
  hook_title: string;
  caption: string;
  hashtags: string[];
  virality_score: number;
  reasoning: string;
  duration_seconds: number;
  what_happens: string;
  storyboard_path?: string;
  status: "pending" | "approved" | "posted" | "declined";
  created_at?: string;
  posted_channels?: string[];
}

interface Stats {
  total: number;
  pending: number;
  posted: number;
  declined: number;
  avgVirality: string;
}

export default function Dashboard() {
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, pending: 0, posted: 0, declined: 0, avgVirality: "0.0" });
  const [activeTab, setActiveTab] = useState<"pending" | "posted" | "declined" | "all">("pending");
  const [loading, setLoading] = useState<boolean>(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Per-clip editing state
  const [editCaptions, setEditCaptions] = useState<Record<string, string>>({});
  const [editHashtags, setEditHashtags] = useState<Record<string, string[]>>({});
  const [newTagInput, setNewTagInput] = useState<Record<string, string>>({});
  const [selectedChannels, setSelectedChannels] = useState<Record<string, string[]>>({});

  const availableChannels = [
    { id: "6aff36d6ece6dfde5f223b82", name: "antigravclip", platform: "TikTok" },
    { id: "6aff37d0ece6dfde5f224463", name: "Chatguru A.I", platform: "YouTube Shorts" },
    { id: "6aff398dece6dfde5f226a6a", name: "AntigravClips", platform: "Facebook" }
  ];

  const fetchClips = async () => {
    try {
      const res = await fetch("/api/clips");
      if (res.ok) {
        const data = await res.json();
        setClips(data.clips || []);
        setStats(data.stats || { total: 0, pending: 0, posted: 0, declined: 0, avgVirality: "0.0" });

        // Initialize edit states
        const initialCaptions: Record<string, string> = {};
        const initialTags: Record<string, string[]> = {};
        const initialChans: Record<string, string[]> = {};

        (data.clips || []).forEach((c: ClipItem) => {
          initialCaptions[c.id] = c.caption;
          initialTags[c.id] = c.hashtags || ["#gta6", "#ishowspeed", "#gaming", "#shorts", "#viral", "#fyp"];
          initialChans[c.id] = availableChannels.map(ch => ch.id);
        });

        setEditCaptions(initialCaptions);
        setEditHashtags(initialTags);
        setSelectedChannels(initialChans);
      }
    } catch (err) {
      console.error("Error fetching clips:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClips();
    const interval = setInterval(fetchClips, 15000); // Poll every 15s for fresh clips
    return () => clearInterval(interval);
  }, []);

  const handleApprove = async (clipId: string) => {
    setActionInProgress(clipId);
    try {
      const res = await fetch("/api/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clipId,
          caption: editCaptions[clipId],
          hashtags: editHashtags[clipId],
          channelIds: selectedChannels[clipId]
        })
      });

      if (res.ok) {
        // Update local status
        setClips(prev => prev.map(c => c.id === clipId ? { ...c, status: "posted" } : c));
        setStats(prev => ({ ...prev, pending: Math.max(0, prev.pending - 1), posted: prev.posted + 1 }));
      }
    } catch (err) {
      console.error("Failed to approve:", err);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDecline = async (clipId: string) => {
    setActionInProgress(clipId);
    try {
      const res = await fetch("/api/decline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipId })
      });

      if (res.ok) {
        setClips(prev => prev.map(c => c.id === clipId ? { ...c, status: "declined" } : c));
        setStats(prev => ({ ...prev, pending: Math.max(0, prev.pending - 1), declined: prev.declined + 1 }));
      }
    } catch (err) {
      console.error("Failed to decline:", err);
    } finally {
      setActionInProgress(null);
    }
  };

  const toggleChannel = (clipId: string, channelId: string) => {
    setSelectedChannels(prev => {
      const current = prev[clipId] || [];
      if (current.includes(channelId)) {
        return { ...prev, [clipId]: current.filter(id => id !== channelId) };
      } else {
        return { ...prev, [clipId]: [...current, channelId] };
      }
    });
  };

  const removeTag = (clipId: string, tagToRemove: string) => {
    setEditHashtags(prev => ({
      ...prev,
      [clipId]: (prev[clipId] || []).filter(t => t !== tagToRemove)
    }));
  };

  const addTag = (clipId: string) => {
    const val = (newTagInput[clipId] || "").trim();
    if (!val) return;
    const formatted = val.startsWith("#") ? val : `#${val}`;
    setEditHashtags(prev => {
      const cur = prev[clipId] || [];
      if (cur.includes(formatted)) return prev;
      return { ...prev, [clipId]: [...cur, formatted] };
    });
    setNewTagInput(prev => ({ ...prev, [clipId]: "" }));
  };

  const filteredClips = clips.filter(c => {
    if (activeTab === "all") return true;
    if (activeTab === "pending") return c.status === "pending";
    if (activeTab === "posted") return c.status === "posted" || c.status === "approved";
    if (activeTab === "declined") return c.status === "declined";
    return true;
  });

  return (
    <div className="min-h-screen bg-[#0a0d14] text-slate-100 pb-20">
      {/* Top Navbar */}
      <header className="sticky top-0 z-50 backdrop-blur-md bg-[#0e1320]/80 border-b border-slate-800/80 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-pink-500 flex items-center justify-center font-black text-xl shadow-lg shadow-purple-500/20">
              ⚡
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white">AntigravClip Studio</h1>
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Live Engine Active
                </span>
              </div>
              <p className="text-xs text-slate-400">Autonomous Stream Clipper • Review & Post to Buffer</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={fetchClips}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-700 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
            <a
              href="https://publish.buffer.com"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 transition"
            >
              Open Buffer <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-6 pt-8">
        {/* KPI Stats Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-[#121826] border border-slate-800/80 rounded-2xl p-5 shadow-lg shadow-black/40">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Pending Review</span>
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-3xl font-extrabold text-amber-400">{stats.pending}</div>
            <div className="text-xs text-slate-500 mt-1">Awaiting your approval</div>
          </div>

          <div className="bg-[#121826] border border-slate-800/80 rounded-2xl p-5 shadow-lg shadow-black/40">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Posted / Queued</span>
              <CheckCircle className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-3xl font-extrabold text-emerald-400">{stats.posted}</div>
            <div className="text-xs text-slate-500 mt-1">Sent to TikTok & YouTube</div>
          </div>

          <div className="bg-[#121826] border border-slate-800/80 rounded-2xl p-5 shadow-lg shadow-black/40">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Avg Virality</span>
              <Flame className="w-4 h-4 text-orange-400" />
            </div>
            <div className="text-3xl font-extrabold text-orange-400">{stats.avgVirality} <span className="text-lg font-semibold text-slate-500">/10</span></div>
            <div className="text-xs text-slate-500 mt-1">AI Director & Vision QA</div>
          </div>

          <div className="bg-[#121826] border border-slate-800/80 rounded-2xl p-5 shadow-lg shadow-black/40">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Total Captured</span>
              <Tv className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-3xl font-extrabold text-slate-100">{stats.total}</div>
            <div className="text-xs text-slate-500 mt-1">9:16 vertical shorts rendered</div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center justify-between border-b border-slate-800 mb-8">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab("pending")}
              className={`pb-3 px-4 text-sm font-semibold border-b-2 transition flex items-center gap-2 ${
                activeTab === "pending"
                  ? "border-amber-400 text-amber-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              Pending Approval
              {stats.pending > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs bg-amber-400/10 text-amber-400 border border-amber-400/20 font-bold">
                  {stats.pending}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("posted")}
              className={`pb-3 px-4 text-sm font-semibold border-b-2 transition flex items-center gap-2 ${
                activeTab === "posted"
                  ? "border-emerald-400 text-emerald-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              Approved & Posted
              <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-400/10 text-emerald-400 border border-emerald-400/20 font-bold">
                {stats.posted}
              </span>
            </button>
            <button
              onClick={() => setActiveTab("declined")}
              className={`pb-3 px-4 text-sm font-semibold border-b-2 transition ${
                activeTab === "declined"
                  ? "border-red-400 text-red-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              Declined ({stats.declined})
            </button>
            <button
              onClick={() => setActiveTab("all")}
              className={`pb-3 px-4 text-sm font-semibold border-b-2 transition ${
                activeTab === "all"
                  ? "border-purple-400 text-purple-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              All Clips ({stats.total})
            </button>
          </div>
        </div>

        {/* Clip Feed */}
        {loading ? (
          <div className="text-center py-20 text-slate-500">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-purple-400" />
            Loading clips database...
          </div>
        ) : filteredClips.length === 0 ? (
          <div className="text-center py-20 bg-[#121826] border border-slate-800 rounded-2xl p-10">
            <div className="text-4xl mb-3">🎬</div>
            <h3 className="text-lg font-bold text-white mb-1">No clips in this view</h3>
            <p className="text-sm text-slate-400">
              {activeTab === "pending"
                ? "All caught up! New clips will appear automatically as the live stream progresses."
                : "No clips match this filter."}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {filteredClips.map((clip) => {
              const channels = selectedChannels[clip.id] || [];
              const tags = editHashtags[clip.id] || [];

              return (
                <div
                  key={clip.id}
                  className="bg-[#121826] border border-slate-800/90 rounded-2xl overflow-hidden shadow-xl shadow-black/50 transition hover:border-slate-700"
                >
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6">
                    {/* Left Column: 9:16 Video Player Preview */}
                    <div className="lg:col-span-4 flex flex-col items-center">
                      <div className="relative w-full max-w-[280px] aspect-[9/16] bg-black rounded-xl overflow-hidden border border-slate-800 shadow-2xl">
                        <video
                          src={`/api/video/${clip.id}`}
                          controls
                          playsInline
                          preload="metadata"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="w-full max-w-[280px] flex items-center justify-between text-xs text-slate-400 mt-2 px-1">
                        <span>{clip.duration_seconds.toFixed(1)}s Duration</span>
                        <span>9:16 Vertical</span>
                      </div>
                    </div>

                    {/* Right Column: Metadata, Vision QA & Posting Controls */}
                    <div className="lg:col-span-8 flex flex-col justify-between">
                      <div>
                        {/* Hook Header & Virality Pill */}
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                          <h2 className="text-xl font-extrabold text-white leading-snug">
                            {clip.hook_title}
                          </h2>
                          <div className="flex items-center gap-2">
                            <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-orange-500/10 text-orange-400 border border-orange-500/20">
                              <Flame className="w-3.5 h-3.5" />
                              {clip.virality_score.toFixed(1)} / 10
                            </span>
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                                clip.status === "posted"
                                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                  : clip.status === "declined"
                                  ? "bg-red-500/20 text-red-400 border border-red-500/30"
                                  : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                              }`}
                            >
                              {clip.status}
                            </span>
                          </div>
                        </div>

                        {/* Vision QA Breakdown Card */}
                        <div className="bg-[#0b0e17] border border-slate-800/80 rounded-xl p-3.5 mb-4">
                          <div className="flex items-center gap-2 text-xs font-bold text-purple-400 uppercase tracking-wider mb-1.5">
                            <Sparkles className="w-3.5 h-3.5" />
                            Multimodal Vision QA Verification
                          </div>
                          <p className="text-xs text-slate-300 leading-relaxed mb-2">
                            {clip.what_happens}
                          </p>
                          {clip.reasoning && (
                            <p className="text-xs text-slate-400 italic">
                              "{clip.reasoning}"
                            </p>
                          )}
                        </div>

                        {/* Caption Editor */}
                        <div className="mb-4">
                          <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">
                            Post Caption
                          </label>
                          <textarea
                            value={editCaptions[clip.id] ?? clip.caption}
                            onChange={(e) =>
                              setEditCaptions((prev) => ({
                                ...prev,
                                [clip.id]: e.target.value,
                              }))
                            }
                            rows={2}
                            className="w-full bg-[#0b0e17] border border-slate-800 rounded-lg p-2.5 text-sm text-slate-200 focus:outline-none focus:border-purple-500 transition"
                            placeholder="Enter caption for social media..."
                          />
                        </div>

                        {/* Hashtags Editor */}
                        <div className="mb-4">
                          <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">
                            Hashtags
                          </label>
                          <div className="flex flex-wrap items-center gap-1.5 mb-2">
                            {tags.map((tag) => (
                              <span
                                key={tag}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-purple-500/10 text-purple-300 border border-purple-500/20 group hover:border-red-500/40"
                              >
                                {tag}
                                <button
                                  type="button"
                                  onClick={() => removeTag(clip.id, tag)}
                                  className="text-slate-500 hover:text-red-400 ml-1"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={newTagInput[clip.id] || ""}
                              onChange={(e) =>
                                setNewTagInput((prev) => ({
                                  ...prev,
                                  [clip.id]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  addTag(clip.id);
                                }
                              }}
                              placeholder="Add tag (e.g. #gta6) and press Enter"
                              className="flex-1 bg-[#0b0e17] border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                            />
                            <button
                              type="button"
                              onClick={() => addTag(clip.id)}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
                            >
                              Add
                            </button>
                          </div>
                        </div>

                        {/* Channel Selector */}
                        <div className="mb-6">
                          <label className="block text-xs font-semibold uppercase text-slate-400 mb-1.5">
                            Publish To Connected Channels
                          </label>
                          <div className="flex flex-wrap gap-2">
                            {availableChannels.map((ch) => {
                              const isSelected = channels.includes(ch.id);
                              return (
                                <button
                                  key={ch.id}
                                  type="button"
                                  onClick={() => toggleChannel(clip.id, ch.id)}
                                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                                    isSelected
                                      ? "bg-purple-600/20 border-purple-500 text-purple-200 shadow-sm shadow-purple-500/20"
                                      : "bg-[#0b0e17] border-slate-800 text-slate-400 hover:text-slate-200"
                                  }`}
                                >
                                  <div
                                    className={`w-2 h-2 rounded-full ${
                                      isSelected ? "bg-purple-400" : "bg-slate-600"
                                    }`}
                                  />
                                  <span>{ch.platform}</span>
                                  <span className="text-[10px] text-slate-500">(@{ch.name})</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Approval Action Footer */}
                      <div className="flex items-center justify-between pt-4 border-t border-slate-800/80">
                        <div className="text-xs text-slate-500">
                          {clip.created_at ? `Created: ${clip.created_at}` : "Fresh clip"}
                        </div>

                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            disabled={actionInProgress === clip.id}
                            onClick={() => handleDecline(clip.id)}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-red-400 bg-slate-800/40 hover:bg-red-500/10 border border-slate-700/60 transition disabled:opacity-50"
                          >
                            <XCircle className="w-4 h-4" />
                            Decline
                          </button>

                          <button
                            type="button"
                            disabled={actionInProgress === clip.id || clip.status === "posted"}
                            onClick={() => handleApprove(clip.id)}
                            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 shadow-lg shadow-purple-500/25 transition disabled:opacity-50 disabled:shadow-none"
                          >
                            {actionInProgress === clip.id ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                            {clip.status === "posted" ? "Posted to Buffer" : "Approve & Post"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
