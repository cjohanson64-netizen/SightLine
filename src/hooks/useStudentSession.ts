import { useEffect, useRef, useState } from "react";
import type { ExerciseSpec, MelodyEvent } from "../tat";
import {
  classroomExerciseLoadResponseSchema,
  classroomJoinResponseSchema,
} from "../data/schemas";

const STUDENT_TOKEN_KEY = "sightline_classroom_token";
const STUDENT_INFO_KEY = "sightline_classroom_info";
const STUDENT_INACTIVITY_MS = 2 * 60 * 1000;

export type StudentSession = {
  token: string;
  classroom: {
    id: string;
    name: string;
    join_code: string;
    student_id?: string;
  };
};

export type StudentProgressSummary = {
  total_minutes: number;
  total_attempts: number;
  last_practiced_at: string | null;
};

export type ClassroomExerciseItem = {
  id: string;
  seed: number;
  title: string;
  created_at: string;
  folder_id: string | null;
};

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
  const url = `${supabaseUrl}/functions/v1/${endpoint}`;
  const response = await fetch(url, {
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

export function useStudentSession() {
  const [studentSession, setStudentSession] = useState<StudentSession | null>(null);
  const [studentJoinCode, setStudentJoinCode] = useState("");
  const [studentPasscode, setStudentPasscode] = useState("");
  const [studentId, setStudentId] = useState("");
  const [studentPin, setStudentPin] = useState("");
  const [studentDisplayName, setStudentDisplayName] = useState("");
  const [studentJoinStatus, setStudentJoinStatus] = useState<
    "idle" | "joining" | "success" | "error"
  >("idle");
  const [studentJoinMessage, setStudentJoinMessage] = useState("");
  const [studentSubmitStatus, setStudentSubmitStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [studentSubmitMessage, setStudentSubmitMessage] = useState("");

  const [classroomExercises, setClassroomExercises] = useState<ClassroomExerciseItem[]>([]);
  const [classroomExercisesStatus, setClassroomExercisesStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [classroomExercisesError, setClassroomExercisesError] = useState("");
  const [loadingClassroomExerciseId, setLoadingClassroomExerciseId] = useState<string | null>(null);

  const [studentProgress, setStudentProgress] = useState<StudentProgressSummary>({
    total_minutes: 0,
    total_attempts: 0,
    last_practiced_at: null,
  });
  const [studentProgressStatus, setStudentProgressStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [studentProgressError, setStudentProgressError] = useState("");

  const [classroomDefaultSpec, setClassroomDefaultSpec] = useState<ExerciseSpec | null>(null);
  const [classroomDefaultsStatus, setClassroomDefaultsStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [classroomDefaultsMessage, setClassroomDefaultsMessage] = useState("");
  const [studentSpecBeforeDefaults, setStudentSpecBeforeDefaults] = useState<ExerciseSpec | null>(null);

  // Activity tracking refs
  const lastActivityAtRef = useRef<number>(0);
  const activeSessionStartAtRef = useRef<number | null>(null);
  const inactivityTimerIdRef = useRef<number | null>(null);

  // Restore session from localStorage on mount
  useEffect(() => {
    const token = window.localStorage.getItem(STUDENT_TOKEN_KEY);
    const rawInfo = window.localStorage.getItem(STUDENT_INFO_KEY);
    if (!token || !rawInfo) return;
    try {
      const classroom = JSON.parse(rawInfo) as StudentSession["classroom"];
      if (!classroom?.id || !classroom?.name || !classroom?.join_code) return;
      setStudentSession({ token, classroom });
      setStudentJoinStatus("success");
      setStudentJoinMessage(`Joined ${classroom.name}`);
    } catch {
      window.localStorage.removeItem(STUDENT_TOKEN_KEY);
      window.localStorage.removeItem(STUDENT_INFO_KEY);
    }
  }, []);

  const fetchProgressSummary = async (token: string) => {
    setStudentProgressStatus("loading");
    setStudentProgressError("");
    try {
      const payload = await callEdgeFunction("get_progress_summary", { token });
      setStudentProgress({
        total_minutes: Number(payload.total_minutes ?? 0),
        total_attempts: Number(payload.total_attempts ?? 0),
        last_practiced_at: typeof payload.last_practiced_at === "string"
          ? payload.last_practiced_at : null,
      });
      setStudentProgressStatus("loaded");
    } catch (error) {
      setStudentProgressStatus("error");
      setStudentProgressError(error instanceof Error ? error.message : "Unable to load progress.");
    }
  };

  const trackProgress = async (
    payload: { event_type: "stop" | "attempt"; exercise_id?: string | null; duration_seconds?: number | null },
    options?: { keepalive?: boolean },
  ) => {
    const token = studentSession?.token;
    if (!token) return;
    const { supabaseUrl, anonKey } = getSupabaseEnv();
    if (!supabaseUrl || !anonKey) return;
    try {
      await fetch(`${supabaseUrl}/functions/v1/track_progress`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        keepalive: options?.keepalive === true,
        body: JSON.stringify({ token, ...payload }),
      });
    } catch {
      // best-effort
    }
  };

  const clearInactivityTimer = () => {
    if (inactivityTimerIdRef.current !== null) {
      window.clearTimeout(inactivityTimerIdRef.current);
      inactivityTimerIdRef.current = null;
    }
  };

  const endActiveSession = async (options?: { keepalive?: boolean; refreshSummary?: boolean }) => {
    const token = studentSession?.token;
    if (!studentSession || !token) { clearInactivityTimer(); activeSessionStartAtRef.current = null; return; }
    const startAt = activeSessionStartAtRef.current;
    clearInactivityTimer();
    activeSessionStartAtRef.current = null;
    if (startAt === null) return;
    const durationSeconds = Math.max(0, Math.floor((Date.now() - startAt) / 1000));
    if (durationSeconds <= 0) return;
    await trackProgress({ event_type: "stop", duration_seconds: durationSeconds }, { keepalive: options?.keepalive });
    if (options?.refreshSummary !== false) void fetchProgressSummary(token);
  };

  const markActivity = (reason: string) => {
    const token = studentSession?.token;
    if (!studentSession || !token || document.visibilityState === "hidden") return;
    void reason;
    const now = Date.now();
    if (activeSessionStartAtRef.current === null) activeSessionStartAtRef.current = now;
    lastActivityAtRef.current = now;
    clearInactivityTimer();
    inactivityTimerIdRef.current = window.setTimeout(() => void endActiveSession(), STUDENT_INACTIVITY_MS);
  };

  // Visibility / unload cleanup
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") void endActiveSession();
    };
    const onBeforeUnload = () => void endActiveSession({ keepalive: true, refreshSummary: false });
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
      clearInactivityTimer();
    };
  }, [studentSession?.token]);

  // Load classroom exercises when session changes
  useEffect(() => {
    let cancelled = false;
    const token = studentSession?.token;
    if (!token) {
      setClassroomExercises([]);
      setClassroomExercisesStatus("idle");
      return;
    }
    setClassroomExercisesStatus("loading");
    callEdgeFunction("list_classroom_exercises", { token })
      .then(payload => {
        if (cancelled) return;
        setClassroomExercises(Array.isArray(payload.exercises) ? payload.exercises : []);
        setClassroomExercisesStatus("loaded");
        setClassroomExercisesError("");
      })
      .catch(err => {
        if (cancelled) return;
        setClassroomExercisesStatus("error");
        setClassroomExercisesError(err instanceof Error ? err.message : "Unable to load exercises.");
      });
    return () => { cancelled = true; };
  }, [studentSession]);

  // Load progress when session changes
  useEffect(() => {
    const token = studentSession?.token;
    if (!token) {
      setStudentProgress({ total_minutes: 0, total_attempts: 0, last_practiced_at: null });
      return;
    }
    void fetchProgressSummary(token);
  }, [studentSession]);

  // Load classroom defaults when session changes
  useEffect(() => {
    let cancelled = false;
    const token = studentSession?.token;
    if (!token) { setClassroomDefaultSpec(null); setClassroomDefaultsStatus("idle"); return; }
    setClassroomDefaultsStatus("loading");
    callEdgeFunction("get_classroom_defaults", { token })
      .then(payload => {
        if (cancelled) return;
        const rawSpec = payload.default_spec_json && typeof payload.default_spec_json === "object"
          ? (payload.default_spec_json as ExerciseSpec) : null;
        setClassroomDefaultSpec(rawSpec);
        setClassroomDefaultsStatus("loaded");
        setClassroomDefaultsMessage(rawSpec ? "" : "Teacher has not set defaults for this class.");
      })
      .catch(err => {
        if (cancelled) return;
        setClassroomDefaultsStatus("error");
        setClassroomDefaultsMessage(err instanceof Error ? err.message : "Unable to load defaults.");
      });
    return () => { cancelled = true; };
  }, [studentSession]);

  const join = async () => {
    const joinCode = studentJoinCode.trim().toUpperCase();
    const passcode = studentPasscode;
    const nextStudentId = studentId.trim().toUpperCase();
    const pin = studentPin.trim();
    const displayName = studentDisplayName.trim();

    if (!joinCode || !passcode || !nextStudentId) {
      setStudentJoinStatus("error");
      setStudentJoinMessage("Enter classroom code, passcode, and student ID.");
      return false;
    }
    setStudentJoinStatus("joining");
    setStudentJoinMessage("");
    try {
      const payload = await callEdgeFunction("join_classroom", {
        join_code: joinCode,
        passcode,
        student_id: nextStudentId,
        pin: pin || undefined,
        display_name: displayName || undefined,
      });
      const parsed = classroomJoinResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(
          `Invalid join_classroom response: ${parsed.error.issues
            .map((issue) => issue.path.join(".") || "(root)")
            .join(", ")}`,
        );
      }
      const { token, classroom } = parsed.data;
      const session: StudentSession = { token, classroom };
      window.localStorage.setItem(STUDENT_TOKEN_KEY, token);
      window.localStorage.setItem(STUDENT_INFO_KEY, JSON.stringify(classroom));
      setStudentSession(session);
      setStudentJoinStatus("success");
      setStudentJoinMessage(`Joined ${classroom.name}`);
      setStudentId("");
      setStudentPin("");
      return true;
    } catch (error) {
      setStudentJoinStatus("error");
      setStudentJoinMessage(error instanceof Error ? error.message : "Unable to join classroom.");
      return false;
    }
  };

  const leave = (onEndSession?: () => void) => {
    void endActiveSession({ keepalive: true, refreshSummary: false });
    window.localStorage.removeItem(STUDENT_TOKEN_KEY);
    window.localStorage.removeItem(STUDENT_INFO_KEY);
    setStudentSession(null);
    setStudentJoinStatus("idle");
    setStudentJoinMessage("");
    setStudentJoinCode("");
    setStudentPasscode("");
    setStudentId("");
    setStudentPin("");
    setStudentDisplayName("");
    setStudentSubmitStatus("idle");
    setStudentSubmitMessage("");
    setClassroomExercises([]);
    setClassroomExercisesStatus("idle");
    setClassroomExercisesError("");
    setLoadingClassroomExerciseId(null);
    setClassroomDefaultSpec(null);
    setClassroomDefaultsStatus("idle");
    setClassroomDefaultsMessage("");
    setStudentSpecBeforeDefaults(null);
    onEndSession?.();
  };

  const loadClassroomExercise = async (exerciseId: string) => {
    const token = studentSession?.token;
    if (!token || !exerciseId) return null;
    markActivity("load-start");
    setLoadingClassroomExerciseId(exerciseId);
    setClassroomExercisesError("");
    try {
      const payload = await callEdgeFunction("get_classroom_exercise", { token, exercise_id: exerciseId });
      const parsed = classroomExerciseLoadResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(
          `Invalid get_classroom_exercise response: ${parsed.error.issues
            .map((issue) => issue.path.join(".") || "(root)")
            .join(", ")}`,
        );
      }
      markActivity("load");
      void trackProgress({ event_type: "attempt", exercise_id: exerciseId });
      void fetchProgressSummary(token);
      return parsed.data.exercise as {
        id: string; seed: number; title: string; music_xml: string;
        spec_json: ExerciseSpec | null; melody_json: MelodyEvent[] | null;
        beats_per_measure: number | null; folder_id: string | null;
      };
    } catch (error) {
      setClassroomExercisesError(error instanceof Error ? error.message : "Unable to load exercise.");
      return null;
    } finally {
      setLoadingClassroomExerciseId(null);
    }
  };

  const submitToTeacher = async (payload: {
    title: string; seed: number; music_xml: string;
    spec_json: ExerciseSpec; melody_json: MelodyEvent[]; beats_per_measure: number;
  }) => {
    const token = studentSession?.token;
    if (!token) { setStudentSubmitStatus("error"); setStudentSubmitMessage("Join a classroom first."); return; }
    setStudentSubmitStatus("saving");
    setStudentSubmitMessage("");
    try {
      await callEdgeFunction("submit_exercise", { token, ...payload });
      setStudentSubmitStatus("saved");
      setStudentSubmitMessage("Submitted to teacher.");
    } catch (error) {
      setStudentSubmitStatus("error");
      setStudentSubmitMessage(error instanceof Error ? error.message : "Unable to submit exercise.");
    }
  };

  const applyTeacherSettings = (spec: ExerciseSpec, currentSpec: ExerciseSpec): ExerciseSpec | null => {
    if (!classroomDefaultSpec) {
      setClassroomDefaultsStatus("error");
      setClassroomDefaultsMessage("Teacher has not set defaults for this class.");
      return null;
    }
    setStudentSpecBeforeDefaults(prev => prev ?? currentSpec);
    setClassroomDefaultsMessage("Applied teacher settings.");
    return classroomDefaultSpec;
  };

  const resetToMySettings = (): ExerciseSpec | null => {
    if (!studentSpecBeforeDefaults) return null;
    const restored = studentSpecBeforeDefaults;
    setStudentSpecBeforeDefaults(null);
    setClassroomDefaultsMessage("Restored your previous settings.");
    return restored;
  };

  return {
    // Session
    studentSession,
    studentJoinCode, setStudentJoinCode,
    studentPasscode, setStudentPasscode,
    studentId, setStudentId,
    studentPin, setStudentPin,
    studentDisplayName, setStudentDisplayName,
    studentJoinStatus,
    studentJoinMessage, setStudentJoinMessage,
    studentSubmitStatus,
    studentSubmitMessage,
    // Classroom exercises
    classroomExercises,
    classroomExercisesStatus,
    classroomExercisesError,
    loadingClassroomExerciseId,
    // Progress
    studentProgress,
    studentProgressStatus,
    studentProgressError,
    // Defaults
    classroomDefaultSpec,
    classroomDefaultsStatus,
    classroomDefaultsMessage,
    studentSpecBeforeDefaults,
    // Actions
    join,
    leave,
    loadClassroomExercise,
    submitToTeacher,
    markActivity,
    trackProgress,
    applyTeacherSettings,
    resetToMySettings,
  };
}
