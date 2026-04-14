import { buildPacketHtml } from "../core/packet/renderPacketHtml";
import { useSolfege } from "./useSolfege";
import {
  BatchPacketItem,
  PacketItem,
  useTeacherLibrary,
} from "./useTeacherLibrary";
import type { ExerciseSpec } from "@/SightLine/domain/music";

type SolfegeState = ReturnType<typeof useSolfege>;
type TeacherState = ReturnType<typeof useTeacherLibrary>;

interface UsePacketActionsOptions {
  currentSpecSnapshot: ExerciseSpec | null;
  exportMusicXml: string;
  formatSavedDate: (value: string | null | undefined) => string;
  seed: number;
  solfege: Pick<
    SolfegeState,
    | "addSolfegeLyricsToMusicXml"
    | "solfegeMode"
    | "solfegeAccidentalMode"
    | "solfegeColorizeMode"
  >;
  spec: ExerciseSpec;
  teacher: Pick<
    TeacherState,
    | "batchGenerate"
    | "batchFolderId"
    | "fetchPacketRenderItems"
    | "folderNameById"
  >;
}

export function usePacketActions({
  currentSpecSnapshot,
  exportMusicXml,
  formatSavedDate,
  seed,
  solfege,
  spec,
  teacher,
}: UsePacketActionsOptions) {
  const handleExport = () => {
    if (!exportMusicXml) {
      return;
    }

    const blob = new Blob([exportMusicXml], {
      type: "application/vnd.recordare.musicxml+xml",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `exercise-${seed}.musicxml`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const openBatchPacketWindow = (
    items: BatchPacketItem[],
    packetMeta: {
      packetId: string | null;
      title: string;
      className: string;
      notes: string;
      generatedAt: string;
      generatedAtIso: string;
    },
    options?: { autoExportZip?: boolean },
  ) => {
    if (items.length === 0) {
      return;
    }

    const html = buildPacketHtml(items, packetMeta, options, {
      transformMusicXml: (musicXml) =>
        solfege.addSolfegeLyricsToMusicXml(musicXml, {
          solfegeMode: solfege.solfegeMode,
          accidentalMode: solfege.solfegeAccidentalMode,
          colorizeLyrics: solfege.solfegeColorizeMode !== "off",
          fallback: {
            key: currentSpecSnapshot?.key ?? spec.key,
            mode: currentSpecSnapshot?.mode ?? spec.mode,
          },
        }),
    });
    const packetWindow = window.open("", "_blank");
    packetWindow?.document.open();
    packetWindow?.document.write(html);
    packetWindow?.document.close();
  };

  const handleBatchGenerate = async () => {
    const result = await teacher.batchGenerate(spec);
    if (!result) {
      return;
    }

    const generatedAtIso = new Date().toISOString();
    openBatchPacketWindow(result.items, {
      packetId: result.packetId,
      title: result.packetTitle,
      className: teacher.folderNameById.get(teacher.batchFolderId) ?? "Class",
      notes: result.packetNotes,
      generatedAt: formatSavedDate(generatedAtIso),
      generatedAtIso,
    });
  };

  const handleOpenSavedPacket = async (packet: PacketItem) => {
    const items = await teacher.fetchPacketRenderItems(packet.id);
    if (!items || items.length === 0) {
      return;
    }

    openBatchPacketWindow(items, {
      packetId: packet.id,
      title: packet.title,
      className: teacher.folderNameById.get(packet.folder_id) ?? "Class",
      notes: packet.notes ?? "",
      generatedAt: formatSavedDate(packet.created_at),
      generatedAtIso: packet.created_at,
    });
  };

  const handleExportSavedPacketZip = async (packet: PacketItem) => {
    const items = await teacher.fetchPacketRenderItems(packet.id);
    if (!items || items.length === 0) {
      return;
    }

    openBatchPacketWindow(
      items,
      {
        packetId: packet.id,
        title: packet.title,
        className: teacher.folderNameById.get(packet.folder_id) ?? "Class",
        notes: packet.notes ?? "",
        generatedAt: formatSavedDate(packet.created_at),
        generatedAtIso: packet.created_at,
      },
      { autoExportZip: true },
    );
  };

  return {
    handleBatchGenerate,
    handleExport,
    handleExportSavedPacketZip,
    handleOpenSavedPacket,
  };
}
