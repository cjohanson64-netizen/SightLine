import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { saveExercise } from "../data/exercises";
import { exerciseLoadResponseSchema } from "../data/schemas";
import { generateExercise } from "../core/engine";
import type { ExerciseSpec, MelodyEvent } from "@/SightLine/domain/music";
import type {
  BatchPacketItem,
  PacketItem,
  SavedExerciseItem,
} from "./teacherLibraryTypes";
import { randomSeed } from "./teacherLibraryUtils";

interface UseTeacherExercisesOptions {
  authUserId: string | null;
  mode: "teacher" | "student" | "guest";
  normalizeSpec: (spec: ExerciseSpec) => ExerciseSpec;
  extractMelodyEvents: (artifact: {
    nodes: Array<{ kind: string; data: unknown }>;
  }) => MelodyEvent[];
  selectedFolderId: string;
  folderFilterId: string;
}

export function useTeacherExercises({
  authUserId,
  mode,
  normalizeSpec,
  extractMelodyEvents,
  selectedFolderId,
  folderFilterId,
}: UseTeacherExercisesOptions) {
  const [savedExercises, setSavedExercises] = useState<SavedExerciseItem[]>([]);
  const [savedExercisesStatus, setSavedExercisesStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [savedExercisesError, setSavedExercisesError] = useState("");
  const [savedExercisesNotice, setSavedExercisesNotice] = useState("");
  const [loadingSavedExerciseId, setLoadingSavedExerciseId] = useState<
    string | null
  >(null);
  const [deletingSavedExerciseId, setDeletingSavedExerciseId] = useState<
    string | null
  >(null);
  const [activeExerciseId, setActiveExerciseId] = useState<string | null>(null);

  const [classPackets, setClassPackets] = useState<PacketItem[]>([]);
  const [classPacketsStatus, setClassPacketsStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [classPacketsError, setClassPacketsError] = useState("");
  const [loadingPacketId] = useState<string | null>(null);
  const [deletingPacketId, setDeletingPacketId] = useState<string | null>(null);
  const [exportingPacketId, setExportingPacketId] = useState<string | null>(
    null,
  );
  const [selectedLibraryExerciseIds, setSelectedLibraryExerciseIds] = useState<
    Set<string>
  >(new Set());
  const [showCreatePacketFromSelectedModal, setShowCreatePacketFromSelectedModal] =
    useState(false);
  const [createPacketTitle, setCreatePacketTitle] = useState("");
  const [createPacketNotes, setCreatePacketNotes] = useState("");
  const [createPacketStatus, setCreatePacketStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [createPacketMessage, setCreatePacketMessage] = useState("");
  const [lastCreatedPacket, setLastCreatedPacket] = useState<PacketItem | null>(
    null,
  );
  const [deletingSelectedLibrary, setDeletingSelectedLibrary] = useState(false);

  const [showLibraryPreviewModal, setShowLibraryPreviewModal] = useState(false);
  const [libraryPreviewTitle, setLibraryPreviewTitle] = useState("");
  const [libraryPreviewMusicXml, setLibraryPreviewMusicXml] = useState("");
  const [libraryPreviewStatus, setLibraryPreviewStatus] = useState<
    "idle" | "loading" | "loaded" | "error"
  >("idle");
  const [libraryPreviewMessage, setLibraryPreviewMessage] = useState("");
  const [editingLibraryExerciseId, setEditingLibraryExerciseId] = useState<
    string | null
  >(null);
  const [editingLibraryTitle, setEditingLibraryTitle] = useState("");
  const [savingLibraryTitleId, setSavingLibraryTitleId] = useState<
    string | null
  >(null);

  const [batchCount, setBatchCount] = useState(10);
  const [batchTitlePrefix, setBatchTitlePrefix] = useState(
    "Period 1 - Exercise",
  );
  const [batchPacketTitle, setBatchPacketTitle] = useState("Class Packet");
  const [batchPacketNotes, setBatchPacketNotes] = useState("");
  const [batchFolderId, setBatchFolderId] = useState("");
  const [batchStatus, setBatchStatus] = useState<
    "idle" | "running" | "done" | "error"
  >("idle");
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });
  const [batchMessage, setBatchMessage] = useState("");

  const filteredSavedExercises = useMemo(
    () =>
      folderFilterId === "__ALL__"
        ? savedExercises
        : savedExercises.filter((e) => e.folder_id === folderFilterId),
    [savedExercises, folderFilterId],
  );

  const classLibraryExercises = useMemo(
    () =>
      !selectedFolderId
        ? []
        : savedExercises
            .filter((e) => e.folder_id === selectedFolderId)
            .sort((a, b) =>
              a.title.localeCompare(b.title, undefined, {
                numeric: true,
                sensitivity: "base",
              }),
            ),
    [savedExercises, selectedFolderId],
  );

  const refreshSavedExercises = useCallback(async () => {
    const { data, error } = await supabase
      .from("exercises")
      .select("id, seed, title, created_at, folder_id")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    setSavedExercises((data ?? []) as SavedExerciseItem[]);
    setSavedExercisesStatus("loaded");
    setSavedExercisesError("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!authUserId || mode !== "teacher") {
      setSavedExercises([]);
      setSavedExercisesStatus("idle");
      setSavedExercisesError("");
      return;
    }
    setSavedExercisesStatus("loading");
    refreshSavedExercises().catch((err) => {
      if (!cancelled) {
        setSavedExercisesStatus("error");
        setSavedExercisesError(
          err instanceof Error ? err.message : "Unknown error.",
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authUserId, mode, refreshSavedExercises]);

  const refreshPackets = useCallback(async (folderId: string) => {
    const { data, error } = await supabase
      .from("packets")
      .select("id, folder_id, title, notes, created_at")
      .eq("folder_id", folderId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    setClassPackets((data ?? []) as PacketItem[]);
    setClassPacketsStatus("loaded");
    setClassPacketsError("");
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (mode !== "teacher" || !selectedFolderId) {
      setClassPackets([]);
      setClassPacketsStatus("idle");
      return;
    }
    setClassPacketsStatus("loading");
    refreshPackets(selectedFolderId).catch((err) => {
      if (cancelled) return;
      setClassPacketsStatus("error");
      setClassPacketsError(
        err instanceof Error ? err.message : "Unable to load packets.",
      );
    });
    return () => {
      cancelled = true;
    };
  }, [mode, selectedFolderId, refreshPackets]);

  useEffect(() => {
    setSelectedLibraryExerciseIds(new Set());
    setShowCreatePacketFromSelectedModal(false);
    setCreatePacketStatus("idle");
    setCreatePacketMessage("");
    setLastCreatedPacket(null);
  }, [selectedFolderId]);

  const saveToSupabase = async (options: {
    forceInsert?: boolean;
    seed: number;
    title: string;
    musicXml: string;
    currentMelody: MelodyEvent[];
    pitchPatch: Record<string, unknown>;
    specSnapshot: ExerciseSpec;
    beatsPerMeasure: number;
  }) => {
    if (mode !== "teacher") {
      return { status: "error" as const, message: "Teacher mode only." };
    }
    if (!options.musicXml) {
      return { status: "error" as const, message: "Generate a melody first." };
    }

    try {
      const {
        forceInsert,
        seed,
        title,
        musicXml,
        specSnapshot,
        beatsPerMeasure,
        currentMelody,
      } = options;
      if (activeExerciseId && !forceInsert) {
        const { error } = await supabase
          .from("exercises")
          .update({
            seed,
            title,
            music_xml: musicXml,
            folder_id: selectedFolderId || null,
            spec_json: specSnapshot,
            melody_json: currentMelody,
            beats_per_measure: beatsPerMeasure,
          })
          .eq("id", activeExerciseId);
        if (error) throw new Error(error.message);
        setSavedExercises((prev) =>
          prev.map((e) =>
            e.id === activeExerciseId
              ? { ...e, seed, title, folder_id: selectedFolderId || null }
              : e,
          ),
        );
        return { status: "saved" as const, message: "Updated saved exercise" };
      }
      const inserted = await saveExercise({
        seed,
        title,
        musicXml,
        folderId: selectedFolderId || null,
        specJson: specSnapshot,
        melodyJson: currentMelody,
        beatsPerMeasure,
      });
      setActiveExerciseId(inserted.id);
      await refreshSavedExercises();
      return {
        status: "saved" as const,
        message: forceInsert ? "Saved as new exercise" : "Saved!",
      };
    } catch (error) {
      return {
        status: "error" as const,
        message: error instanceof Error ? error.message : "Unknown save error.",
      };
    }
  };

  const loadSavedExercise = async (id: string) => {
    if (mode !== "teacher" || !id) return null;
    setLoadingSavedExerciseId(id);
    setSavedExercisesError("");
    setSavedExercisesNotice("");
    try {
      const { data, error } = await supabase
        .from("exercises")
        .select(
          "id, seed, title, music_xml, folder_id, spec_json, melody_json, beats_per_measure",
        )
        .eq("id", id)
        .single();
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
        id: string;
        seed: number;
        title: string;
        music_xml: string;
        folder_id: string | null;
        spec_json: ExerciseSpec | null;
        melody_json: MelodyEvent[] | null;
        beats_per_measure: number | null;
      };
    } catch (error) {
      setSavedExercisesError(
        `Unable to load exercise: ${error instanceof Error ? error.message : "Unknown error."}`,
      );
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
      setSavedExercises((prev) => prev.filter((e) => e.id !== id));
      setSavedExercisesNotice("Deleted exercise.");
    } catch (error) {
      setSavedExercisesError(
        `Unable to delete exercise: ${error instanceof Error ? error.message : "Unknown error."}`,
      );
    } finally {
      setDeletingSavedExerciseId(null);
    }
  };

  const fetchPacketRenderItems = async (
    packetId: string,
  ): Promise<BatchPacketItem[]> => {
    const { data, error } = await supabase
      .from("packet_items")
      .select("position, exercise:exercises(id, seed, title, music_xml)")
      .eq("packet_id", packetId)
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? [])
      .map((row) => {
        const rawEx = row.exercise as
          | { id: string; seed: number; title: string; music_xml: string }
          | { id: string; seed: number; title: string; music_xml: string }[]
          | null;
        const ex = Array.isArray(rawEx) ? (rawEx[0] ?? null) : rawEx;
        if (!ex) return null;
        return {
          exerciseId: ex.id,
          seed: ex.seed,
          title: ex.title,
          musicXml: ex.music_xml,
          position: Number(row.position ?? 0),
        };
      })
      .filter((item): item is BatchPacketItem => item !== null);
  };

  const batchGenerate = async (spec: ExerciseSpec) => {
    if (mode !== "teacher" || !authUserId || !batchFolderId) {
      setBatchStatus("error");
      setBatchMessage(
        !authUserId ? "Sign in as teacher." : "Select a class for this packet.",
      );
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
      const { data: packetRow, error: packetError } = await supabase
        .from("packets")
        .insert({
          owner_id: authUserId,
          folder_id: batchFolderId,
          title: packetTitle,
          notes: packetNotes || null,
        })
        .select("id")
        .single();
      if (packetError || !packetRow) {
        throw new Error(packetError?.message ?? "Unable to create packet.");
      }
      packetId = packetRow.id;

      const indices = Array.from({ length: total }, (_, i) => i);
      for (let chunkStart = 0; chunkStart < total; chunkStart += CHUNK_SIZE) {
        const chunk = indices.slice(chunkStart, chunkStart + CHUNK_SIZE);
        const chunkResults = await Promise.all(
          chunk.map(async (index) => {
            let output: ReturnType<typeof generateExercise> | null = null;
            let generatedSeed = randomSeed();
            for (let attempt = 0; attempt < 5; attempt += 1) {
              generatedSeed = randomSeed();
              const candidate = generateExercise({ spec, seed: generatedSeed });
              if (candidate.status === "ok") {
                output = candidate;
                break;
              }
            }
            if (!output || output.status !== "ok") {
              throw new Error(
                `Unable to generate melody ${index + 1} with current constraints.`,
              );
            }
            const displayNumber = total - index;
            const itemTitle = `${titlePrefix} ${displayNumber}`;
            const specSnapshot = normalizeSpec({ ...spec, title: itemTitle });
            const melodyEvents = extractMelodyEvents(output.artifact);
            const beatsPerMeasure = Math.max(
              1,
              Number(specSnapshot.timeSig.split("/")[0]) || 4,
            );
            const inserted = await saveExercise({
              seed: generatedSeed,
              title: itemTitle,
              musicXml: output.musicXml,
              folderId: batchFolderId,
              specJson: specSnapshot,
              melodyJson: melodyEvents,
              beatsPerMeasure,
            });
            return {
              exerciseId: inserted.id,
              seed: generatedSeed,
              title: itemTitle,
              musicXml: output.musicXml,
              position: displayNumber,
            };
          }),
        );
        generatedItems.push(...chunkResults);
        setBatchProgress({
          current: Math.min(chunkStart + CHUNK_SIZE, total),
          total,
        });
      }

      const { error: itemsError } = await supabase
        .from("packet_items")
        .insert(
          generatedItems.map((item) => ({
            packet_id: packetId,
            exercise_id: item.exerciseId,
            position: item.position,
          })),
        );
      if (itemsError) throw new Error(itemsError.message);

      await refreshSavedExercises();
      await refreshPackets(batchFolderId);
      setBatchStatus("done");
      setBatchMessage(
        `Generated and saved packet with ${generatedItems.length} exercises.`,
      );
      return { packetId, items: generatedItems, packetTitle, packetNotes };
    } catch (error) {
      if (packetId) {
        await supabase.from("packet_items").delete().eq("packet_id", packetId);
        await supabase.from("packets").delete().eq("id", packetId);
      }
      setBatchStatus("error");
      setBatchMessage(
        error instanceof Error ? error.message : "Batch generation failed.",
      );
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
      setClassPackets((prev) => prev.filter((p) => p.id !== packetId));
    } catch (error) {
      setClassPacketsError(
        error instanceof Error ? error.message : "Unable to delete packet.",
      );
    } finally {
      setDeletingPacketId(null);
    }
  };

  const toggleLibraryExerciseSelection = (id: string) => {
    setSelectedLibraryExerciseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createPacketFromSelected = async () => {
    if (mode !== "teacher" || !authUserId || !selectedFolderId) return null;
    const chosen = classLibraryExercises.filter((e) =>
      selectedLibraryExerciseIds.has(e.id),
    );
    if (chosen.length === 0 || !createPacketTitle.trim()) return null;
    setCreatePacketStatus("saving");
    try {
      const { data: packetRow, error } = await supabase
        .from("packets")
        .insert({
          owner_id: authUserId,
          folder_id: selectedFolderId,
          title: createPacketTitle.trim(),
          notes: createPacketNotes.trim() || null,
        })
        .select("id, folder_id, title, notes, created_at")
        .single();
      if (error || !packetRow) {
        throw new Error(error?.message ?? "Unable to create packet.");
      }
      await supabase.from("packet_items").insert(
        chosen.map((e, i) => ({
          packet_id: packetRow.id,
          exercise_id: e.id,
          position: i + 1,
        })),
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
      setCreatePacketMessage(
        error instanceof Error ? error.message : "Unable to create packet.",
      );
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
      const { data, error } = await supabase
        .from("exercises")
        .select("title, music_xml")
        .eq("id", exerciseId)
        .single();
      if (error || !data?.music_xml) {
        throw new Error(error?.message ?? "Unable to load preview.");
      }
      setLibraryPreviewTitle(data.title ?? fallbackTitle);
      setLibraryPreviewMusicXml(data.music_xml);
      setLibraryPreviewStatus("loaded");
    } catch (error) {
      setLibraryPreviewStatus("error");
      setLibraryPreviewMessage(
        error instanceof Error ? error.message : "Unable to load preview.",
      );
    }
  };

  const saveLibraryTitleEdit = async (exerciseId: string) => {
    if (mode !== "teacher") return;
    const nextTitle = editingLibraryTitle.trim();
    if (!nextTitle) {
      setSavedExercisesError("Title cannot be empty.");
      return;
    }
    setSavingLibraryTitleId(exerciseId);
    setSavedExercisesError("");
    try {
      const { error } = await supabase
        .from("exercises")
        .update({ title: nextTitle })
        .eq("id", exerciseId);
      if (error) throw new Error(error.message);
      setSavedExercises((prev) =>
        prev.map((e) => (e.id === exerciseId ? { ...e, title: nextTitle } : e)),
      );
      setEditingLibraryExerciseId(null);
      setEditingLibraryTitle("");
    } catch (error) {
      setSavedExercisesError(
        error instanceof Error ? error.message : "Unable to update title.",
      );
    } finally {
      setSavingLibraryTitleId(null);
    }
  };

  const handleDeleteSelectedLibraryExercises = async () => {
    if (selectedLibraryExerciseIds.size === 0) return;
    const ids = Array.from(selectedLibraryExerciseIds);
    setDeletingSelectedLibrary(true);
    try {
      const { error } = await supabase.from("exercises").delete().in("id", ids);
      if (error) throw new Error(error.message);
      setSavedExercises((prev) =>
        prev.filter((e) => !selectedLibraryExerciseIds.has(e.id)),
      );
      setSelectedLibraryExerciseIds(new Set());
      setSavedExercisesNotice(
        `Deleted ${ids.length} exercise${ids.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setSavedExercisesError(
        error instanceof Error ? error.message : "Unable to delete selected.",
      );
    } finally {
      setDeletingSelectedLibrary(false);
    }
  };

  return {
    savedExercises,
    savedExercisesStatus,
    savedExercisesError,
    savedExercisesNotice,
    setSavedExercisesNotice,
    loadingSavedExerciseId,
    deletingSavedExerciseId,
    activeExerciseId,
    setActiveExerciseId,
    classPackets,
    classPacketsStatus,
    classPacketsError,
    loadingPacketId,
    deletingPacketId,
    exportingPacketId,
    setExportingPacketId,
    selectedLibraryExerciseIds,
    showCreatePacketFromSelectedModal,
    setShowCreatePacketFromSelectedModal,
    createPacketTitle,
    setCreatePacketTitle,
    createPacketNotes,
    setCreatePacketNotes,
    createPacketStatus,
    createPacketMessage,
    lastCreatedPacket,
    deletingSelectedLibrary,
    showLibraryPreviewModal,
    setShowLibraryPreviewModal,
    libraryPreviewTitle,
    libraryPreviewMusicXml,
    libraryPreviewStatus,
    libraryPreviewMessage,
    editingLibraryExerciseId,
    setEditingLibraryExerciseId,
    editingLibraryTitle,
    setEditingLibraryTitle,
    savingLibraryTitleId,
    batchCount,
    setBatchCount,
    batchTitlePrefix,
    setBatchTitlePrefix,
    batchPacketTitle,
    setBatchPacketTitle,
    batchPacketNotes,
    setBatchPacketNotes,
    batchFolderId,
    setBatchFolderId,
    batchStatus,
    batchProgress,
    batchMessage,
    filteredSavedExercises,
    classLibraryExercises,
    refreshSavedExercises,
    saveToSupabase,
    loadSavedExercise,
    deleteSavedExercise,
    refreshPackets,
    fetchPacketRenderItems,
    batchGenerate,
    openBatchModal,
    deletePacket,
    toggleLibraryExerciseSelection,
    handleSelectAllLibraryExercises: () =>
      setSelectedLibraryExerciseIds(
        new Set(classLibraryExercises.map((e) => e.id)),
      ),
    handleClearLibraryExerciseSelection: () =>
      setSelectedLibraryExerciseIds(new Set()),
    handleDeleteSelectedLibraryExercises,
    createPacketFromSelected,
    openLibraryPreview,
    closeLibraryPreview: () => {
      setShowLibraryPreviewModal(false);
      setLibraryPreviewStatus("idle");
      setLibraryPreviewMusicXml("");
    },
    startLibraryTitleEdit: (exercise: SavedExerciseItem) => {
      setEditingLibraryExerciseId(exercise.id);
      setEditingLibraryTitle(exercise.title);
      setSavedExercisesError("");
    },
    saveLibraryTitleEdit,
  };
}
