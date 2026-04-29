import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { submissionApproveResponseSchema } from "../data/schemas";
import type { ExerciseSpec } from "@/SightLine/domain/music";
import {
  type ClassroomStudentItem,
  type FolderItem,
  type RosterSortKey,
  type StudentSubmissionItem,
  type TeacherProgressRow,
} from "./teacherLibraryTypes";
import { getSupabaseEnv } from "./teacherLibraryUtils";

interface UseTeacherClassroomOptions {
  authUserId: string | null;
  mode: "teacher" | "student" | "guest";
  normalizeSpec: (spec: ExerciseSpec) => ExerciseSpec;
}

export function useTeacherClassroom({
  authUserId,
  mode,
  normalizeSpec,
}: UseTeacherClassroomOptions) {
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [folderFilterId, setFolderFilterId] = useState("__ALL__");
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [foldersError, setFoldersError] = useState("");

  const [classroomPasscode, setClassroomPasscode] = useState("");
  const [classroomJoinCode, setClassroomJoinCode] = useState("");
  const [classroomPublish, setClassroomPublish] = useState(false);
  const [classroomAccessStatus, setClassroomAccessStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [classroomAccessMessage, setClassroomAccessMessage] = useState("");
  const [classroomLastPasscode, setClassroomLastPasscode] = useState("");
  const [classroomDefaultsStatus, setClassroomDefaultsStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [classroomDefaultsMessage, setClassroomDefaultsMessage] =
    useState("");

  const [classroomRoster, setClassroomRoster] = useState<ClassroomStudentItem[]>(
    [],
  );
  const [classroomRosterStatus, setClassroomRosterStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [classroomRosterError, setClassroomRosterError] = useState("");
  const [newRosterStudentId, setNewRosterStudentId] = useState("");
  const [bulkRosterStudentIds, setBulkRosterStudentIds] = useState("");
  const [rosterBusyId, setRosterBusyId] = useState<string | null>(null);
  const [rosterSort, setRosterSort] = useState<{
    key: RosterSortKey;
    direction: "asc" | "desc";
  }>({
    key: "student_id",
    direction: "asc",
  });

  const [studentSubmissions, setStudentSubmissions] = useState<
    StudentSubmissionItem[]
  >([]);
  const [studentSubmissionsStatus, setStudentSubmissionsStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [studentSubmissionsError, setStudentSubmissionsError] = useState("");
  const [processingSubmissionId, setProcessingSubmissionId] = useState<
    string | null
  >(null);

  const [teacherProgressRows, setTeacherProgressRows] = useState<
    TeacherProgressRow[]
  >([]);
  const [teacherProgressStatus, setTeacherProgressStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [teacherProgressError, setTeacherProgressError] = useState("");

  const folderNameById = useMemo(
    () => new Map(folders.map((f) => [f.id, f.name])),
    [folders],
  );
  const selectedFolder = useMemo(
    () => folders.find((f) => f.id === selectedFolderId) ?? null,
    [folders, selectedFolderId],
  );
  const teacherProgressByStudentId = useMemo(
    () => new Map(teacherProgressRows.map((r) => [r.student_id, r])),
    [teacherProgressRows],
  );

  const sortedClassroomRoster = useMemo(() => {
    const sorted = [...classroomRoster];
    sorted.sort((a, b) => {
      const ap = teacherProgressByStudentId.get(a.student_id);
      const bp = teacherProgressByStudentId.get(b.student_id);
      let base = 0;
      switch (rosterSort.key) {
        case "student_id":
          base = a.student_id.localeCompare(b.student_id);
          break;
        case "status":
          base =
            (a.is_active === b.is_active ? 0 : a.is_active ? -1 : 1) ||
            a.student_id.localeCompare(b.student_id);
          break;
        case "playtime":
          base =
            (ap?.total_minutes ?? 0) - (bp?.total_minutes ?? 0) ||
            a.student_id.localeCompare(b.student_id);
          break;
        case "attempts":
          base =
            (ap?.total_attempts ?? 0) - (bp?.total_attempts ?? 0) ||
            a.student_id.localeCompare(b.student_id);
          break;
        case "created":
          base =
            (new Date(a.created_at).getTime() || 0) -
              (new Date(b.created_at).getTime() || 0) ||
            a.student_id.localeCompare(b.student_id);
          break;
      }
      return rosterSort.direction === "asc" ? base : -base;
    });
    return sorted;
  }, [classroomRoster, teacherProgressByStudentId, rosterSort]);

  useEffect(() => {
    let cancelled = false;
    if (!authUserId || mode !== "teacher") {
      setFolders([]);
      setSelectedFolderId("");
      return;
    }
    supabase
      .from("folders")
      .select("id, name, join_code, is_published, default_spec_json")
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setFoldersError(error.message);
          return;
        }
        const rows = (data ?? []) as FolderItem[];
        setFolders(rows);
        setSelectedFolderId((prev) =>
          rows.some((f) => f.id === prev) ? prev : (rows[0]?.id ?? ""),
        );
        setFolderFilterId((prev) =>
          prev === "__ALL__"
            ? prev
            : rows.some((f) => f.id === prev)
              ? prev
              : "__ALL__",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [authUserId, mode]);

  useEffect(() => {
    if (mode !== "teacher" || !selectedFolder) {
      setClassroomPublish(false);
      setClassroomJoinCode("");
      return;
    }
    setClassroomPublish(selectedFolder.is_published === true);
    setClassroomJoinCode((selectedFolder.join_code ?? "").toUpperCase());
    setClassroomAccessStatus("idle");
    setClassroomAccessMessage("");
  }, [mode, selectedFolder]);

  const refreshRoster = useCallback(async (folderId: string) => {
    const { data, error } = await supabase
      .from("classroom_students")
      .select("id, folder_id, student_id, is_active, created_at")
      .eq("folder_id", folderId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    setClassroomRoster((data ?? []) as ClassroomStudentItem[]);
    setClassroomRosterStatus("loaded");
    setClassroomRosterError("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (mode !== "teacher" || !selectedFolderId) {
      setClassroomRoster([]);
      setClassroomRosterStatus("idle");
      return;
    }
    setClassroomRosterStatus("loading");
    refreshRoster(selectedFolderId).catch((err) => {
      if (cancelled) return;
      setClassroomRosterStatus("error");
      setClassroomRosterError(
        err instanceof Error ? err.message : "Unable to load roster.",
      );
    });
    return () => {
      cancelled = true;
    };
  }, [mode, selectedFolderId, refreshRoster]);

  useEffect(() => {
    let cancelled = false;
    if (mode !== "teacher" || !selectedFolderId) {
      setStudentSubmissions([]);
      setStudentSubmissionsStatus("idle");
      return;
    }
    setStudentSubmissionsStatus("loading");
    supabase
      .from("student_submissions")
      .select(
        "id, folder_id, student_id, title, seed, music_xml, spec_json, melody_json, beats_per_measure, status, created_at",
      )
      .eq("folder_id", selectedFolderId)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setStudentSubmissionsStatus("error");
          setStudentSubmissionsError(error.message);
          return;
        }
        setStudentSubmissions((data ?? []) as StudentSubmissionItem[]);
        setStudentSubmissionsStatus("loaded");
      });
    return () => {
      cancelled = true;
    };
  }, [mode, selectedFolderId]);

  useEffect(() => {
    if (mode !== "teacher" || !selectedFolderId) {
      setTeacherProgressRows([]);
      return;
    }
    setTeacherProgressStatus("loading");
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.access_token) {
        setTeacherProgressStatus("error");
        setTeacherProgressError("Sign in again.");
        return;
      }
      const { supabaseUrl, anonKey } = getSupabaseEnv();
      if (!supabaseUrl || !anonKey) return;
      try {
        const response = await fetch(
          `${supabaseUrl}/functions/v1/get_progress_summary`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: anonKey,
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ folder_id: selectedFolderId }),
          },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof payload.error === "string"
              ? payload.error
              : "Unable to load progress.",
          );
        }
        setTeacherProgressRows(Array.isArray(payload.summary) ? payload.summary : []);
        setTeacherProgressStatus("loaded");
      } catch (err) {
        setTeacherProgressStatus("error");
        setTeacherProgressError(
          err instanceof Error ? err.message : "Unable to load progress.",
        );
      }
    });
  }, [mode, selectedFolderId, authUserId]);

  const createFolder = async () => {
    if (mode !== "teacher" || !authUserId) return;
    const name = newFolderName.trim();
    if (!name) return;
    setCreatingFolder(true);
    setFoldersError("");
    try {
      const { data, error } = await supabase
        .from("folders")
        .insert({ owner_id: authUserId, name })
        .select("id, name, join_code, is_published, default_spec_json")
        .single();
      if (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new Error("A class with that name already exists.");
        }
        throw new Error(error.message);
      }
      const newFolder = data as FolderItem;
      const { data: refreshed, error: refreshError } = await supabase
        .from("folders")
        .select("id, name, join_code, is_published, default_spec_json")
        .order("created_at", { ascending: true });
      if (refreshError) throw new Error(refreshError.message);
      setFolders((refreshed ?? []) as FolderItem[]);
      setSelectedFolderId(newFolder.id);
      setNewFolderName("");
    } catch (error) {
      setFoldersError(
        error instanceof Error
          ? error.message
          : "Unknown class create error.",
      );
    } finally {
      setCreatingFolder(false);
    }
  };

  const saveClassDefaults = async (spec: ExerciseSpec) => {
    if (mode !== "teacher" || !selectedFolderId) return;
    const normalized = normalizeSpec(spec);
    setClassroomDefaultsStatus("loading");
    try {
      const { error } = await supabase
        .from("folders")
        .update({ default_spec_json: normalized })
        .eq("id", selectedFolderId);
      if (error) throw new Error(error.message);
      setFolders((prev) =>
        prev.map((f) =>
          f.id === selectedFolderId ? { ...f, default_spec_json: normalized } : f,
        ),
      );
      setClassroomDefaultsStatus("loaded");
      setClassroomDefaultsMessage("Saved class defaults.");
    } catch (error) {
      setClassroomDefaultsStatus("error");
      setClassroomDefaultsMessage(
        error instanceof Error ? error.message : "Unable to save defaults.",
      );
    }
  };

  const clearClassDefaults = async () => {
    if (mode !== "teacher" || !selectedFolderId) return;
    setClassroomDefaultsStatus("loading");
    try {
      const { error } = await supabase
        .from("folders")
        .update({ default_spec_json: null })
        .eq("id", selectedFolderId);
      if (error) throw new Error(error.message);
      setFolders((prev) =>
        prev.map((f) =>
          f.id === selectedFolderId ? { ...f, default_spec_json: null } : f,
        ),
      );
      setClassroomDefaultsStatus("loaded");
      setClassroomDefaultsMessage("Cleared class defaults.");
    } catch (error) {
      setClassroomDefaultsStatus("error");
      setClassroomDefaultsMessage(
        error instanceof Error ? error.message : "Unable to clear defaults.",
      );
    }
  };

  const setClassroomAccess = async (rotateCode: boolean) => {
    if (mode !== "teacher" || !selectedFolderId) return;
    const passcode = classroomPasscode.trim();
    if (!passcode) {
      return {
        status: "error" as const,
        message: "Enter a passcode before updating.",
      };
    }
    setClassroomAccessStatus("saving");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("No active session.");
      const { supabaseUrl, anonKey } = getSupabaseEnv();
      if (!supabaseUrl || !anonKey) throw new Error("Missing env vars.");
      const join_code = rotateCode
        ? undefined
        : classroomJoinCode.trim().toUpperCase() || undefined;
      const res = await fetch(`${supabaseUrl}/functions/v1/set_classroom_access`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          folder_id: selectedFolderId,
          passcode,
          rotate_code: rotateCode,
          ...(rotateCode ? {} : { join_code }),
          publish: classroomPublish,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.classroom) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : res.statusText,
        );
      }
      const { data: refreshed } = await supabase
        .from("folders")
        .select("id, name, join_code, is_published, default_spec_json")
        .order("created_at", { ascending: true });
      setFolders((refreshed ?? []) as FolderItem[]);
      setClassroomLastPasscode(passcode);
      setClassroomPasscode("");
      setClassroomJoinCode((payload.classroom.join_code ?? "").toUpperCase());
      setClassroomAccessStatus("saved");
      setClassroomAccessMessage(
        rotateCode ? "Classroom code rotated." : "Classroom access updated.",
      );
    } catch (error) {
      setClassroomAccessStatus("error");
      setClassroomAccessMessage(
        error instanceof Error ? error.message : "Unable to set classroom access.",
      );
    }
  };

  const addRosterStudent = async () => {
    if (mode !== "teacher" || !selectedFolderId) return;
    const studentIdValue = newRosterStudentId.trim().toUpperCase();
    if (!studentIdValue) return;
    setRosterBusyId("__add__");
    setClassroomRosterError("");
    try {
      const { error } = await supabase
        .from("classroom_students")
        .insert({
          folder_id: selectedFolderId,
          student_id: studentIdValue,
          is_active: true,
        });
      if (error) throw new Error(error.message);
      setNewRosterStudentId("");
      await refreshRoster(selectedFolderId);
    } catch (error) {
      setClassroomRosterError(
        error instanceof Error ? error.message : "Unable to add student ID.",
      );
    } finally {
      setRosterBusyId(null);
    }
  };

  const bulkAddRosterStudents = async () => {
    if (mode !== "teacher" || !selectedFolderId) return;
    const ids = Array.from(
      new Set(
        bulkRosterStudentIds
          .split(/\r?\n/)
          .map((v) => v.trim().toUpperCase())
          .filter(Boolean),
      ),
    );
    if (ids.length === 0) return;
    setRosterBusyId("__bulk__");
    setClassroomRosterError("");
    try {
      const rows = ids.map((student_id) => ({
        folder_id: selectedFolderId,
        student_id,
        is_active: true,
      }));
      const { error } = await supabase
        .from("classroom_students")
        .upsert(rows, {
          onConflict: "folder_id,student_id",
          ignoreDuplicates: true,
        });
      if (error) throw new Error(error.message);
      setBulkRosterStudentIds("");
      await refreshRoster(selectedFolderId);
    } catch (error) {
      setClassroomRosterError(
        error instanceof Error ? error.message : "Unable to add student IDs.",
      );
    } finally {
      setRosterBusyId(null);
    }
  };

  const toggleRosterStudent = async (item: ClassroomStudentItem) => {
    if (mode !== "teacher" || !selectedFolderId) return;
    setRosterBusyId(item.id);
    try {
      const { error } = await supabase
        .from("classroom_students")
        .update({ is_active: !item.is_active })
        .eq("id", item.id);
      if (error) throw new Error(error.message);
      await refreshRoster(selectedFolderId);
    } catch (error) {
      setClassroomRosterError(
        error instanceof Error ? error.message : "Unable to update student.",
      );
    } finally {
      setRosterBusyId(null);
    }
  };

  const deleteRosterStudent = async (item: ClassroomStudentItem) => {
    if (mode !== "teacher" || !selectedFolderId) return;
    setRosterBusyId(item.id);
    try {
      const { error } = await supabase
        .from("classroom_students")
        .delete()
        .eq("id", item.id);
      if (error) throw new Error(error.message);
      await refreshRoster(selectedFolderId);
    } catch (error) {
      setClassroomRosterError(
        error instanceof Error ? error.message : "Unable to remove student.",
      );
    } finally {
      setRosterBusyId(null);
    }
  };

  const approveSubmission = async (submissionId: string) => {
    if (mode !== "teacher") return false;
    const { data: { session } } = await supabase.auth.getSession();
    const teacherToken = session?.access_token ?? "";
    if (!teacherToken) {
      setStudentSubmissionsError("Sign in again to approve.");
      return false;
    }
    const { supabaseUrl, anonKey } = getSupabaseEnv();
    if (!supabaseUrl || !anonKey) return false;
    setProcessingSubmissionId(submissionId);
    setStudentSubmissionsError("");
    try {
      const response = await fetch(
        `${supabaseUrl}/functions/v1/approve_submission`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: anonKey,
            Authorization: `Bearer ${teacherToken}`,
          },
          body: JSON.stringify({ submission_id: submissionId }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          (payload as { error?: string }).error || "Unable to approve.",
        );
      }
      const parsed = submissionApproveResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(
          `Invalid approve_submission response: ${parsed.error.issues
            .map((issue) => issue.path.join(".") || "(root)")
            .join(", ")}`,
        );
      }
      if (!parsed.data.ok) {
        throw new Error(
          (payload as { error?: string }).error || "Unable to approve.",
        );
      }
      setStudentSubmissions((prev) =>
        prev.filter((s) => s.id !== submissionId),
      );
      return true;
    } catch (error) {
      setStudentSubmissionsError(
        error instanceof Error ? error.message : "Unable to approve submission.",
      );
      return false;
    } finally {
      setProcessingSubmissionId(null);
    }
  };

  const rejectSubmission = async (submissionId: string) => {
    if (mode !== "teacher") return;
    setProcessingSubmissionId(submissionId);
    try {
      const { error } = await supabase
        .from("student_submissions")
        .update({ status: "rejected" })
        .eq("id", submissionId);
      if (error) throw new Error(error.message);
      setStudentSubmissions((prev) =>
        prev.filter((s) => s.id !== submissionId),
      );
    } catch (error) {
      setStudentSubmissionsError(
        error instanceof Error ? error.message : "Unable to reject submission.",
      );
    } finally {
      setProcessingSubmissionId(null);
    }
  };

  const onRosterSort = (key: RosterSortKey) => {
    setRosterSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  };

  return {
    folders,
    setFolders,
    selectedFolderId,
    setSelectedFolderId,
    folderFilterId,
    setFolderFilterId,
    newFolderName,
    setNewFolderName,
    creatingFolder,
    foldersError,
    folderNameById,
    selectedFolder,
    classroomPasscode,
    setClassroomPasscode,
    classroomJoinCode,
    setClassroomJoinCode,
    classroomPublish,
    setClassroomPublish,
    classroomAccessStatus,
    classroomAccessMessage,
    classroomLastPasscode,
    classroomDefaultsStatus,
    classroomDefaultsMessage,
    classroomRoster,
    classroomRosterStatus,
    classroomRosterError,
    newRosterStudentId,
    setNewRosterStudentId,
    bulkRosterStudentIds,
    setBulkRosterStudentIds,
    rosterBusyId,
    rosterSort,
    sortedClassroomRoster,
    teacherProgressByStudentId,
    studentSubmissions,
    studentSubmissionsStatus,
    studentSubmissionsError,
    processingSubmissionId,
    teacherProgressRows,
    teacherProgressStatus,
    teacherProgressError,
    createFolder,
    saveClassDefaults,
    clearClassDefaults,
    setClassroomAccess,
    addRosterStudent,
    bulkAddRosterStudents,
    toggleRosterStudent,
    deleteRosterStudent,
    approveSubmission,
    rejectSubmission,
    onRosterSort,
    rosterSortIndicator: (key: RosterSortKey) =>
      rosterSort.key === key
        ? rosterSort.direction === "asc"
          ? " ↑"
          : " ↓"
        : "",
  };
}
