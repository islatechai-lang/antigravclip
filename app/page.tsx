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
  ExternalLink,
  SlidersHorizontal,
  AlertCircle
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
  video_url?: string;
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
  const [sortBy, setSortBy] = useState<"score" | "newest">("score"); // High score on top by default
  const [loading, setLoading] = useState<boolean>(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  // Per-clip editing state
  const [editCaptions, setEditCaptions] = useState<Record<string, string>>({});
  const [editHashtags, setEditHashtags] = useState<Record<string, string[]>>({});
  const [newTagInput, setNewTagInput] = useState<Record<string, string>>({});
  const [selectedChannels, setSelectedChannels] = useState<Record<string, string[]>>({});

  const availableChannels = [
    { id: "6aff36d6ece6dfde5f223b82", name: "antigravclip", platform: "TikTok", icon: "🎵" },
    { id: "6aff37d0ece6dfde5f224463", name: "Chatguru A.I", platform: "YouTube Shorts", icon: "▶️" },
    { id: "6aff398dece6dfde5f226a6a", name: "AntigravClips", platform: "Facebook Reels", icon: "📘" }
  ];

  const fetchClips = async () => {
    try {
      const res = await fetch("/api/clips");
      if (res.ok) {
        const data = await res.json();
        setClips(data.clips || []);
        setStats(data.stats || { total: 0, pending: 0, posted: 0, declined: 0, avgVirality: "0.0" });

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
    const interval = setInterval(fetchClips, 20000);
    return () => clearInterval(interval);
  }, []);

  const showToast = (type: "success" | "error" | "info", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 5500);
  };

  const handleApprove = async (clipId: string) => {
    setActionInProgress(clipId);
    showToast("info", "Uploading video to public cloud vault & sending to Buffer...");

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

      const resData = await res.json();

      if (res.ok && resData.success) {
        // Update local state
        setClips(prev => prev.map(c => c.id === clipId ? { ...c, status: "posted", video_url: resData.videoUrl } : c));
        setStats(prev => ({ ...prev, pending: Math.max(0, prev.pending - 1), posted: prev.posted + 1 }));
        showToast("success", "🎉 Successfully posted & scheduled on your Buffer channels!");
      } else {
        const errMsg = resData.error || "Buffer rejected the post request.";
        showToast("error", `❌ Buffer Error: ${errMsg}`);
      }
    } catch (err: any) {
      showToast("error", `❌ Network Error: ${err.message}`);
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
        showToast("info", "Clip declined and archived.");
      }
    } catch (err) {
      showToast("error", "Failed to decline clip.");
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

  // Filter clips by tab
  const tabFiltered = clips.filter(c => {
    if (activeTab === "all") return true;
    if (activeTab === "pending") return c.status === "pending";
    if (activeTab === "posted") return c.status === "posted" || c.status === "approved";
    if (activeTab === "declined") return c.status === "declined";
    return true;
  });

  // Sort clips: High score on top by default
  const sortedClips = [...tabFiltered].sort((a, b) => {
    if (sortBy === "score") {
      return (b.virality_score || 0) - (a.virality_score || 0);
    } else {
      return (b.created_at || "").localeCompare(a.created_at || "");
    }
  });

  return (
    <div className="min-h-screen bg-[#070a10] text-slate-100 pb-24 font-sans">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl backdrop-blur-md border text-sm font-semibold transition-all duration-300 animate-slide-up ${
          toast.type === "success" 
            ? "bg-emerald-950/90 text-emerald-200 border-emerald-500/40 shadow-emerald-950/50" 
            : toast.type === "error"
            ? "bg-red-950/90 text-red-200 border-red-500/40 shadow-red-950/50"
            : "bg-purple-950/90 text-purple-200 border-purple-500/40 shadow-purple-950/50"
        }`}>
          {toast.type === "success" ? <CheckCircle className="w-5 h-5 text-emerald-400" /> : toast.type === "error" ? <AlertCircle className="w-5 h-5 text-red-400" /> : <RefreshCw className="w-5 h-5 text-purple-400 animate-spin" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Top Header */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#0b0f19]/90 border-b border-slate-800/80 px-8 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-pink-500 flex items-center justify-center font-black text-2xl shadow-xl shadow-purple-600/30">
              ⚡
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-black tracking-tight text-white">AntigravClip Studio</h1>
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Live Clipper Active
                </span>
              </div>
              <p className="text-xs text-slate-400 font-medium">Autonomous AI Director • Social Approval & Buffer Queue</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchClips}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-slate-700/80 transition shadow-sm"
            >
              <RefreshCw className="w-3.5 h-3.5 text-purple-400" />
              Refresh
            </button>
            <a
              href="https://publish.buffer.com"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-purple-600/30 to-pink-600/30 hover:from-purple-600/40 hover:to-pink-600/40 text-purple-200 border border-purple-500/40 shadow-sm transition"
            >
              Buffer Queue <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="max-w-7xl mx-auto px-8 pt-8">
        {/* KPI Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-[#0f1422] border border-slate-800/80 rounded-2xl p-5 shadow-lg shadow-black/40">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Pending Review</span>
              <Clock className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-3xl font-black text-amber-400">{stats.pending}</div>
            <div className="text-xs text-slate-500 mt-1">Ready for your approval</div>
          </div>

          <div className="bg-[#0f1422] border border-slate-800/80 rounded-2xl p-5 shadow-lg shadow-black/40">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Posted / Scheduled</span>
              <CheckCircle className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-3xl font-black text-emerald-400">{stats.posted}</div>
            <div className="text-xs text-slate-500 mt-1">Live in Buffer Queue</div>
          </div>

          <div className="bg-[#0f1422] border border-slate-800/80 rounded-2xl p-5 shadow-lg shadow-black/40">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Avg Virality</span>
              <Flame className="w-4 h-4 text-orange-400" />
            </div>
            <div className="text-3xl font-black text-orange-400">{stats.avgVirality} <span className="text-lg font-bold text-slate-600">/ 10</span></div>
            <div className="text-xs text-slate-500 mt-1">Multimodal Vision QA Filter</div>
          </div>

          <div className="bg-[#0f1422] border border-slate-800/80 rounded-2xl p-5 shadow-lg shadow-black/40">
            <div className="flex items-center justify-between text-slate-400 mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Total Captured</span>
              <Tv className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-3xl font-black text-white">{stats.total}</div>
            <div className="text-xs text-slate-500 mt-1">9:16 Shorts Generated</div>
          </div>
        </div>

        {/* Tab & Sorting Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/90 pb-4 mb-8">
          {/* Tabs */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab("pending")}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                activeTab === "pending"
                  ? "bg-amber-400/15 text-amber-300 border border-amber-400/30 shadow-md shadow-amber-400/10"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              Pending Approval
              {stats.pending > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[11px] bg-amber-400 text-black font-black">
                  {stats.pending}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab("posted")}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                activeTab === "posted"
                  ? "bg-emerald-400/15 text-emerald-300 border border-emerald-400/30 shadow-md shadow-emerald-400/10"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              Approved & Posted
              <span className="px-2 py-0.5 rounded-full text-[11px] bg-emerald-400/20 text-emerald-300 font-bold">
                {stats.posted}
              </span>
            </button>

            <button
              onClick={() => setActiveTab("declined")}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                activeTab === "declined"
                  ? "bg-red-400/15 text-red-300 border border-red-400/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              Declined ({stats.declined})
            </button>

            <button
              onClick={() => setActiveTab("all")}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                activeTab === "all"
                  ? "bg-purple-400/15 text-purple-300 border border-purple-400/30"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              All Clips ({stats.total})
            </button>
          </div>

          {/* Sort Control */}
          <div className="flex items-center gap-2 bg-[#0d121e] border border-slate-800 rounded-xl p-1 text-xs">
            <span className="text-slate-400 px-2 font-medium">Sort By:</span>
            <button
              onClick={() => setSortBy("score")}
              className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 ${
                sortBy === "score"
                  ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/20"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Flame className="w-3.5 h-3.5" /> Highest Score First
            </button>
            <button
              onClick={() => setSortBy("newest")}
              className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 ${
                sortBy === "newest"
                  ? "bg-slate-700 text-white shadow"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Clock className="w-3.5 h-3.5" /> Newest First
            </button>
          </div>
        </div>

        {/* Feed List */}
        {loading ? (
          <div className="text-center py-24 text-slate-500">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-purple-400" />
            Loading high-score viral clips...
          </div>
        ) : sortedClips.length === 0 ? (
          <div className="text-center py-20 bg-[#0f1422] border border-slate-800 rounded-3xl p-12">
            <div className="text-5xl mb-4">🎬</div>
            <h3 className="text-xl font-bold text-white mb-2">No clips in this view</h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              {activeTab === "pending"
                ? "All set! New high-virality clips will appear here automatically as the stream buffer records."
                : "No clips match the selected filter."}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {sortedClips.map((clip, index) => {
              const channels = selectedChannels[clip.id] || [];
              const tags = editHashtags[clip.id] || [];

              return (
                <div
                  key={clip.id}
                  className="bg-[#0f1422] border border-slate-800/90 rounded-2xl overflow-hidden shadow-2xl shadow-black/50 hover:border-slate-700/80 transition-all duration-200"
                >
                  <div className="flex flex-col lg:flex-row items-stretch">
                    {/* Compact 9:16 Video Player Container */}
                    <div className="lg:w-[260px] flex-shrink-0 bg-black relative flex items-center justify-center p-3 border-b lg:border-b-0 lg:border-r border-slate-800/80">
                      <div className="relative w-full aspect-[9/16] bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-inner group">
                        {/* Prominent Virality Score Badge on Top-Right Corner */}
                        <div className="absolute top-2.5 right-2.5 z-20 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-black bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-500 text-slate-950 shadow-xl shadow-orange-500/40 border border-yellow-300/40">
                          <Flame className="w-3.5 h-3.5 fill-slate-950" />
                          <span>{clip.virality_score.toFixed(1)}/10</span>
                        </div>

                        {/* Top-Left Rank Badge */}
                        <div className="absolute top-2.5 left-2.5 z-20 px-2 py-0.5 rounded-md text-[10px] font-black bg-black/70 text-slate-300 backdrop-blur-sm border border-white/10">
                          #{index + 1}
                        </div>

                        <video
                          src={`/api/video/${clip.id}`}
                          controls
                          playsInline
                          preload="metadata"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>

                    {/* Right Side: Metadata, Captions, Hashtags & Post Actions */}
                    <div className="flex-1 p-6 flex flex-col justify-between">
                      <div>
                        {/* Title Bar & Status Pill */}
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                          <h2 className="text-xl font-black text-white leading-tight">
                            {clip.hook_title}
                          </h2>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400 font-medium">
                              ⏱️ {clip.duration_seconds.toFixed(1)}s
                            </span>
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider ${
                                clip.status === "posted"
                                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                                  : clip.status === "declined"
                                  ? "bg-red-500/20 text-red-400 border border-red-500/40"
                                  : "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                              }`}
                            >
                              {clip.status === "posted" ? "Posted" : clip.status}
                            </span>
                          </div>
                        </div>

                        {/* Multimodal Vision QA Breakdown */}
                        <div className="bg-[#090d16] border border-slate-800/90 rounded-xl p-3.5 mb-4">
                          <div className="flex items-center gap-2 text-xs font-extrabold text-purple-400 uppercase tracking-wider mb-1">
                            <Sparkles className="w-3.5 h-3.5" />
                            Vision QA Analysis: What Happens
                          </div>
                          <p className="text-xs text-slate-300 leading-relaxed font-medium mb-1.5">
                            {clip.what_happens}
                          </p>
                          {clip.reasoning && (
                            <p className="text-xs text-slate-400 italic">
                              "{clip.reasoning}"
                            </p>
                          )}
                        </div>

                        {/* Social Caption Editor */}
                        <div className="mb-4">
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                            Social Media Caption
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
                            className="w-full bg-[#090d16] border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-purple-500 transition leading-relaxed font-medium"
                            placeholder="Enter custom caption..."
                          />
                        </div>

                        {/* Interactive Hashtags */}
                        <div className="mb-4">
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                            Hashtags
                          </label>
                          <div className="flex flex-wrap items-center gap-1.5 mb-2">
                            {tags.map((tag) => (
                              <span
                                key={tag}
                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-600/15 text-purple-300 border border-purple-500/30 group"
                              >
                                {tag}
                                <button
                                  type="button"
                                  onClick={() => removeTag(clip.id, tag)}
                                  className="text-slate-500 hover:text-red-400 ml-1 font-bold"
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
                              className="flex-1 bg-[#090d16] border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                            />
                            <button
                              type="button"
                              onClick={() => addTag(clip.id)}
                              className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
                            >
                              Add
                            </button>
                          </div>
                        </div>

                        {/* Channel Toggles */}
                        <div className="mb-5">
                          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                            Target Social Channels
                          </label>
                          <div className="flex flex-wrap gap-2">
                            {availableChannels.map((ch) => {
                              const isSelected = channels.includes(ch.id);
                              return (
                                <button
                                  key={ch.id}
                                  type="button"
                                  onClick={() => toggleChannel(clip.id, ch.id)}
                                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition ${
                                    isSelected
                                      ? "bg-purple-600/20 border-purple-500 text-purple-200 shadow-sm shadow-purple-600/20"
                                      : "bg-[#090d16] border-slate-800/80 text-slate-500 hover:text-slate-300"
                                  }`}
                                >
                                  <span>{ch.icon}</span>
                                  <span>{ch.platform}</span>
                                  <span className="text-[10px] text-slate-500 font-normal">(@{ch.name})</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Footer Actions */}
                      <div className="flex items-center justify-between pt-4 border-t border-slate-800/80">
                        <div className="text-xs text-slate-500">
                          {clip.created_at ? `Captured: ${clip.created_at}` : "Fresh Stream Clip"}
                        </div>

                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            disabled={actionInProgress === clip.id}
                            onClick={() => handleDecline(clip.id)}
                            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-red-400 bg-slate-800/40 hover:bg-red-500/10 border border-slate-700/60 transition disabled:opacity-50"
                          >
                            <XCircle className="w-4 h-4" />
                            Decline
                          </button>

                          <button
                            type="button"
                            disabled={actionInProgress === clip.id || clip.status === "posted"}
                            onClick={() => handleApprove(clip.id)}
                            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black text-white bg-gradient-to-r from-purple-600 via-indigo-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 shadow-lg shadow-purple-600/30 transition disabled:opacity-50 disabled:shadow-none"
                          >
                            {actionInProgress === clip.id ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Send className="w-4 h-4" />
                            )}
                            {clip.status === "posted" ? "Posted to Buffer" : "Approve & Post to Buffer"}
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
