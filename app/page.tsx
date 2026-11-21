"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  Play, 
  Pause,
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
  AlertCircle,
  Radio,
  Zap,
  Square,
  CheckSquare,
  Trash2,
  Grid,
  List,
  Folder,
  X,
  Terminal,
  Activity,
  Copy,
  Check,
  ChevronRight,
  Maximize2,
  Minimize2,
  RotateCcw
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
  storyboard_url?: string;
  status: "pending" | "approved" | "posted" | "declined";
  created_at?: string;
  posted_channels?: string[];
  video_url?: string;
}

interface LogEntry {
  id: string;
  time: string;
  message: string;
  source: string;
  level: "info" | "success" | "warning" | "error";
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
  const [viewMode, setViewMode] = useState<"grid" | "feed">("feed"); // Detailed feed default
  const [loading, setLoading] = useState<boolean>(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  // Sequential Approval Queue
  const [approvingClipIds, setApprovingClipIds] = useState<string[]>([]);
  const approvalQueueRef = useRef<string[]>([]);
  const isProcessingQueueRef = useRef<boolean>(false);

  // Multi-select and modal preview state
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [activePreviewClip, setActivePreviewClip] = useState<ClipItem | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState<boolean>(false);

  // Live Terminal Logs State
  const [showLogsPanel, setShowLogsPanel] = useState<boolean>(true);
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: "init_1", time: "LIVE", message: "[System] Monitoring console initialized. Ready for stream events.", source: "System", level: "info" }
  ]);
  const [autoScroll, setAutoScroll] = useState<boolean>(false); // Disabled by default
  const [copiedLogs, setCopiedLogs] = useState<boolean>(false);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const isWorkerInitRef = useRef<boolean>(false);
  const clearedTimestampRef = useRef<number>(0);

  // Cloud Worker Controller State
  const [workerStatus, setWorkerStatus] = useState<{
    is_running: boolean;
    channel: string;
    platform: string;
    uptime_seconds?: number;
  }>({
    is_running: false,
    channel: "ishowspeed",
    platform: "twitch"
  });
  const [streamerHandle, setStreamerHandle] = useState<string>("ishowspeed");
  const [streamerPlatform, setStreamerPlatform] = useState<"twitch" | "youtube">("twitch");
  const [workerLoading, setWorkerLoading] = useState<boolean>(false);

  const popularPresets = [
    { name: "IShowSpeed", channel: "ishowspeed", platform: "twitch" as const, icon: "🟣" },
    { name: "Tarik", channel: "tarik", platform: "twitch" as const, icon: "🟣" },
    { name: "Kai Cenat", channel: "kaicenat", platform: "twitch" as const, icon: "🟣" },
    { name: "Jynxzi", channel: "jynxzi", platform: "twitch" as const, icon: "🟣" },
    { name: "xQc", channel: "xqc", platform: "twitch" as const, icon: "🟣" },
  ];

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

  const logAction = async (message: string, level: "info" | "success" | "warning" | "error" = "info", source: string = "UI") => {
    try {
      await fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, level, source })
      });
      fetchLogs();
    } catch {
      // Local fallback
      const now = new Date().toTimeString().split(" ")[0];
      setLogs(prev => [...prev, { id: `${Date.now()}`, time: now, message, source, level }].slice(-250));
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch("/api/logs");
      if (res.ok) {
        const data = await res.json();
        if (data.logs && Array.isArray(data.logs)) {
          const minTs = clearedTimestampRef.current;
          const freshLogs = minTs > 0 
            ? data.logs.filter((l: LogEntry) => {
                const parts = l.id.split("_");
                const ts = parseFloat(parts[0]);
                return isNaN(ts) || ts >= minTs;
              })
            : data.logs;

          if (freshLogs.length > 0) {
            setLogs(freshLogs);
          } else if (minTs > 0) {
            setLogs([{
              id: `clear_${minTs}`,
              time: new Date(minTs * 1000).toTimeString().split(" ")[0],
              message: "[Console] Logs cleared. Waiting for new stream events...",
              source: "Console",
              level: "info"
            }]);
          }
        }
      }
    } catch {
      // ignore
    }
  };

  const clearLogs = async () => {
    clearedTimestampRef.current = Date.now() / 1000;
    setLogs([{ 
      id: `clear_${Date.now()}`, 
      time: new Date().toTimeString().split(" ")[0], 
      message: "[Console] Logs cleared.", 
      source: "Console", 
      level: "info" 
    }]);
    try {
      await fetch("/api/logs", { method: "DELETE" });
    } catch {
      // ignore
    }
  };

  const copyAllLogs = () => {
    const raw = logs.map(l => `[${l.time}] [${l.source}] ${l.message}`).join("\n");
    navigator.clipboard.writeText(raw);
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 2000);
  };

  const fetchClips = async () => {
    try {
      const res = await fetch("/api/clips");
      if (res.ok) {
        const data = await res.json();
        setClips(data.clips || []);
        setStats(data.stats || { total: 0, pending: 0, posted: 0, declined: 0, avgVirality: "0.0" });

        // Retrieve user's channel defaults from localStorage if present
        let defaultChans = availableChannels.map(ch => ch.id);
        try {
          const saved = localStorage.getItem("antigrav_default_channels");
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) defaultChans = parsed;
          }
        } catch {}

        setEditCaptions(prev => {
          const next = { ...prev };
          (data.clips || []).forEach((c: ClipItem) => {
            if (next[c.id] === undefined) next[c.id] = c.caption;
          });
          return next;
        });

        setEditHashtags(prev => {
          const next = { ...prev };
          (data.clips || []).forEach((c: ClipItem) => {
            if (next[c.id] === undefined) next[c.id] = c.hashtags || ["#gta6", "#gaming", "#shorts", "#viral", "#fyp"];
          });
          return next;
        });

        setSelectedChannels(prev => {
          const next = { ...prev };
          (data.clips || []).forEach((c: ClipItem) => {
            if (next[c.id] === undefined) next[c.id] = defaultChans;
          });
          return next;
        });
      }
    } catch (err) {
      console.error("Error fetching clips:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkerStatus = async () => {
    try {
      const res = await fetch("/api/worker");
      if (res.ok) {
        const data = await res.json();
        setWorkerStatus(data);
        if (!isWorkerInitRef.current) {
          isWorkerInitRef.current = true;
          if (data.is_running) {
            if (data.channel && data.channel !== "offline") {
              setStreamerHandle(data.channel);
            }
            if (data.platform === "twitch" || data.platform === "youtube") {
              setStreamerPlatform(data.platform);
            }
          }
        }
      }
    } catch (err) {
      // offline fallback
    }
  };

  const handleStartWorker = async (targetChannel?: string, targetPlatform?: "twitch" | "youtube") => {
    const channelToUse = (targetChannel || streamerHandle).trim().replace(/^[@#]/, "");
    const platformToUse = targetPlatform || streamerPlatform;
    if (!channelToUse) {
      showToast("error", "Please enter a streamer channel handle.");
      return;
    }

    setWorkerLoading(true);
    showToast("info", `Connecting autonomous clipper to @${channelToUse} (${platformToUse})...`);
    logAction(`🚀 [UserAction] Started Autonomous Stream Clipper for @${channelToUse} on ${platformToUse.toUpperCase()}`, "info", "UserAction");

    try {
      const res = await fetch("/api/worker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          channel: channelToUse,
          platform: platformToUse
        })
      });
      const data = await res.json();
      if (res.ok) {
        setWorkerStatus({
          is_running: true,
          channel: channelToUse,
          platform: platformToUse
        });
        showToast("success", `🚀 Autonomous clipper is now LIVE on @${channelToUse}!`);
        logAction(`🟢 [Engine] Stream monitor & rolling buffer attached to @${channelToUse}. Listening for chat spikes...`, "success", "Engine");
      } else {
        showToast("error", `Failed to start clipper: ${data.error || "Unknown error"}`);
        logAction(`❌ [Error] Failed to start clipper: ${data.error || "Unknown error"}`, "error", "Engine");
      }
    } catch (err: any) {
      showToast("error", `Worker network error: ${err.message}`);
      logAction(`❌ [NetworkError] Worker connection error: ${err.message}`, "error", "Engine");
    } finally {
      setWorkerLoading(false);
    }
  };

  const handleStopWorker = async () => {
    setWorkerLoading(true);
    showToast("info", "Pausing autonomous stream clipper...");
    logAction(`⏸️ [UserAction] Paused stream clipping worker`, "warning", "UserAction");

    try {
      const res = await fetch("/api/worker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" })
      });
      const data = await res.json();
      if (res.ok) {
        setWorkerStatus(prev => ({ ...prev, is_running: false }));
        showToast("info", "⏸️ Clipper paused. You can resume or switch streamers anytime!");
        logAction(`🛑 [Engine] Buffer recording and chat websocket safely stopped`, "info", "Engine");
      } else {
        showToast("error", `Failed to stop clipper: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      showToast("error", `Worker network error: ${err.message}`);
    } finally {
      setWorkerLoading(false);
    }
  };

  useEffect(() => {
    fetchClips();
    fetchWorkerStatus();
    fetchLogs();

    const interval = setInterval(() => {
      fetchClips();
      fetchWorkerStatus();
      fetchLogs();
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  // Auto-scroll log console
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const showToast = (type: "success" | "error" | "info", message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 5500);
  };

  const processApprovalQueue = async () => {
    if (isProcessingQueueRef.current) return;
    isProcessingQueueRef.current = true;

    while (approvalQueueRef.current.length > 0) {
      const clipId = approvalQueueRef.current[0];
      const targetClip = clips.find(c => c.id === clipId);

      const targetChannels = selectedChannels[clipId] !== undefined ? selectedChannels[clipId] : availableChannels.map(ch => ch.id);
      if (!targetChannels || targetChannels.length === 0) {
        showToast("error", `⚠️ No social channels enabled for "${targetClip?.hook_title || clipId}". Post skipped.`);
        approvalQueueRef.current = approvalQueueRef.current.filter(id => id !== clipId);
        setApprovingClipIds([...approvalQueueRef.current]);
        continue;
      }

      const chanNames = targetChannels
        .map((cid: string) => availableChannels.find(ch => ch.id === cid)?.platform || cid)
        .join(", ");

      showToast("info", `🚀 Uploading & posting "${targetClip?.hook_title || clipId}" to Buffer (${chanNames})...`);
      logAction(`🎯 [Queue] Processing clip "${targetClip?.hook_title || clipId}". Initiating Buffer dispatch for [${chanNames}]...`, "info", "UserAction");

      try {
        const res = await fetch("/api/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clipId,
            caption: editCaptions[clipId],
            hashtags: editHashtags[clipId],
            channelIds: targetChannels
          })
        });

        const resData = await res.json();

        if (res.ok && resData.success) {
          setClips(prev => prev.map(c => c.id === clipId ? { ...c, status: "posted", video_url: resData.videoUrl } : c));
          setStats(prev => ({ ...prev, pending: Math.max(0, prev.pending - 1), posted: prev.posted + 1 }));
          if (activePreviewClip && activePreviewClip.id === clipId) {
            setActivePreviewClip(prev => prev ? { ...prev, status: "posted", video_url: resData.videoUrl } : null);
          }
          const postedNames = (resData.channelsPosted || targetChannels)
            .map((cid: string) => availableChannels.find(ch => ch.id === cid)?.platform || cid)
            .join(", ");
          showToast("success", `🎉 Successfully posted "${targetClip?.hook_title || clipId}" to Buffer (${postedNames})!`);
          logAction(`✅ [Buffer Success] Published "${targetClip?.hook_title || clipId}" to [${postedNames}]!`, "success", "Buffer");
        } else {
          const errMsg = resData.error || "Buffer rejected the post request.";
          showToast("error", `❌ Buffer Error for "${targetClip?.hook_title || clipId}": ${errMsg}`);
          logAction(`❌ [Buffer Error] Failed to publish post: ${errMsg}`, "error", "Buffer");
        }
      } catch (err: any) {
        showToast("error", `❌ Network Error: ${err.message}`);
        logAction(`❌ [Network Error] Buffer API dispatch failed: ${err.message}`, "error", "Buffer");
      }

      // Dequeue finished clip
      approvalQueueRef.current = approvalQueueRef.current.filter(id => id !== clipId);
      setApprovingClipIds([...approvalQueueRef.current]);
    }

    isProcessingQueueRef.current = false;
  };

  const handleApprove = (clipId: string) => {
    const chans = selectedChannels[clipId] !== undefined ? selectedChannels[clipId] : availableChannels.map(ch => ch.id);
    if (!chans || chans.length === 0) {
      showToast("error", "⚠️ Please enable at least one target social channel before approving.");
      return;
    }

    if (approvalQueueRef.current.includes(clipId)) {
      showToast("info", "Clip is already in the approval queue!");
      return;
    }

    approvalQueueRef.current.push(clipId);
    setApprovingClipIds([...approvalQueueRef.current]);
    const queuePos = approvalQueueRef.current.length;
    if (queuePos > 1) {
      showToast("info", `⏳ Added to approval queue (Position #${queuePos}). It will post right after the current one!`);
    }
    processApprovalQueue();
  };

  const handleApproveSelected = () => {
    const pendingSelected = selectedClipIds.filter(id => {
      const clip = clips.find(c => c.id === id);
      const chans = selectedChannels[id] !== undefined ? selectedChannels[id] : availableChannels.map(ch => ch.id);
      return clip && clip.status === "pending" && !approvalQueueRef.current.includes(id) && chans.length > 0;
    });

    if (pendingSelected.length === 0) {
      showToast("info", "No pending clips with active channels selected to approve.");
      return;
    }

    for (const id of pendingSelected) {
      approvalQueueRef.current.push(id);
    }
    setApprovingClipIds([...approvalQueueRef.current]);
    showToast("info", `🚀 Queued ${pendingSelected.length} clip(s) for sequential approval & posting!`);
    processApprovalQueue();
  };

  const handleDecline = async (clipId: string) => {
    const targetClip = clips.find(c => c.id === clipId);
    setActionInProgress(clipId);
    logAction(`🚫 [UserAction] Declined clip "${targetClip?.hook_title || clipId}". Archiving...`, "warning", "UserAction");

    try {
      const res = await fetch("/api/decline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipId })
      });

      if (res.ok) {
        setClips(prev => prev.map(c => c.id === clipId ? { ...c, status: "declined" } : c));
        setStats(prev => ({ ...prev, pending: Math.max(0, prev.pending - 1), declined: prev.declined + 1 }));
        if (activePreviewClip && activePreviewClip.id === clipId) {
          setActivePreviewClip(prev => prev ? { ...prev, status: "declined" } : null);
        }
        showToast("info", "Clip declined and archived.");
        logAction(`🗑️ [Decline] Clip marked as declined`, "info", "UserAction");
      }
    } catch (err) {
      showToast("error", "Failed to decline clip.");
    } finally {
      setActionInProgress(null);
    }
  };

  // Delete handlers
  const handleDeleteSingle = async (clipId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const targetClip = clips.find(c => c.id === clipId);
    setActionInProgress(clipId);
    logAction(`🗑️ [UserAction] Deleting clip "${targetClip?.hook_title || clipId}"...`, "warning", "UserAction");

    try {
      const res = await fetch("/api/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipId })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setClips(prev => prev.filter(c => c.id !== clipId));
        setSelectedClipIds(prev => prev.filter(id => id !== clipId));
        if (activePreviewClip?.id === clipId) setActivePreviewClip(null);
        showToast("info", "🗑️ Clip deleted.");
        logAction(`✅ [Delete] Clip permanently removed from database`, "info", "UserAction");
      } else {
        showToast("error", `Failed to delete: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      showToast("error", `Delete error: ${err.message}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedClipIds.length === 0) return;
    setActionInProgress("delete-batch");
    showToast("info", `Deleting ${selectedClipIds.length} clip(s)...`);
    logAction(`🗑️ [UserAction] Batch deleting ${selectedClipIds.length} selected clip(s)...`, "warning", "UserAction");

    try {
      const res = await fetch("/api/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clipIds: selectedClipIds })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setClips(prev => prev.filter(c => !selectedClipIds.includes(c.id)));
        setStats(prev => {
          const remaining = clips.filter(c => !selectedClipIds.includes(c.id));
          return {
            total: remaining.length,
            pending: remaining.filter(c => c.status === "pending").length,
            posted: remaining.filter(c => c.status === "posted" || c.status === "approved").length,
            declined: remaining.filter(c => c.status === "declined").length,
            avgVirality: remaining.length ? (remaining.reduce((a, b) => a + (b.virality_score || 0), 0) / remaining.length).toFixed(1) : "0.0"
          };
        });
        setSelectedClipIds([]);
        if (activePreviewClip && selectedClipIds.includes(activePreviewClip.id)) {
          setActivePreviewClip(null);
        }
        showToast("success", `🗑️ Successfully deleted ${data.deletedCount || selectedClipIds.length} clip(s)!`);
        logAction(`✅ [Batch Delete] Deleted ${data.deletedCount || selectedClipIds.length} items cleanly`, "success", "UserAction");
      } else {
        showToast("error", `Failed to delete: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      showToast("error", `Delete network error: ${err.message}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDeleteAll = async () => {
    setActionInProgress("delete-all");
    showToast("info", "Clearing all clips and resetting database...");
    logAction(`⚠️ [UserAction] Clearing entire clip database for fresh reset...`, "warning", "UserAction");

    try {
      const res = await fetch("/api/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setClips([]);
        setSelectedClipIds([]);
        setActivePreviewClip(null);
        setStats({ total: 0, pending: 0, posted: 0, declined: 0, avgVirality: "0.0" });
        setConfirmDeleteAll(false);
        showToast("success", "✨ All clips deleted. Clean slate ready!");
        logAction(`✨ [Clean Slate] Database reset to 0 clips. Ready for new stream runs!`, "success", "UserAction");
      } else {
        showToast("error", `Failed to delete all: ${data.error || "Unknown error"}`);
      }
    } catch (err: any) {
      showToast("error", `Delete error: ${err.message}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const toggleSelectClip = (clipId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedClipIds(prev => 
      prev.includes(clipId) ? prev.filter(id => id !== clipId) : [...prev, clipId]
    );
  };

  const handleSelectAll = () => {
    if (selectedClipIds.length === sortedClips.length && sortedClips.length > 0) {
      setSelectedClipIds([]);
    } else {
      setSelectedClipIds(sortedClips.map(c => c.id));
    }
  };

  const toggleChannel = (clipId: string, channelId: string) => {
    setSelectedChannels(prev => {
      const current = prev[clipId] !== undefined ? prev[clipId] : availableChannels.map(ch => ch.id);
      let updated: string[];
      if (current.includes(channelId)) {
        updated = current.filter(id => id !== channelId);
      } else {
        updated = [...current, channelId];
      }

      try {
        localStorage.setItem("antigrav_default_channels", JSON.stringify(updated));
      } catch {}

      return { ...prev, [clipId]: updated };
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
    if ((c as any).status === "deleted") return false;
    if (c.id.startsWith("test_")) return false;
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

      {/* Fullscreen Video Preview Modal */}
      {activePreviewClip && (
        <div 
          onClick={() => setActivePreviewClip(null)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-6"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-[#0f1422] border border-slate-800 rounded-3xl max-w-4xl w-full overflow-hidden shadow-2xl shadow-black/80 flex flex-col md:flex-row max-h-[90vh]"
          >
            {/* Left: 9:16 Video Player */}
            <div className="md:w-[340px] bg-black flex-shrink-0 flex items-center justify-center p-4 border-b md:border-b-0 md:border-r border-slate-800 relative">
              <div className="relative w-full aspect-[9/16] bg-slate-950 rounded-2xl overflow-hidden border border-slate-800">
                <div className="absolute top-3 right-3 z-20 flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black bg-gradient-to-r from-orange-500 to-amber-500 text-slate-950 shadow-lg">
                  <Flame className="w-3.5 h-3.5 fill-slate-950" />
                  <span>{activePreviewClip.virality_score.toFixed(1)}/10</span>
                </div>
                <video
                  src={`/api/video/${activePreviewClip.id}`}
                  controls
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            {/* Right: Details, Caption, Actions */}
            <div className="flex-1 p-6 flex flex-col justify-between overflow-y-auto">
              <div>
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-purple-400">
                      Channel: @{activePreviewClip.channel} • ⏱️ {activePreviewClip.duration_seconds.toFixed(0)}s
                    </span>
                    <h3 className="text-xl font-black text-white mt-1 leading-snug">
                      {activePreviewClip.hook_title}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActivePreviewClip(null)}
                    className="p-2 rounded-xl text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-700 transition"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Vision QA Box */}
                <div className="bg-[#090d16] border border-slate-800/80 rounded-xl p-3.5 mb-4">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-purple-400 uppercase tracking-wider mb-1">
                    <Sparkles className="w-3.5 h-3.5" />
                    Vision QA: What Actually Happens
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed font-medium">
                    {activePreviewClip.what_happens}
                  </p>
                  {activePreviewClip.reasoning && (
                    <p className="text-xs text-slate-400 italic mt-1">
                      "{activePreviewClip.reasoning}"
                    </p>
                  )}
                </div>

                {/* Caption display */}
                <div className="mb-4">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                    Caption
                  </label>
                  <p className="text-xs text-slate-300 bg-[#090d16] border border-slate-800 rounded-xl p-3 font-medium">
                    {editCaptions[activePreviewClip.id] || activePreviewClip.caption}
                  </p>
                </div>

                {/* Hashtags display */}
                <div className="mb-4">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                    Hashtags
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {(editHashtags[activePreviewClip.id] || activePreviewClip.hashtags || []).map(tag => (
                      <span key={tag} className="px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-600/20 text-purple-300 border border-purple-500/30">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Target Social Channels Toggles in Modal */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                      Target Social Channels
                    </label>
                    <span className="text-[11px] text-slate-500 font-medium">
                      {(selectedChannels[activePreviewClip.id] !== undefined ? selectedChannels[activePreviewClip.id] : availableChannels.map(ch => ch.id)).length} of {availableChannels.length} active
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {availableChannels.map((ch) => {
                      const modalChannels = selectedChannels[activePreviewClip.id] !== undefined
                        ? selectedChannels[activePreviewClip.id]
                        : availableChannels.map(c => c.id);
                      const isSelected = modalChannels.includes(ch.id);
                      return (
                        <button
                          key={ch.id}
                          type="button"
                          onClick={() => toggleChannel(activePreviewClip.id, ch.id)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                            isSelected
                              ? "bg-purple-600/25 border-purple-400 text-purple-200 shadow-sm shadow-purple-600/20"
                              : "bg-[#090d16] border-slate-800 text-slate-500 hover:text-slate-300 opacity-60 hover:opacity-100"
                          }`}
                        >
                          <span className="text-sm">{ch.icon}</span>
                          <span>{ch.platform}</span>
                          <span className="text-[10px] text-slate-500 font-normal">(@{ch.name})</span>
                          {isSelected ? (
                            <span className="ml-1 text-[9px] font-black uppercase tracking-wider bg-purple-500/30 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/40">
                              ACTIVE
                            </span>
                          ) : (
                            <span className="ml-1 text-[9px] font-bold uppercase tracking-wider bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded border border-slate-700">
                              MUTED
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Action Buttons in Modal */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-800/80 mt-4">
                <button
                  type="button"
                  onClick={() => handleDeleteSingle(activePreviewClip.id)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-red-400 hover:bg-red-500/10 border border-slate-800 hover:border-red-500/30 transition"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Clip
                </button>

                <div className="flex items-center gap-3">
                  {activePreviewClip.status === "pending" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => handleDecline(activePreviewClip.id)}
                        className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold text-slate-400 hover:text-red-400 bg-slate-800/40 hover:bg-red-500/10 border border-slate-700/60 transition"
                      >
                        <XCircle className="w-4 h-4" />
                        Decline
                      </button>

                      <button
                        type="button"
                        disabled={approvingClipIds.includes(activePreviewClip.id)}
                        onClick={() => handleApprove(activePreviewClip.id)}
                        className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black text-white bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 shadow-lg shadow-purple-600/30 transition disabled:opacity-60"
                      >
                        {approvingClipIds[0] === activePreviewClip.id ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin text-purple-200" />
                            Posting to Buffer...
                          </>
                        ) : approvingClipIds.includes(activePreviewClip.id) ? (
                          <>
                            <Clock className="w-4 h-4 animate-pulse text-amber-300" />
                            In Queue (#{approvingClipIds.indexOf(activePreviewClip.id) + 1})
                          </>
                        ) : (
                          <>
                            <Send className="w-4 h-4" />
                            Approve & Post
                          </>
                        )}
                      </button>
                    </>
                  ) : activePreviewClip.status === "posted" ? (
                    <span className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                      Published in Buffer Queue
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black bg-red-500/20 text-red-300 border border-red-500/40">
                      <XCircle className="w-4 h-4 text-red-400" />
                      Declined & Archived
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top Header */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#0b0f19]/90 border-b border-slate-800/80 px-8 py-4">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-pink-500 flex items-center justify-center font-black text-2xl shadow-xl shadow-purple-600/30">
              ⚡
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-black tracking-tight text-white">AntigravClip Studio</h1>
                <span className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${
                  workerStatus.is_running 
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25" 
                    : "bg-slate-800 text-slate-400 border-slate-700"
                }`}>
                  <span className={`w-2 h-2 rounded-full ${workerStatus.is_running ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
                  {workerStatus.is_running ? "Live Clipper Active" : "Clipper Idle"}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-medium">Autonomous AI Director • Social Approval & Buffer Queue</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Toggle Terminal Logs Panel Button */}
            <button
              onClick={() => setShowLogsPanel(!showLogsPanel)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition ${
                showLogsPanel
                  ? "bg-purple-600/20 border-purple-500 text-purple-200 shadow-sm"
                  : "bg-slate-800/80 hover:bg-slate-700 border-slate-700 text-slate-300"
              }`}
            >
              <Terminal className="w-4 h-4 text-purple-400" />
              <span>Live Console</span>
              <span className={`w-2 h-2 rounded-full ${workerStatus.is_running ? "bg-emerald-400 animate-ping" : "bg-purple-400"}`} />
            </button>

            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>LIVE SYNC</span>
            </div>
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

      {/* Main Body (Split layout when Logs Panel is visible) */}
      <main className="max-w-[1600px] mx-auto px-8 pt-8">
        <div className="flex flex-col xl:flex-row gap-8 items-start">
          
          {/* Main Left Workspace */}
          <div className="flex-1 min-w-0 w-full">
            {/* Streamer Target & Cloud Worker Console */}
            <div className="bg-[#0f1422] border border-slate-800/90 rounded-2xl p-5 mb-8 shadow-xl shadow-black/40">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
                    <Radio className={`w-5 h-5 ${workerStatus.is_running ? "animate-pulse text-emerald-400" : "text-slate-500"}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-black text-white">Live Clipper Streamer Control</h2>
                      {workerStatus.is_running ? (
                        <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                          MONITORING: @{workerStatus.channel} ({workerStatus.platform?.toUpperCase()})
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          <span className="w-2 h-2 rounded-full bg-amber-400" />
                          STANDBY / PAUSED
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 font-medium">
                      Paste any Twitch or YouTube handle to switch active live clipping dynamically in the cloud.
                    </p>
                  </div>
                </div>

                {/* Quick Presets */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mr-1">Presets:</span>
                  {popularPresets.map(preset => (
                    <button
                      key={preset.channel}
                      type="button"
                      onClick={() => {
                        setStreamerHandle(preset.channel);
                        setStreamerPlatform(preset.platform);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition flex items-center gap-1.5 ${
                        streamerHandle.toLowerCase() === preset.channel.toLowerCase() && streamerPlatform === preset.platform
                          ? "bg-purple-600/30 border-purple-500 text-purple-200 shadow-sm"
                          : "bg-[#090d16] border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                      }`}
                    >
                      <span>{preset.icon}</span>
                      <span>{preset.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Input & Action Bar */}
              <div className="flex flex-col sm:flex-row items-center gap-3 pt-4">
                {/* Platform selector */}
                <div className="flex items-center bg-[#090d16] border border-slate-800 rounded-xl p-1 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => setStreamerPlatform("twitch")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition flex-1 sm:flex-initial ${
                      streamerPlatform === "twitch"
                        ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    🟣 Twitch
                  </button>
                  <button
                    type="button"
                    onClick={() => setStreamerPlatform("youtube")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition flex-1 sm:flex-initial ${
                      streamerPlatform === "youtube"
                        ? "bg-red-600 text-white shadow-md shadow-red-600/30"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    🔴 YouTube
                  </button>
                </div>

                {/* Handle input */}
                <div className="relative flex-1 w-full">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-xs">@</span>
                  <input
                    type="text"
                    value={streamerHandle}
                    onChange={(e) => setStreamerHandle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleStartWorker(streamerHandle, streamerPlatform);
                      }
                    }}
                    placeholder="Enter streamer handle (e.g. tarik, kaicenat, ishowspeed, jynxzi)..."
                    className="w-full bg-[#090d16] border border-slate-800 rounded-xl pl-8 pr-4 py-2.5 text-xs text-white focus:outline-none focus:border-purple-500 font-medium tracking-wide placeholder-slate-600"
                  />
                </div>

                {/* Start / Update Button */}
                <button
                  type="button"
                  disabled={workerLoading}
                  onClick={() => handleStartWorker(streamerHandle, streamerPlatform)}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 shadow-lg shadow-purple-600/25 transition disabled:opacity-50"
                >
                  {workerLoading ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-white" />
                  )}
                  {workerStatus.is_running && workerStatus.channel.toLowerCase() === streamerHandle.trim().toLowerCase() && workerStatus.platform === streamerPlatform
                    ? "Restart Clipper"
                    : workerStatus.is_running
                    ? "Switch Streamer"
                    : "Start Autonomous Clipper"}
                </button>

                {/* Pause / Stop Button */}
                {workerStatus.is_running && (
                  <button
                    type="button"
                    disabled={workerLoading}
                    onClick={handleStopWorker}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 transition disabled:opacity-50"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    Pause
                  </button>
                )}
              </div>
            </div>

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
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/90 pb-4 mb-6">
              {/* Tabs */}
              <div className="flex items-center gap-2 flex-wrap">
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
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 ${
                    activeTab === "all"
                      ? "bg-purple-600/20 text-purple-300 border border-purple-500/40 shadow-md shadow-purple-600/10"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                  }`}
                >
                  <Folder className="w-3.5 h-3.5" />
                  All Clips ({stats.total})
                </button>
              </div>

              {/* Right Controls: View Toggle (Grid / Feed) + Sort */}
              <div className="flex items-center gap-3">
                {/* View Mode Toggle */}
                <div className="flex items-center bg-[#0d121e] border border-slate-800 rounded-xl p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setViewMode("grid")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition ${
                      viewMode === "grid"
                        ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                    title="Windows Folder Media Grid"
                  >
                    <Grid className="w-3.5 h-3.5" /> Folder Grid
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("feed")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition ${
                      viewMode === "feed"
                        ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                    title="Detailed Review Feed"
                  >
                    <List className="w-3.5 h-3.5" /> Detailed Feed
                  </button>
                </div>

                {/* Sort Control */}
                <div className="flex items-center gap-2 bg-[#0d121e] border border-slate-800 rounded-xl p-1 text-xs">
                  <button
                    onClick={() => setSortBy("score")}
                    className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 ${
                      sortBy === "score"
                        ? "bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/20"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Flame className="w-3.5 h-3.5" /> Top Score
                  </button>
                  <button
                    onClick={() => setSortBy("newest")}
                    className={`px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 ${
                      sortBy === "newest"
                        ? "bg-slate-700 text-white shadow"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" /> Newest
                  </button>
                </div>
              </div>
            </div>

            {/* Batch Operations Bar (Select All / Delete Selected / Clear All) */}
            {sortedClips.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0a0e18] border border-slate-800/80 rounded-2xl px-5 py-3 mb-6 shadow-md">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="flex items-center gap-2 text-xs font-bold text-slate-300 hover:text-white transition px-2.5 py-1.5 rounded-lg hover:bg-slate-800/60"
                  >
                    {selectedClipIds.length === sortedClips.length && sortedClips.length > 0 ? (
                      <CheckSquare className="w-4 h-4 text-purple-400" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-500" />
                    )}
                    <span>Select All ({sortedClips.length})</span>
                  </button>

                  {selectedClipIds.length > 0 && (
                    <span className="text-xs text-purple-400 font-bold bg-purple-500/10 px-2.5 py-1 rounded-lg border border-purple-500/20">
                      {selectedClipIds.length} item(s) selected
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2.5">
                  {selectedClipIds.length > 0 && (
                    <>
                      {selectedClipIds.filter(id => clips.find(c => c.id === id)?.status === "pending").length > 0 && (
                        <button
                          type="button"
                          onClick={handleApproveSelected}
                          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black text-white bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 shadow-md shadow-purple-600/20 transition"
                        >
                          <Send className="w-3.5 h-3.5" />
                          Approve Selected ({selectedClipIds.filter(id => clips.find(c => c.id === id)?.status === "pending").length})
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={handleDeleteSelected}
                        disabled={actionInProgress === "delete-batch"}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold text-red-300 bg-red-600/20 hover:bg-red-600/30 border border-red-500/40 transition disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete Selected ({selectedClipIds.length})
                      </button>
                    </>
                  )}

                  {/* Clear All Clips Button */}
                  {confirmDeleteAll ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-red-400 font-bold">Delete ALL clips permanently?</span>
                      <button
                        type="button"
                        onClick={handleDeleteAll}
                        disabled={actionInProgress === "delete-all"}
                        className="px-3 py-1 rounded-lg text-xs font-black text-white bg-red-600 hover:bg-red-500 shadow-md transition"
                      >
                        Confirm Delete All
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteAll(false)}
                        className="px-2.5 py-1 rounded-lg text-xs font-bold text-slate-400 hover:text-white bg-slate-800 transition"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteAll(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-400 hover:text-red-400 hover:bg-slate-800 border border-slate-800 hover:border-red-500/30 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Clear All Clips
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Feed List or Folder Grid */}
            {loading ? (
              <div className="text-center py-24 text-slate-500">
                <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-purple-400" />
                Loading clips...
              </div>
            ) : sortedClips.length === 0 ? (
              <div className="text-center py-20 bg-[#0f1422] border border-slate-800 rounded-3xl p-12">
                {workerStatus.is_running ? (
                  <>
                    <div className="relative inline-block mb-4">
                      <div className="w-16 h-16 rounded-2xl bg-purple-600/20 border border-purple-500/40 flex items-center justify-center text-3xl mx-auto">
                        <Radio className="w-8 h-8 text-emerald-400 animate-pulse" />
                      </div>
                      <span className="absolute -top-1 -right-1 flex h-4 w-4">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500"></span>
                      </span>
                    </div>
                    <h3 className="text-xl font-black text-white mb-2">
                      Live Autonomous Clipper is Active!
                    </h3>
                    <p className="text-sm text-slate-400 max-w-lg mx-auto mb-6 leading-relaxed">
                      Actively monitoring <span className="text-purple-400 font-bold">@{workerStatus.channel}</span> ({workerStatus.platform?.toUpperCase()}). 
                      The AI Director is listening for chat velocity spikes, transcribing gameplay, and composing 9:16 vertical clips. Newly generated clips will appear right here automatically!
                    </p>
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                      Continuous buffer recording active • Watch real-time events in the Live Console →
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-5xl mb-4">🎬</div>
                    <h3 className="text-xl font-bold text-white mb-2">No clips right now</h3>
                    <p className="text-sm text-slate-400 max-w-md mx-auto mb-6">
                      Clean slate! Paste any Twitch or YouTube streamer handle above and click &quot;Start Autonomous Clipper&quot; to begin capturing fresh clips.
                    </p>
                    <button
                      onClick={() => handleStartWorker(streamerHandle, streamerPlatform)}
                      className="px-6 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg shadow-purple-600/30 transition"
                    >
                      Start Clipper for @{streamerHandle}
                    </button>
                  </>
                )}
              </div>
            ) : viewMode === "grid" ? (
              /* WINDOWS FOLDER STYLE MEDIA GRID */
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {sortedClips.map((clip) => {
                  const isSelected = selectedClipIds.includes(clip.id);
                  return (
                    <div
                      key={clip.id}
                      onClick={() => setActivePreviewClip(clip)}
                      className={`group relative bg-[#0e1320] border rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:shadow-2xl hover:shadow-purple-900/30 ${
                        isSelected 
                          ? "border-purple-500 ring-2 ring-purple-500/50 bg-[#141a2c]" 
                          : "border-slate-800/80 hover:border-slate-700"
                      }`}
                    >
                      {/* Checkbox (top-left) */}
                      <button
                        type="button"
                        onClick={(e) => toggleSelectClip(clip.id, e)}
                        className={`absolute top-2.5 left-2.5 z-20 w-6 h-6 rounded-lg flex items-center justify-center transition backdrop-blur-md ${
                          isSelected
                            ? "bg-purple-600 text-white shadow-md shadow-purple-600/50 border border-purple-400"
                            : "bg-black/60 text-slate-400 border border-white/20 opacity-0 group-hover:opacity-100 hover:text-white"
                        }`}
                      >
                        {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                      </button>

                      {/* Virality badge (top-right) */}
                      <div className="absolute top-2.5 right-2.5 z-20 flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-black bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-500 text-slate-950 shadow-lg shadow-orange-500/30">
                        <Flame className="w-3 h-3 fill-slate-950" />
                        <span>{clip.virality_score.toFixed(1)}</span>
                      </div>

                      {/* 9:16 Video Thumbnail Container */}
                      <div className="relative aspect-[9/16] bg-black overflow-hidden flex items-center justify-center">
                        <video
                          src={`/api/video/${clip.id}`}
                          preload="none"
                          poster={clip.storyboard_url || `/api/storyboard/${clip.id}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />

                        {/* Hover Play Overlay */}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <div className="w-12 h-12 rounded-full bg-purple-600/90 text-white flex items-center justify-center shadow-xl shadow-purple-600/50 transform group-hover:scale-110 transition-transform">
                            <Play className="w-6 h-6 fill-white ml-0.5" />
                          </div>
                        </div>

                        {/* Duration Badge (bottom-left) */}
                        <div className="absolute bottom-2 left-2 z-10 px-2 py-0.5 rounded-md text-[10px] font-black bg-black/75 text-slate-300 backdrop-blur-sm border border-white/10">
                          {clip.duration_seconds.toFixed(0)}s
                        </div>
                      </div>

                      {/* Folder Item Card Details */}
                      <div className="p-3 bg-[#0a0e18] border-t border-slate-800/80">
                        <h4 className="text-xs font-bold text-white line-clamp-2 leading-tight mb-2 group-hover:text-purple-300 transition-colors">
                          {clip.hook_title}
                        </h4>

                        <div className="flex items-center justify-between text-[11px]">
                          <span className={`flex items-center gap-1 font-extrabold uppercase tracking-wider text-[10px] ${
                            clip.status === "posted"
                              ? "text-emerald-400"
                              : clip.status === "declined"
                              ? "text-red-400"
                              : "text-amber-400"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              clip.status === "posted" ? "bg-emerald-400" : clip.status === "declined" ? "bg-red-400" : "bg-amber-400"
                            }`} />
                            {clip.status}
                          </span>

                          {/* Quick delete button */}
                          <button
                            type="button"
                            onClick={(e) => handleDeleteSingle(clip.id, e)}
                            className="p-1 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition opacity-0 group-hover:opacity-100"
                            title="Delete clip"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* DETAILED REVIEW FEED VIEW */
              <div className="space-y-6">
                {sortedClips.map((clip, index) => {
                  const channels = selectedChannels[clip.id] !== undefined ? selectedChannels[clip.id] : availableChannels.map(ch => ch.id);
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
                              preload="none"
                              poster={clip.storyboard_url || `/api/storyboard/${clip.id}`}
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
                              <div className="flex items-center justify-between mb-1.5">
                                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                                  Target Social Channels
                                </label>
                                <span className="text-[11px] text-slate-500 font-medium">
                                  {channels.length} of {availableChannels.length} active
                                </span>
                              </div>
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
                                          ? "bg-purple-600/25 border-purple-400 text-purple-200 shadow-sm shadow-purple-600/20"
                                          : "bg-[#090d16] border-slate-800 text-slate-500 hover:text-slate-300 opacity-60 hover:opacity-100"
                                      }`}
                                    >
                                      <span className="text-sm">{ch.icon}</span>
                                      <span>{ch.platform}</span>
                                      <span className="text-[10px] text-slate-500 font-normal">(@{ch.name})</span>
                                      {isSelected ? (
                                        <span className="ml-1 text-[9px] font-black uppercase tracking-wider bg-purple-500/30 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/40">
                                          ACTIVE
                                        </span>
                                      ) : (
                                        <span className="ml-1 text-[9px] font-bold uppercase tracking-wider bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded border border-slate-700">
                                          MUTED
                                        </span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>

                          {/* Footer Actions: STRICT DECLINE LOGIC */}
                          <div className="flex items-center justify-between pt-4 border-t border-slate-800/80">
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <span>{clip.created_at ? `Captured: ${clip.created_at}` : "Fresh Stream Clip"}</span>
                              <button
                                type="button"
                                onClick={(e) => handleDeleteSingle(clip.id, e)}
                                className="p-1 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition ml-2"
                                title="Delete clip"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <div className="flex items-center gap-3">
                              {/* ONLY show Decline on PENDING clips! */}
                              {clip.status === "pending" && (
                                <>
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
                                    disabled={approvingClipIds.includes(clip.id)}
                                    onClick={() => handleApprove(clip.id)}
                                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black text-white bg-gradient-to-r from-purple-600 via-indigo-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 shadow-lg shadow-purple-600/30 transition disabled:opacity-75 disabled:shadow-none"
                                  >
                                    {approvingClipIds[0] === clip.id ? (
                                      <>
                                        <RefreshCw className="w-4 h-4 animate-spin text-purple-200" />
                                        Posting to Buffer...
                                      </>
                                    ) : approvingClipIds.includes(clip.id) ? (
                                      <>
                                        <Clock className="w-4 h-4 animate-pulse text-amber-300" />
                                        In Queue (#{approvingClipIds.indexOf(clip.id) + 1})
                                      </>
                                    ) : (
                                      <>
                                        <Send className="w-4 h-4" />
                                        Approve & Post to Buffer
                                      </>
                                    )}
                                  </button>
                                </>
                              )}

                              {/* When POSTED: Show success badge, NO decline button! */}
                              {clip.status === "posted" && (
                                <span className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                                  Published in Buffer Queue
                                </span>
                              )}

                              {/* When DECLINED: Show declined badge, NO approve button */}
                              {clip.status === "declined" && (
                                <span className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black bg-red-500/20 text-red-300 border border-red-500/40">
                                  <XCircle className="w-4 h-4 text-red-400" />
                                  Declined & Archived
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Live Stream Monitoring & Event Logs Console */}
          {showLogsPanel && (
            <div className="w-full xl:w-[440px] flex-shrink-0 sticky top-24 self-start bg-[#060912] border border-slate-800/90 rounded-3xl overflow-hidden shadow-2xl shadow-black/80 flex flex-col h-[calc(100vh-140px)]">
              {/* Terminal Header */}
              <div className="bg-[#0b0f1a] px-4 py-3.5 border-b border-slate-800/90 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
                    <Terminal className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs font-black text-white tracking-wide">Live Stream Console</h3>
                      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                        <span className={`w-1.5 h-1.5 rounded-full ${workerStatus.is_running ? "bg-emerald-400 animate-ping" : "bg-slate-500"}`} />
                        {workerStatus.is_running ? "STREAMING" : "IDLE"}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 font-medium">Real-time MPS, Vision QA & Buffer actions</p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={copyAllLogs}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition"
                    title="Copy all logs"
                  >
                    {copiedLogs ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={clearLogs}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-purple-400 hover:bg-slate-800/60 transition"
                    title="Reset & Clear Console"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowLogsPanel(false)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition"
                    title="Hide terminal panel"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Terminal Logs Stream Body */}
              <div className="flex-1 p-3.5 overflow-y-auto font-mono text-[11px] leading-relaxed space-y-1.5 bg-[#050811] select-text">
                {logs.length === 0 ? (
                  <div className="text-slate-600 text-center py-12 italic">
                    Console connected. Waiting for stream events...
                  </div>
                ) : (
                  logs.map((log, idx) => {
                    const isError = log.level === "error";
                    const isWarn = log.level === "warning";
                    const isSuccess = log.level === "success";

                    return (
                      <div 
                        key={log.id || idx} 
                        className={`flex items-start gap-2 py-0.5 rounded px-1.5 transition-colors ${
                          isError 
                            ? "bg-red-950/30 text-red-300" 
                            : isWarn 
                            ? "bg-amber-950/20 text-amber-200" 
                            : isSuccess 
                            ? "bg-emerald-950/20 text-emerald-300" 
                            : "hover:bg-slate-900/60 text-slate-300"
                        }`}
                      >
                        <span className="text-slate-600 flex-shrink-0 text-[10px] select-none pt-0.5">{log.time}</span>
                        
                        <span className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider flex-shrink-0 select-none ${
                          log.source === "ChatMonitor"
                            ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/25"
                            : log.source === "StreamBuffer"
                            ? "bg-blue-500/15 text-blue-400 border border-blue-500/25"
                            : log.source === "AIDirector" || log.source === "VisionQA"
                            ? "bg-purple-500/15 text-purple-400 border border-purple-500/25"
                            : log.source === "Buffer"
                            ? "bg-pink-500/15 text-pink-400 border border-pink-500/25"
                            : log.source === "UserAction"
                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
                            : "bg-slate-800 text-slate-400 border border-slate-700"
                        }`}>
                          {log.source || "LOG"}
                        </span>

                        <span className={`flex-1 break-words ${
                          isError ? "text-red-400 font-semibold" : isSuccess ? "text-emerald-300 font-medium" : "text-slate-300"
                        }`}>
                          {log.message}
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={logsEndRef} />
              </div>

              {/* Terminal Footer Bar */}
              <div className="bg-[#090d16] px-4 py-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 font-semibold">{logs.length} events</span>
                  <span className="text-slate-700">•</span>
                  <span className="text-[10px] text-purple-400 font-bold">@{workerStatus.channel}</span>
                </div>

                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-slate-400 hover:text-slate-200 select-none">
                    <input 
                      type="checkbox"
                      checked={autoScroll}
                      onChange={(e) => setAutoScroll(e.target.checked)}
                      className="rounded bg-slate-900 border-slate-700 text-purple-600 focus:ring-0 w-3 h-3 cursor-pointer"
                    />
                    Auto-scroll
                  </label>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
