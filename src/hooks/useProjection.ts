import { useEffect, useRef, useState } from "react";

export function useProjection(notationContainerRef: React.RefObject<HTMLDivElement | null>) {
  const [isProjectionMode, setIsProjectionMode] = useState(false);
  const [showProjectionControls, setShowProjectionControls] = useState(true);

  const wasFullscreenRef = useRef(false);
  const projectionControlsTimerRef = useRef<number | null>(null);

  const clearControlsTimer = () => {
    if (projectionControlsTimerRef.current !== null) {
      window.clearTimeout(projectionControlsTimerRef.current);
      projectionControlsTimerRef.current = null;
    }
  };

  const restartControlsTimer = () => {
    clearControlsTimer();
    projectionControlsTimerRef.current = window.setTimeout(() => {
      setShowProjectionControls(false);
    }, 2000);
  };

  const enter = async () => {
    setIsProjectionMode(true);
    const container = notationContainerRef.current;
    if (!container || !document.fullscreenEnabled || document.fullscreenElement) return;
    try {
      await container.requestFullscreen();
    } catch {
      // Fullscreen can be blocked by browser policy; projection layout still applies.
    }
  };

  const exit = async () => {
    setIsProjectionMode(false);
    if (!document.fullscreenElement) return;
    try {
      await document.exitFullscreen();
    } catch {
      // Ignore.
    }
  };

  const toggle = async () => {
    if (isProjectionMode) await exit();
    else await enter();
  };

  const handleMouseMove = () => {
    if (!isProjectionMode) return;
    setShowProjectionControls(true);
    restartControlsTimer();
  };

  // Sync with native fullscreen changes (e.g. user presses Esc)
  useEffect(() => {
    const onFullscreenChange = () => {
      const isFullscreenNow = Boolean(document.fullscreenElement);
      if (isFullscreenNow) {
        setIsProjectionMode(true);
      } else if (wasFullscreenRef.current) {
        setIsProjectionMode(false);
      }
      wasFullscreenRef.current = isFullscreenNow;
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // Keyboard shortcut: F to toggle
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTextInput =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;

      if (event.key === "Escape" && isProjectionMode) {
        event.preventDefault();
        void exit();
        return;
      }
      if (
        (event.key === "f" || event.key === "F") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isTextInput
      ) {
        event.preventDefault();
        void toggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isProjectionMode]);

  // Lock body scroll in projection mode
  useEffect(() => {
    document.body.style.overflow = isProjectionMode ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isProjectionMode]);

  // Controls auto-hide timer
  useEffect(() => {
    if (!isProjectionMode) {
      clearControlsTimer();
      setShowProjectionControls(true);
      return;
    }
    setShowProjectionControls(true);
    restartControlsTimer();
    return () => { clearControlsTimer(); setShowProjectionControls(true); };
  }, [isProjectionMode]);

  return {
    isProjectionMode,
    showProjectionControls,
    toggle,
    exit,
    enter,
    handleMouseMove,
  };
}