import { useCallback, useEffect, useRef } from "react";

export type CanvasInteractionKind =
  | "card-drag"
  | "canvas-pan"
  | "area-move"
  | "area-resize";

export interface CanvasInteractionSession {
  kind: CanvasInteractionKind;
  pointerId: number;
  owner?: HTMLElement;
  /** Keep click-like pointerdowns targetable until a gesture crosses its threshold. */
  captureOnBegin?: boolean;
  move: (event: PointerEvent) => void;
  commit: (event: PointerEvent) => void;
  cancel: () => void;
}

export interface CanvasInteractionController {
  begin: (session: CanvasInteractionSession) => boolean;
  cancel: () => boolean;
  isActive: (kind?: CanvasInteractionKind) => boolean;
}

function capturePointer(session: CanvasInteractionSession) {
  try {
    session.owner?.setPointerCapture?.(session.pointerId);
  } catch {
    // Pointer capture is an optional continuity aid. Window listeners remain the fallback.
  }
}

function releaseCapturedPointer(session: CanvasInteractionSession) {
  try {
    if (!session.owner?.hasPointerCapture?.(session.pointerId)) return;
    session.owner.releasePointerCapture(session.pointerId);
  } catch {
    // The owner may have left the DOM during cancellation or unmount.
  }
}

export function useCanvasInteractionSession(): CanvasInteractionController {
  const sessionRef = useRef<CanvasInteractionSession | null>(null);

  const cancel = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return false;
    sessionRef.current = null;
    releaseCapturedPointer(session);
    session.cancel();
    return true;
  }, []);

  const begin = useCallback((session: CanvasInteractionSession) => {
    if (sessionRef.current) return false;
    sessionRef.current = session;
    if (session.captureOnBegin !== false) capturePointer(session);
    return true;
  }, []);

  const isActive = useCallback((kind?: CanvasInteractionKind) => {
    const session = sessionRef.current;
    return Boolean(session && (!kind || session.kind === kind));
  }, []);

  useEffect(() => {
    function movePointer(event: PointerEvent) {
      const session = sessionRef.current;
      if (session && session.pointerId === event.pointerId) session.move(event);
    }

    function releasePointer(event: PointerEvent) {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      sessionRef.current = null;
      releaseCapturedPointer(session);
      session.commit(event);
    }

    function cancelPointer(event: PointerEvent) {
      if (sessionRef.current?.pointerId === event.pointerId) cancel();
    }

    window.addEventListener("pointermove", movePointer);
    window.addEventListener("pointerup", releasePointer);
    window.addEventListener("pointercancel", cancelPointer);
    window.addEventListener("blur", cancel);
    return () => {
      cancel();
      window.removeEventListener("pointermove", movePointer);
      window.removeEventListener("pointerup", releasePointer);
      window.removeEventListener("pointercancel", cancelPointer);
      window.removeEventListener("blur", cancel);
    };
  }, [cancel]);

  return { begin, cancel, isActive };
}
