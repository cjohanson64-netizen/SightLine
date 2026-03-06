import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { saveExercise } from "../data/exercises";
import {
  exerciseLoadResponseSchema,
  submissionApproveResponseSchema,
} from "../data/schemas";
import { generateExercise } from "../core/engine";
import type { ExerciseSpec, MelodyEvent } from "../tat";

export type SavedExerciseItem = {
  id: string; seed: number; title: string; created_at: string; folder_id: string | null;
};
export type FolderItem = {
  id: string; name: string; join_code: string | null;
  is_published: boolean | null; default_spec_json: ExerciseSpec | null;
};
export type PacketItem = {
  id: string; folder_id: string; title: string; notes: string | null; created_at: string;
};
export type StudentSubmissionItem = {
  id: string; folder_id: string; student_id: string; title: string; seed: number;
  music_xml: string; spec_json: ExerciseSpec | null; melody_json: MelodyEvent[] | null;
  beats_per_measure: number | null; status: "pending" | "approved" | "rejected"; created_at: string;
};
export type ClassroomStudentItem = {
  id: string; folder_id: string; student_id: string; is_active: boolean; created_at: string;
};
export type TeacherProgressRow = {
  student_id: string; total_minutes: number; total_attempts: number; last_practiced_at: string | null;
};
export type BatchPacketItem = {
  exerciseId: string; seed: number; title: string; musicXml: string; position: number;
};
export type RosterSortKey = "student_id" | "status" | "playtime" | "attempts" | "created";
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

function getSupabaseEnv() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return { supabaseUrl, anonKey };
}

async function callEdgeFunction(
  endpoint: string,
  body: Record<string, unknown>,
  authToken?: string,
) {
  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) throw new Error("Missing Supabase environment variables.");
  const response = await fetch(`${supabaseUrl}/functions/v1/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${authToken ?? anonKey}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : response.statusText;
    throw new Error(message);
  }
  return payload;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

interface UseTeacherLibraryOptions {
  authUserId: string | null;
  mode: "teacher" | "student" | "guest";
  normalizeSpec: (spec: ExerciseSpec) => ExerciseSpec;
  extractMelodyEvents: (artifact: { nodes: Array<{ kind: string; data: unknown }> }) => MelodyEvent[];
}

export function useTeacherLibrary({
  authUserId,
  mode,
  normalizeSpec,
  extractMelodyEvents,
}: UseTeacherLibraryOptions) {
  // Exercises
  const [savedExercises, setSavedExercises] = useState<SavedExerciseItem[]>([]);
  const [savedExercisesStatus, setSavedExercisesStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [savedExercisesError, setSavedExercisesError] = useState("");
  const [savedExercisesNotice, setSavedExercisesNotice] = useState("");
  const [loadingSavedExerciseId, setLoadingSavedExerciseId] = useState<string | null>(null);
  const [deletingSavedExerciseId, setDeletingSavedExerciseId] = useState<string | null>(null);
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null);

  // Folders
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [folderFilterId, setFolderFilterId] = useState("__ALL__");
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [foldersError, setFoldersError] = useState("");

  // Classroom access
  const [classroomPasscode, setClassroomPasscode] = useState("");
  const [classroomJoinCode, setClassroomJoinCode] = useState("");
  const [classroomPublish, setClassroomPublish] = useState(false);
  const [classroomAccessStatus, setClassroomAccessStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [classroomAccessMessage, setClassroomAccessMessage] = useState("");
  const [classroomLastPasscode, setClassroomLastPasscode] = useState("");
  const [classroomDefaultsStatus, setClassroomDefaultsStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [classroomDefaultsMessage, setClassroomDefaultsMessage] = useState("");
  const [subscriptionStatus, setSubscriptionStatus] = useState("inactive");
  const [subscriptionCurrentPeriodEnd, setSubscriptionCurrentPeriodEnd] = useState<string | null>(null);
  const [subscriptionLoadStatus, setSubscriptionLoadStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [subscriptionMessage, setSubscriptionMessage] = useState("");
  const [checkoutStatus, setCheckoutStatus] = useState<"idle" | "starting" | "redirecting" | "error">("idle");

  // Roster
  const [classroomRoster, setClassroomRoster] = useState<ClassroomStudentItem[]>([]);
  const [classroomRosterStatus, setClassroomRosterStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [classroomRosterError, setClassroomRosterError] = useState("");
  const [newRosterStudentId, setNewRosterStudentId] = useState("");
  const [bulkRosterStudentIds, setBulkRosterStudentIds] = useState("");
  const [rosterBusyId, setRosterBusyId] = useState<string | null>(null);
  const [rosterSort, setRosterSort] = useState<{ key: RosterSortKey; direction: "asc" | "desc" }>({
    key: "student_id", direction: "asc",
  });

  // Submissions
  const [studentSubmissions, setStudentSubmissions] = useState<StudentSubmissionItem[]>([]);
  const [studentSubmissionsStatus, setStudentSubmissionsStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [studentSubmissionsError, setStudentSubmissionsError] = useState("");
  const [processingSubmissionId, setProcessingSubmissionId] = useState<string | null>(null);

  // Packets
  const [classPackets, setClassPackets] = useState<PacketItem[]>([]);
  const [classPacketsStatus, setClassPacketsStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [classPacketsError, setClassPacketsError] = useState("");
  const [loadingPacketId, setLoadingPacketId] = useState<string | null>(null);
  const [deletingPacketId, setDeletingPacketId] = useState<string | null>(null);
  const [exportingPacketId, setExportingPacketId] = useState<string | null>(null);
  const [selectedLibraryExerciseIds, setSelectedLibraryExerciseIds] = useState<Set<string>>(new Set());
  const [showCreatePacketFromSelectedModal, setShowCreatePacketFromSelectedModal] = useState(false);
  const [createPacketTitle, setCreatePacketTitle] = useState("");
  const [createPacketNotes, setCreatePacketNotes] = useState("");
  const [createPacketStatus, setCreatePacketStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [createPacketMessage, setCreatePacketMessage] = useState("");
  const [lastCreatedPacket, setLastCreatedPacket] = useState<PacketItem | null>(null);
  const [deletingSelectedLibrary, setDeletingSelectedLibrary] = useState(false);

  // Library preview
  const [showLibraryPreviewModal, setShowLibraryPreviewModal] = useState(false);
  const [libraryPreviewTitle, setLibraryPreviewTitle] = useState("");
  const [libraryPreviewMusicXml, setLibraryPreviewMusicXml] = useState("");
  const [libraryPreviewStatus, setLibraryPreviewStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [libraryPreviewMessage, setLibraryPreviewMessage] = useState("");
  const [editingLibraryExerciseId, setEditingLibraryExerciseId] = useState<string | null>(null);
  const [editingLibraryTitle, setEditingLibraryTitle] = useState("");
  const [savingLibraryTitleId, setSavingLibraryTitleId] = useState<string | null>(null);

  // Progress
  const [teacherProgressRows, setTeacherProgressRows] = useState<TeacherProgressRow[]>([]);
  const [teacherProgressStatus, setTeacherProgressStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [teacherProgressError, setTeacherProgressError] = useState("");

  // Batch
  const [batchCount, setBatchCount] = useState(10);
  const [batchTitlePrefix, setBatchTitlePrefix] = useState("Period 1 - Exercise");
  const [batchPacketTitle, setBatchPacketTitle] = useState("Class Packet");
  const [batchPacketNotes, setBatchPacketNotes] = useState("");
  const [batchFolderId, setBatchFolderId] = useState("");
  const [batchStatus, setBatchStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [batchMessage, setBatchMessage] = useState("");

  // Derived
  const folderNameById = useMemo(() => new Map(folders.map(f => [f.id, f.name])), [folders]);
  const selectedFolder = useMemo(() => folders.find(f => f.id === selectedFolderId) ?? null, [folders, selectedFolderId]);
  const teacherProgressByStudentId = useMemo(
    () => new Map(teacherProgressRows.map(r => [r.student_id, r])),
    [teacherProgressRows],
  );
  const hasActiveSubscription = useMemo(
    () => ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus.toLowerCase()),
    [subscriptionStatus],
  );

  const filteredSavedExercises = useMemo(() =>
    folderFilterId === "__ALL__" ? savedExercises : savedExercises.filter(e => e.folder_id === folderFilterId),
    [savedExercises, folderFilterId],
  );

  const classLibraryExercises = useMemo(() =>
    !selectedFolderId ? [] :
    savedExercises
      .filter(e => e.folder_id === selectedFolderId)
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" })),
    [savedExercises, selectedFolderId],
  );

  const sortedClassroomRoster = useMemo(() => {
    const sorted = [...classroomRoster];
    sorted.sort((a, b) => {
      const ap = teacherProgressByStudentId.get(a.student_id);
      const bp = teacherProgressByStudentId.get(b.student_id);
      let base = 0;
      switch (rosterSort.key) {
        case "student_id": base = a.student_id.localeCompare(b.student_id); break;
        case "status": base = (a.is_active === b.is_active ? 0 : a.is_active ? -1 : 1) || a.student_id.localeCompare(b.student_id); break;
        case "playtime": base = (ap?.total_minutes ?? 0) - (bp?.total_minutes ?? 0) || a.student_id.localeCompare(b.student_id); break;
        case "attempts": base = (ap?.total_attempts ?? 0) - (bp?.total_attempts ?? 0) || a.student_id.localeCompare(b.student_id); break;
        case "created": base = (new Date(a.created_at).getTime() || 0) - (new Date(b.created_at).getTime() || 0) || a.student_id.localeCompare(b.student_id); break;
      }
      return rosterSort.direction === "asc" ? base : -base;
    });
    return sorted;
  }, [classroomRoster, teacherProgressByStudentId, rosterSort]);

  // ─── Data loading effects ─────────────────────────────────────────────────

  const refreshSavedExercises = async () => {
    const { data, error } = await supabase
      .from("exercises")
      .select("id, seed, title, created_at, folder_id")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    setSavedExercises((data ?? []) as SavedExerciseItem[]);
    setSavedExercisesStatus("loaded");
    setSavedExercisesError("");
  };

  useEffect(() => {
    let cancelled = false;
    if (!authUserId || mode !== "teacher") {
      setSavedExercises([]); setSavedExercisesStatus("idle"); setSavedExercisesError(""); return;
    }
    setSavedExercisesStatus("loading");
    refreshSavedExercises()
      .catch(err => {
        if (!cancelled) {
          setSavedExercisesStatus("error");
          setSavedExercisesError(err instanceof Error ? err.message : "Unknown error.");
        }
      });
    return () => { cancelled = true; };
  }, [authUserId, mode]);

  useEffect(() => {
    let cancelled = false;
    if (!authUserId || mode !== "teacher") {
      setFolders([]); setSelectedFolderId(""); return;
    }
    supabase.from("folders")
      .select("id, name, join_code, is_published, default_spec_json")
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setFoldersError(error.message); return; }
        const rows = (data ?? []) as FolderItem[];
        setFolders(rows);
        setSelectedFolderId(prev => rows.some(f => f.id === prev) ? prev : (rows[0]?.id ?? ""));
        setFolderFilterId(prev => prev === "__ALL__" ? prev : rows.some(f => f.id === prev) ? prev : "__ALL__");
      });
    return () => { cancelled = true; };
  }, [authUserId, mode]);

  useEffect(() => {
    if (mode !== "teacher" || !selectedFolder) {
      setClassroomPublish(false); setClassroomJoinCode(""); return;
    }
    setClassroomPublish(selectedFolder.is_published === true);
    setClassroomJoinCode((selectedFolder.join_code ?? "").toUpperCase());
    setClassroomAccessStatus("idle");
    setClassroomAccessMessage("");
  }, [mode, selectedFolder]);

  const refreshSubscriptionStatus = useCallback(async () => {
    if (mode !== "teacher" || !authUserId) {
      setSubscriptionStatus("inactive");
      setSubscriptionCurrentPeriodEnd(null);
      setSubscriptionLoadStatus("idle");
      setSubscriptionMessage("");
      return;
    }
    setSubscriptionLoadStatus("loading");
    setSubscriptionMessage("");
    const { data, error } = await supabase
      .from("subscriptions")
      .select("status, current_period_end")
      .eq("user_id", authUserId)
      .maybeSingle();
    if (error) {
      setSubscriptionLoadStatus("error");
      setSubscriptionStatus("inactive");
      setSubscriptionCurrentPeriodEnd(null);
      setSubscriptionMessage(error.message);
      return;
    }
    setSubscriptionStatus(typeof data?.status === "string" ? data.status : "inactive");
    setSubscriptionCurrentPeriodEnd(
      typeof data?.current_period_end === "string" ? data.current_period_end : null,
    );
    setSubscriptionLoadStatus("loaded");
  }, [mode, authUserId]);

  useEffect(() => {
    if (mode !== "teacher" || !authUserId) {
      setSubscriptionStatus("inactive");
      setSubscriptionCurrentPeriodEnd(null);
      setSubscriptionLoadStatus("idle");
      setSubscriptionMessage("");
      return;
    }
    void refreshSubscriptionStatus();
  }, [mode, authUserId, refreshSubscriptionStatus]);

  const refreshRoster = async (folderId: string) => {
    const { data, error } = await supabase
      .from("classroom_students")
      .select("id, folder_id, student_id, is_active, created_at")
      .eq("folder_id", folderId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    setClassroomRoster((data ?? []) as ClassroomStudentItem[]);
    setClassroomRosterStatus("loaded");
    setClassroomRosterError("");
  };

  useEffect(() => {
    let cancelled = false;
    if (mode !== "teacher" || !selectedFolderId) { setClassroomRoster([]); setClassroomRosterStatus("idle"); return; }
    setClassroomRosterStatus("loading");
    refreshRoster(selectedFolderId).catch(err => {
      if (cancelled) return;
      setClassroomRosterStatus("error");
      setClassroomRosterError(err instanceof Error ? err.message : "Unable to load roster.");
    });
    return () => { cancelled = true; };
  }, [mode, selectedFolderId]);

  useEffect(() => {
    let cancelled = false;
    if (mode !== "teacher" || !selectedFolderId) { setStudentSubmissions([]); setStudentSubmissionsStatus("idle"); return; }
    setStudentSubmissionsStatus("loading");
    supabase.from("student_submissions")
      .select("id, folder_id, student_id, title, seed, music_xml, spec_json, melody_json, beats_per_measure, status, created_at")
      .eq("folder_id", selectedFolderId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setStudentSubmissionsStatus("error"); setStudentSubmissionsError(error.message); return; }
        setStudentSubmissions((data ?? []) as StudentSubmissionItem[]);
        setStudentSubmissionsStatus("loaded");
      });
    return () => { cancelled = true; };
  }, [mode, selectedFolderId]);

  const refreshPackets = async (folderId: string) => {
    const { data, error } = await supabase
      .from("packets").select("id, folder_id, title, notes, created_at")
      .eq("folder_id", folderId).order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    setClassPackets((data ?? []) as PacketItem[]);
    setClassPacketsStatus("loaded");
    setClassPacketsError("");
  };

  useEffect(() => {
    let cancelled = false;
    if (mode !== "teacher" || !selectedFolderId) { setClassPackets([]); setClassPacketsStatus("idle"); return; }
    setClassPacketsStatus("loading");
    refreshPackets(selectedFolderId).catch(err => {
      if (cancelled) return;
      setClassPacketsStatus("error");
      setClassPacketsError(err instanceof Error ? err.message : "Unable to load packets.");
    });
    return () => { cancelled = true; };
  }, [mode, selectedFolderId]);

  useEffect(() => {
    setSelectedLibraryExerciseIds(new Set());
    setShowCreatePacketFromSelectedModal(false);
    setCreatePacketStatus("idle");
    setCreatePacketMessage("");
    setLastCreatedPacket(null);
  }, [selectedFolderId]);

  useEffect(() => {
    if (mode !== "teacher" || !selectedFolderId) { setTeacherProgressRows([]); return; }
    setTeacherProgressStatus("loading");
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.access_token) { setTeacherProgressStatus("error"); setTeacherProgressError("Sign in again."); return; }
      const { supabaseUrl, anonKey } = getSupabaseEnv();
      if (!supabaseUrl || !anonKey) return;
      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/get_progress_summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ folder_id: selectedFolderId }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Unable to load progress.");
        setTeacherProgressRows(Array.isArray(payload.summary) ? payload.summary : []);
        setTeacherProgressStatus("loaded");
      } catch (err) {
        setTeacherProgressStatus("error");
        setTeacherProgressError(err instanceof Error ? err.message : "Unable to load progress.");
      }
    });
  }, [mode, selectedFolderId, authUserId]);

  // ─── Actions ─────────────────────────────────────────────────────────────

  const saveToSupabase = async (options: {
    forceInsert?: boolean;
    seed: number; title: string; musicXml: string;
    currentMelody: MelodyEvent[]; pitchPatch: Record<string, unknown>;
    specSnapshot: ExerciseSpec; beatsPerMeasure: number;
  }) => {
    if (mode !== "teacher") return { status: "error" as const, message: "Teacher mode only." };
    if (!options.musicXml) return { status: "error" as const, message: "Generate a melody first." };

    try {
      const { forceInsert, seed, title, musicXml, specSnapshot, beatsPerMeasure, currentMelody } = options;
      if (activeExerciseId && !forceInsert) {
        const { error } = await supabase.from("exercises").update({
          seed, title, music_xml: musicXml,
          folder_id: selectedFolderId || null,
          spec_json: specSnapshot, melody_json: currentMelody, beats_per_measure: beatsPerMeasure,
        }).eq("id", activeExerciseId);
        if (error) throw new Error(error.message);
        setSavedExercises(prev => prev.map(e => e.id === activeExerciseId
          ? { ...e, seed, title, folder_id: selectedFolderId || null } : e));
        return { status: "saved" as const, message: "Updated saved exercise" };
      } else {
        const inserted = await saveExercise({
          seed, title, musicXml, folderId: selectedFolderId || null,
          specJson: specSnapshot, melodyJson: currentMelody, beatsPerMeasure,
        });
        setActiveExerciseId(inserted.id);
        await refreshSavedExercises();
        return { status: "saved" as const, message: forceInsert ? "Saved as new exercise" : "Saved!" };
      }
    } catch (error) {
      return { status: "error" as const, message: error instanceof Error ? error.message : "Unknown save error." };
    }
  };

  const loadSavedExercise = async (id: string) => {
    if (mode !== "teacher" || !id) return null;
    setLoadingSavedExerciseId(id);
    setSavedExercisesError("");
    setSavedExercisesNotice("");
    try {
      const { data, error } = await supabase.from("exercises")
        .select("id, seed, title, music_xml, folder_id, spec_json, melody_json, beats_per_measure")
        .eq("id", id).single();
      if (error || !data) throw new Error(error?.message ?? "No exercise found.");
      const parsed = exerciseLoadResponseSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error(
          `Invalid exercise load response: ${parsed.error.issues
            .map((issue) => issue.path.join(".") || "(root)")
            .join(", ")}`,
        );
      }
      return parsed.data as {
        id: string; seed: number; title: string; music_xml: string;
        folder_id: string | null; spec_json: ExerciseSpec | null;
        melody_json: MelodyEvent[] | null; beats_per_measure: number | null;
      };
    } catch (error) {
      setSavedExercisesError(`Unable to load exercise: ${error instanceof Error ? error.message : "Unknown error."}`);
      return null;
    } finally {
      setLoadingSavedExerciseId(null);
    }
  };

  const deleteSavedExercise = async (id: string) => {
    if (mode !== "teacher" || !id) return;
    setDeletingSavedExerciseId(id);
    setSavedExercisesError("");
    try {
      const { error } = await supabase.from("exercises").delete().eq("id", id);
      if (error) throw new Error(error.message);
      setSavedExercises(prev => prev.filter(e => e.id !== id));
      setSavedExercisesNotice("Deleted exercise.");
    } catch (error) {
      setSavedExercisesError(`Unable to delete exercise: ${error instanceof Error ? error.message : "Unknown error."}`);
    } finally {
      setDeletingSavedExerciseId(null);
    }
  };

  const createFolder = async () => {
    if (mode !== "teacher" || !authUserId) return;
    const name = newFolderName.trim();
    if (!name) return;
    setCreatingFolder(true);
    setFoldersError("");
    try {
      const { data, error } = await supabase.from("folders")
        .insert({ owner_id: authUserId, name })
        .select("id, name, join_code, is_published, default_spec_json")
        .single();
      if (error) {
        if ((error as { code?: string }).code === "23505") throw new Error("A class with that name already exists.");
        throw new Error(error.message);
      }
      const newFolder = data as FolderItem;
      const { data: refreshed, error: refreshError } = await supabase
        .from("folders").select("id, name, join_code, is_published, default_spec_json")
        .order("created_at", { ascending: true });
      if (refreshError) throw new Error(refreshError.message);
      setFolders((refreshed ?? []) as FolderItem[]);
      setSelectedFolderId(newFolder.id);
      setNewFolderName("");
    } catch (error) {
      setFoldersError(error instanceof Error ? error.message : "Unknown class create error.");
    } finally {
      setCreatingFolder(false);
    }
  };

  const saveClassDefaults = async (spec: ExerciseSpec) => {
    if (mode !== "teacher" || !selectedFolderId) return;
    const normalized = normalizeSpec(spec);
    setClassroomDefaultsStatus("loading");
    try {
      const { error } = await supabase.from("folders")
        .update({ default_spec_json: normalized }).eq("id", selectedFolderId);
      if (error) throw new Error(error.message);
      setFolders(prev => prev.map(f => f.id === selectedFolderId ? { ...f, default_spec_json: normalized } : f));
      setClassroomDefaultsStatus("loaded");
      setClassroomDefaultsMessage("Saved class defaults.");
    } catch (error) {
      setClassroomDefaultsStatus("error");
      setClassroomDefaultsMessage(error instanceof Error ? error.message : "Unable to save defaults.");
    }
  };

  const clearClassDefaults = async () => {
    if (mode !== "teacher" || !selectedFolderId) return;
    setClassroomDefaultsStatus("loading");
    try {
      const { error } = await supabase.from("folders")
        .update({ default_spec_json: null }).eq("id", selectedFolderId);
      if (error) throw new Error(error.message);
      setFolders(prev => prev.map(f => f.id === selectedFolderId ? { ...f, default_spec_json: null } : f));
      setClassroomDefaultsStatus("loaded");
      setClassroomDefaultsMessage("Cleared class defaults.");
    } catch (error) {
      setClassroomDefaultsStatus("error");
      setClassroomDefaultsMessage(error instanceof Error ? error.message : "Unable to clear defaults.");
    }
  };

  const setClassroomAccess = async (rotateCode: boolean) => {
    if (mode !== "teacher" || !selectedFolderId) return;
    const passcode = classroomPasscode.trim();
    if (!passcode) return { status: "error" as const, message: "Enter a passcode before updating." };
    setClassroomAccessStatus("saving");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("No active session.");
      const { supabaseUrl, anonKey } = getSupabaseEnv();
      if (!supabaseUrl || !anonKey) throw new Error("Missing env vars.");
      const join_code = rotateCode ? undefined : classroomJoinCode.trim().toUpperCase() || undefined;
      const res = await fetch(`${supabaseUrl}/functions/v1/set_classroom_access`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ folder_id: selectedFolderId, passcode, rotate_code: rotateCode, ...(rotateCode ? {} : { join_code }), publish: classroomPublish }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.classroom) throw new Error(typeof payload.error === "string" ? payload.error : res.statusText);
      const { data: refreshed } = await supabase.from("folders")
        .select("id, name, join_code, is_published, default_spec_json")
        .order("created_at", { ascending: true });
      setFolders((refreshed ?? []) as FolderItem[]);
      setClassroomLastPasscode(passcode);
      setClassroomPasscode("");
      setClassroomJoinCode((payload.classroom.join_code ?? "").toUpperCase());
      setClassroomAccessStatus("saved");
      setClassroomAccessMessage(rotateCode ? "Classroom code rotated." : "Classroom access updated.");
    } catch (error) {
      setClassroomAccessStatus("error");
      setClassroomAccessMessage(error instanceof Error ? error.message : "Unable to set classroom access.");
    }
  };

  const startCheckout = useCallback(async () => {
    if (mode !== "teacher" || !authUserId) return false;
    setCheckoutStatus("starting");
    setSubscriptionMessage("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sign in again.");
      const payload = await callEdgeFunction("create_checkout_session", {}, session.access_token) as { url?: unknown };
      if (typeof payload.url !== "string" || payload.url.length === 0) {
        throw new Error("Checkout URL missing from response.");
      }
      setCheckoutStatus("redirecting");
      window.location.assign(payload.url);
      return true;
    } catch (error) {
      setCheckoutStatus("error");
      setSubscriptionMessage(error instanceof Error ? error.message : "Unable to start checkout.");
      return false;
    }
  }, [mode, authUserId]);

  const addRosterStudent = async () => {
    if (mode !== "teacher" || !selectedFolderId) return;
    const studentIdValue = newRosterStudentId.trim().toUpperCase();
    if (!studentIdValue) return;
    setRosterBusyId("__add__");
    setClassroomRosterError("");
    try {
      const { error } = await supabase.from("classroom_students")
        .insert({ folder_id: selectedFolderId, student_id: studentIdValue, is_active: true });
      if (error) throw new Error(error.message);
      setNewRosterStudentId("");
      await refreshRoster(selectedFolderId);
    } catch (error) {
      setClassroomRosterError(error instanceof Error ? error.message : "Unable to add student ID.");
    } finally {
      setRosterBusyId(null);
    }
  };

  const bulkAddRosterStudents = async () => {
    if (mode !== "teacher" || !selectedFolderId) return;
    const ids = Array.from(new Set(
      bulkRosterStudentIds.split(/\r?\n/).map(v => v.trim().toUpperCase()).filter(Boolean),
    ));
    if (ids.length === 0) return;
    setRosterBusyId("__bulk__");
    setClassroomRosterError("");
    try {
      const rows = ids.map(student_id => ({ folder_id: selectedFolderId, student_id, is_active: true }));
      const { error } = await supabase.from("classroom_students")
        .upsert(rows, { onConflict: "folder_id,student_id", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      setBulkRosterStudentIds("");
      await refreshRoster(selectedFolderId);
    } catch (error) {
      setClassroomRosterError(error instanceof Error ? error.message : "Unable to add student IDs.");
    } finally {
      setRosterBusyId(null);
    }
  };

  const toggleRosterStudent = async (item: ClassroomStudentItem) => {
    if (mode !== "teacher" || !selectedFolderId) return;
    setRosterBusyId(item.id);
    try {
      const { error } = await supabase.from("classroom_students")
        .update({ is_active: !item.is_active }).eq("id", item.id);
      if (error) throw new Error(error.message);
      await refreshRoster(selectedFolderId);
    } catch (error) {
      setClassroomRosterError(error instanceof Error ? error.message : "Unable to update student.");
    } finally {
      setRosterBusyId(null);
    }
  };

  const deleteRosterStudent = async (item: ClassroomStudentItem) => {
    if (mode !== "teacher" || !selectedFolderId) return;
    setRosterBusyId(item.id);
    try {
      const { error } = await supabase.from("classroom_students").delete().eq("id", item.id);
      if (error) throw new Error(error.message);
      await refreshRoster(selectedFolderId);
    } catch (error) {
      setClassroomRosterError(error instanceof Error ? error.message : "Unable to remove student.");
    } finally {
      setRosterBusyId(null);
    }
  };

  const approveSubmission = async (submissionId: string) => {
    if (mode !== "teacher") return;
    const { data: { session } } = await supabase.auth.getSession();
    const teacherToken = session?.access_token ?? "";
    if (!teacherToken) { setStudentSubmissionsError("Sign in again to approve."); return; }
    const { supabaseUrl, anonKey } = getSupabaseEnv();
    if (!supabaseUrl || !anonKey) return;
    setProcessingSubmissionId(submissionId);
    setStudentSubmissionsError("");
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/approve_submission`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${teacherToken}` },
        body: JSON.stringify({ submission_id: submissionId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((payload as { error?: string }).error || "Unable to approve.");
      const parsed = submissionApproveResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(
          `Invalid approve_submission response: ${parsed.error.issues
            .map((issue) => issue.path.join(".") || "(root)")
            .join(", ")}`,
        );
      }
      if (!parsed.data.ok) throw new Error((payload as { error?: string }).error || "Unable to approve.");
      setStudentSubmissions(prev => prev.filter(s => s.id !== submissionId));
      await refreshSavedExercises();
    } catch (error) {
      setStudentSubmissionsError(error instanceof Error ? error.message : "Unable to approve submission.");
    } finally {
      setProcessingSubmissionId(null);
    }
  };

  const rejectSubmission = async (submissionId: string) => {
    if (mode !== "teacher") return;
    setProcessingSubmissionId(submissionId);
    try {
      const { error } = await supabase.from("student_submissions")
        .update({ status: "rejected" }).eq("id", submissionId);
      if (error) throw new Error(error.message);
      setStudentSubmissions(prev => prev.filter(s => s.id !== submissionId));
    } catch (error) {
      setStudentSubmissionsError(error instanceof Error ? error.message : "Unable to reject submission.");
    } finally {
      setProcessingSubmissionId(null);
    }
  };

  const fetchPacketRenderItems = async (packetId: string): Promise<BatchPacketItem[]> => {
    const { data, error } = await supabase.from("packet_items")
      .select("position, exercise:exercises(id, seed, title, music_xml)")
      .eq("packet_id", packetId).order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map(row => {
        const rawEx = row.exercise as
          | { id: string; seed: number; title: string; music_xml: string }
          | { id: string; seed: number; title: string; music_xml: string }[]
          | null;
        const ex = Array.isArray(rawEx) ? (rawEx[0] ?? null) : rawEx;
        if (!ex) return null;
        return { exerciseId: ex.id, seed: ex.seed, title: ex.title, musicXml: ex.music_xml, position: Number(row.position ?? 0) };
      })
      .filter((item): item is BatchPacketItem => item !== null);
  };

  // Batch generation with parallelized exercise generation (up to 5 at a time)
  const batchGenerate = async (spec: ExerciseSpec) => {
    if (mode !== "teacher" || !authUserId || !batchFolderId) {
      setBatchStatus("error");
      setBatchMessage(!authUserId ? "Sign in as teacher." : "Select a class for this packet.");
      return null;
    }
    const total = Math.max(1, Math.min(100, Math.floor(batchCount || 0)));
    const titlePrefix = batchTitlePrefix.trim() || "Exercise";
    const packetTitle = batchPacketTitle.trim() || `${titlePrefix} Packet`;
    const packetNotes = batchPacketNotes.trim();
    const CHUNK_SIZE = 5;

    setBatchStatus("running");
    setBatchProgress({ current: 0, total });
    setBatchMessage("");

    let packetId: string | null = null;
    const generatedItems: BatchPacketItem[] = [];

    try {
      const { data: packetRow, error: packetError } = await supabase.from("packets")
        .insert({ owner_id: authUserId, folder_id: batchFolderId, title: packetTitle, notes: packetNotes || null })
        .select("id").single();
      if (packetError || !packetRow) throw new Error(packetError?.message ?? "Unable to create packet.");
      packetId = packetRow.id;

      // Generate all exercises, chunked for parallelism
      const indices = Array.from({ length: total }, (_, i) => i);
      for (let chunkStart = 0; chunkStart < total; chunkStart += CHUNK_SIZE) {
        const chunk = indices.slice(chunkStart, chunkStart + CHUNK_SIZE);
        const chunkResults = await Promise.all(chunk.map(async (index) => {
          let output: ReturnType<typeof generateExercise> | null = null;
          let generatedSeed = randomSeed();
          for (let attempt = 0; attempt < 5; attempt++) {
            generatedSeed = randomSeed();
            const candidate = generateExercise({ spec, seed: generatedSeed });
            if (candidate.status === "ok") { output = candidate; break; }
          }
          if (!output || output.status !== "ok") {
            throw new Error(`Unable to generate melody ${index + 1} with current constraints.`);
          }
          const displayNumber = total - index;
          const itemTitle = `${titlePrefix} ${displayNumber}`;
          const specSnapshot = normalizeSpec({ ...spec, title: itemTitle });
          const melodyEvents = extractMelodyEvents(output.artifact);
          const beatsPerMeasure = Math.max(1, Number(specSnapshot.timeSig.split("/")[0]) || 4);
          const inserted = await saveExercise({
            seed: generatedSeed, title: itemTitle, musicXml: output.musicXml,
            folderId: batchFolderId, specJson: specSnapshot, melodyJson: melodyEvents, beatsPerMeasure,
          });
          return { exerciseId: inserted.id, seed: generatedSeed, title: itemTitle, musicXml: output.musicXml, position: displayNumber };
        }));
        generatedItems.push(...chunkResults);
        setBatchProgress({ current: Math.min(chunkStart + CHUNK_SIZE, total), total });
      }

      const { error: itemsError } = await supabase.from("packet_items")
        .insert(generatedItems.map(item => ({ packet_id: packetId, exercise_id: item.exerciseId, position: item.position })));
      if (itemsError) throw new Error(itemsError.message);

      await refreshSavedExercises();
      await refreshPackets(batchFolderId);
      setBatchStatus("done");
      setBatchMessage(`Generated and saved packet with ${generatedItems.length} exercises.`);
      return { packetId, items: generatedItems, packetTitle, packetNotes };
    } catch (error) {
      if (packetId) {
        await supabase.from("packet_items").delete().eq("packet_id", packetId);
        await supabase.from("packets").delete().eq("id", packetId);
      }
      setBatchStatus("error");
      setBatchMessage(error instanceof Error ? error.message : "Batch generation failed.");
      return null;
    }
  };

  const openBatchModal = (folderId: string, folderName: string) => {
    setBatchFolderId(folderId);
    const today = new Date().toLocaleDateString();
    setBatchPacketTitle(`${folderName} Packet ${today}`);
    setBatchPacketNotes("");
    setBatchStatus("idle");
    setBatchProgress({ current: 0, total: 0 });
    setBatchMessage("");
  };

  const deletePacket = async (packetId: string) => {
    if (mode !== "teacher") return;
    setDeletingPacketId(packetId);
    setClassPacketsError("");
    try {
      const { error } = await supabase.from("packets").delete().eq("id", packetId);
      if (error) throw new Error(error.message);
      setClassPackets(prev => prev.filter(p => p.id !== packetId));
    } catch (error) {
      setClassPacketsError(error instanceof Error ? error.message : "Unable to delete packet.");
    } finally {
      setDeletingPacketId(null);
    }
  };

  const toggleLibraryExerciseSelection = (id: string) => {
    setSelectedLibraryExerciseIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const createPacketFromSelected = async () => {
    if (mode !== "teacher" || !authUserId || !selectedFolderId) return null;
    const chosen = classLibraryExercises.filter(e => selectedLibraryExerciseIds.has(e.id));
    if (chosen.length === 0 || !createPacketTitle.trim()) return null;
    setCreatePacketStatus("saving");
    try {
      const { data: packetRow, error } = await supabase.from("packets")
        .insert({ owner_id: authUserId, folder_id: selectedFolderId, title: createPacketTitle.trim(), notes: createPacketNotes.trim() || null })
        .select("id, folder_id, title, notes, created_at").single();
      if (error || !packetRow) throw new Error(error?.message ?? "Unable to create packet.");
      await supabase.from("packet_items").insert(
        chosen.map((e, i) => ({ packet_id: packetRow.id, exercise_id: e.id, position: i + 1 })),
      );
      await refreshPackets(selectedFolderId);
      const created = packetRow as PacketItem;
      setCreatePacketStatus("saved");
      setCreatePacketMessage(`Packet created with ${chosen.length} exercises.`);
      setLastCreatedPacket(created);
      setSelectedLibraryExerciseIds(new Set());
      return created;
    } catch (error) {
      setCreatePacketStatus("error");
      setCreatePacketMessage(error instanceof Error ? error.message : "Unable to create packet.");
      return null;
    }
  };

  const openLibraryPreview = async (exerciseId: string, fallbackTitle: string) => {
    if (mode !== "teacher") return;
    setShowLibraryPreviewModal(true);
    setLibraryPreviewTitle(fallbackTitle);
    setLibraryPreviewMusicXml("");
    setLibraryPreviewStatus("loading");
    try {
      const { data, error } = await supabase.from("exercises")
        .select("title, music_xml").eq("id", exerciseId).single();
      if (error || !data?.music_xml) throw new Error(error?.message ?? "Unable to load preview.");
      setLibraryPreviewTitle(data.title ?? fallbackTitle);
      setLibraryPreviewMusicXml(data.music_xml);
      setLibraryPreviewStatus("loaded");
    } catch (error) {
      setLibraryPreviewStatus("error");
      setLibraryPreviewMessage(error instanceof Error ? error.message : "Unable to load preview.");
    }
  };

  const saveLibraryTitleEdit = async (exerciseId: string) => {
    if (mode !== "teacher") return;
    const nextTitle = editingLibraryTitle.trim();
    if (!nextTitle) { setSavedExercisesError("Title cannot be empty."); return; }
    setSavingLibraryTitleId(exerciseId);
    setSavedExercisesError("");
    try {
      const { error } = await supabase.from("exercises").update({ title: nextTitle }).eq("id", exerciseId);
      if (error) throw new Error(error.message);
      setSavedExercises(prev => prev.map(e => e.id === exerciseId ? { ...e, title: nextTitle } : e));
      setEditingLibraryExerciseId(null);
      setEditingLibraryTitle("");
    } catch (error) {
      setSavedExercisesError(error instanceof Error ? error.message : "Unable to update title.");
    } finally {
      setSavingLibraryTitleId(null);
    }
  };

  const onRosterSort = (key: RosterSortKey) => {
    setRosterSort(prev =>
      prev.key === key ? { key, direction: prev.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" },
    );
  };

  return {
    // Exercises
    savedExercises, savedExercisesStatus, savedExercisesError, savedExercisesNotice,
    setSavedExercisesNotice,
    loadingSavedExerciseId, deletingSavedExerciseId, activeExerciseId, setActiveExerciseId,
    // Folders
    folders, selectedFolderId, setSelectedFolderId, folderFilterId, setFolderFilterId,
    newFolderName, setNewFolderName, creatingFolder, foldersError,
    folderNameById, selectedFolder,
    // Classroom access
    classroomPasscode, setClassroomPasscode, classroomJoinCode, setClassroomJoinCode,
    classroomPublish, setClassroomPublish, classroomAccessStatus, classroomAccessMessage,
    classroomLastPasscode, classroomDefaultsStatus, classroomDefaultsMessage,
    subscriptionStatus, subscriptionCurrentPeriodEnd, subscriptionLoadStatus,
    subscriptionMessage, checkoutStatus, hasActiveSubscription,
    // Roster
    classroomRoster, classroomRosterStatus, classroomRosterError,
    newRosterStudentId, setNewRosterStudentId, bulkRosterStudentIds, setBulkRosterStudentIds,
    rosterBusyId, rosterSort, sortedClassroomRoster, teacherProgressByStudentId,
    onRosterSort,
    rosterSortIndicator: (key: RosterSortKey) =>
      rosterSort.key === key ? (rosterSort.direction === "asc" ? " ↑" : " ↓") : "",
    // Submissions
    studentSubmissions, studentSubmissionsStatus, studentSubmissionsError, processingSubmissionId,
    // Packets
    classPackets, classPacketsStatus, classPacketsError,
    loadingPacketId, deletingPacketId, exportingPacketId, setExportingPacketId,
    selectedLibraryExerciseIds,
    showCreatePacketFromSelectedModal, setShowCreatePacketFromSelectedModal,
    createPacketTitle, setCreatePacketTitle, createPacketNotes, setCreatePacketNotes,
    createPacketStatus, createPacketMessage, lastCreatedPacket,
    deletingSelectedLibrary,
    // Library preview
    showLibraryPreviewModal, setShowLibraryPreviewModal,
    libraryPreviewTitle, libraryPreviewMusicXml, libraryPreviewStatus, libraryPreviewMessage,
    editingLibraryExerciseId, setEditingLibraryExerciseId,
    editingLibraryTitle, setEditingLibraryTitle, savingLibraryTitleId,
    // Progress
    teacherProgressRows, teacherProgressStatus, teacherProgressError,
    // Batch
    batchCount, setBatchCount, batchTitlePrefix, setBatchTitlePrefix,
    batchPacketTitle, setBatchPacketTitle, batchPacketNotes, setBatchPacketNotes,
    batchFolderId, setBatchFolderId, batchStatus, batchProgress, batchMessage,
    // Derived
    filteredSavedExercises, classLibraryExercises,
    // Actions
    saveToSupabase, loadSavedExercise, deleteSavedExercise, createFolder,
    saveClassDefaults, clearClassDefaults, setClassroomAccess,
    refreshSubscriptionStatus, startCheckout,
    addRosterStudent, bulkAddRosterStudents, toggleRosterStudent, deleteRosterStudent,
    approveSubmission, rejectSubmission,
    fetchPacketRenderItems, batchGenerate, openBatchModal, deletePacket,
    toggleLibraryExerciseSelection,
    handleSelectAllLibraryExercises: () => setSelectedLibraryExerciseIds(new Set(classLibraryExercises.map(e => e.id))),
    handleClearLibraryExerciseSelection: () => setSelectedLibraryExerciseIds(new Set()),
    handleDeleteSelectedLibraryExercises: async () => {
      if (selectedLibraryExerciseIds.size === 0) return;
      const ids = Array.from(selectedLibraryExerciseIds);
      setDeletingSelectedLibrary(true);
      try {
        const { error } = await supabase.from("exercises").delete().in("id", ids);
        if (error) throw new Error(error.message);
        setSavedExercises(prev => prev.filter(e => !selectedLibraryExerciseIds.has(e.id)));
        setSelectedLibraryExerciseIds(new Set());
        setSavedExercisesNotice(`Deleted ${ids.length} exercise${ids.length === 1 ? "" : "s"}.`);
      } catch (error) {
        setSavedExercisesError(error instanceof Error ? error.message : "Unable to delete selected.");
      } finally {
        setDeletingSelectedLibrary(false);
      }
    },
    createPacketFromSelected, openLibraryPreview,
    closeLibraryPreview: () => { setShowLibraryPreviewModal(false); setLibraryPreviewStatus("idle"); setLibraryPreviewMusicXml(""); },
    startLibraryTitleEdit: (exercise: SavedExerciseItem) => { setEditingLibraryExerciseId(exercise.id); setEditingLibraryTitle(exercise.title); setSavedExercisesError(""); },
    saveLibraryTitleEdit,
    refreshPackets,
    copyClassroomAccess: async (joinCode: string, passcode: string) => {
      if (!joinCode) return;
      const text = `Class Code: ${joinCode}  Passcode: ${passcode}`;
      try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
    },
    copyStudentInstructions: async (joinCode: string, passcode: string, studentIdValue?: string) => {
      const instruction = [
        `Class Code: ${joinCode}`,
        `Passcode: ${passcode || "ask teacher"}`,
        studentIdValue ? `Student ID: ${studentIdValue}` : "Student ID: <assigned by teacher>",
      ].join("\n");
      try { await navigator.clipboard.writeText(instruction); return true; } catch { return false; }
    },
  };
}
