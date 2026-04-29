import type {
  OnsetSegmentationInput,
  OnsetSegmentationOutput,
} from "../types";
import type { OnsetSegmentationService } from "../types/services";

import { emptyOnsetSegmentationOutput } from "./onsetSegmentation/constants";
import { smoothMidiFloats, getFrameStepMs } from "./onsetSegmentation/frameUtils";
import { collectOnsetIndices } from "./onsetSegmentation/onsetDetection";
import { buildNoteEventCandidatesFromOnsets } from "./onsetSegmentation/candidateBuilder";
import {
  suppressTinyArtifacts,
  stabilizeTailCandidates,
  suppressPhrasePitchSpikes,
} from "./onsetSegmentation/candidateFilters";
import {
  resplitLongCandidates,
  recoverLongSpanSplits,
} from "./onsetSegmentation/spanSplitting";
import {
  reattachTrailingShortEvent,
  mergeAdjacentSamePitchEvents,
  softlyMergeTowardExpectedCount,
} from "./onsetSegmentation/eventMerging";

export const onsetSegmentationService: OnsetSegmentationService = {
  run(input: OnsetSegmentationInput): OnsetSegmentationOutput {
    if (!input.frames || input.frames.length === 0) {
      return emptyOnsetSegmentationOutput();
    }

    const smoothedMidiFloats = smoothMidiFloats(input.frames);
    const onsetIndices = collectOnsetIndices(input.frames, smoothedMidiFloats);
    const rawOnsetCandidateCount = onsetIndices.length;

    if (onsetIndices.length === 0) {
      return emptyOnsetSegmentationOutput();
    }

    const frameStepMs = getFrameStepMs(input.frames);
    const finalEndMs =
      input.frames[input.frames.length - 1].timeMs + frameStepMs;

    const noteEventCandidates = buildNoteEventCandidatesFromOnsets({
      frames: input.frames,
      onsetIndices,
      finalEndMs,
    });

    const suppressedCandidates = suppressTinyArtifacts(noteEventCandidates);
    const suppressedOnsetCount = Math.max(
      0,
      noteEventCandidates.length - suppressedCandidates.length,
    );

    const {
      candidates: resplitCandidates,
      resplitCount,
      rejectedResplitCount,
    } = resplitLongCandidates(suppressedCandidates);

    const {
      candidates: tailStableCandidates,
      suppressedTailCount,
    } = stabilizeTailCandidates(resplitCandidates);

    const {
      candidates: spikeSuppressedCandidates,
      suppressedSpikeCount,
    } = suppressPhrasePitchSpikes(tailStableCandidates);

    const {
      candidates: recoveredCandidates,
      resplitCount: recoveryResplitCount,
      rejectedResplitCount: recoveryRejectedResplitCount,
    } = recoverLongSpanSplits(spikeSuppressedCandidates);

    const noteEvents = recoveredCandidates.map(
      (candidate) => candidate.noteEvent,
    );

    const {
      noteEvents: trailingAdjustedNoteEvents,
      trailingReattachmentCount,
    } = reattachTrailingShortEvent(noteEvents);

    return {
      noteEvents: softlyMergeTowardExpectedCount(
        mergeAdjacentSamePitchEvents(trailingAdjustedNoteEvents),
        input.expectedNoteCount,
      ),
      rawOnsetCandidateCount,
      suppressedOnsetCount:
        suppressedOnsetCount + suppressedTailCount + suppressedSpikeCount,
      resplitCount: resplitCount + recoveryResplitCount,
      rejectedResplitCount:
        rejectedResplitCount + recoveryRejectedResplitCount,
      trailingReattachmentCount,
    };
  },
};