import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { WorkspaceRepository } from "../data/workspaceRepository";
import type { Workspace } from "../domain/canvas";

export type WorkspaceSaveState = "loading" | "saving" | "saved" | "error";

export interface WorkspaceCommitOptions {
  undo?: boolean;
  persistence?: "immediate" | "debounced" | "none";
}

export interface WorkspaceController {
  workspace: Workspace | null;
  workspaceRef: MutableRefObject<Workspace | null>;
  saveState: WorkspaceSaveState;
  loadFailed: boolean;
  undoCount: number;
  commit: (next: Workspace, options?: WorkspaceCommitOptions) => void;
  undo: () => Workspace | null;
  retryLoad: () => Promise<void>;
  retrySave: () => void;
}

export function useWorkspaceController(repository: WorkspaceRepository): WorkspaceController {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [saveState, setSaveState] = useState<WorkspaceSaveState>("loading");
  const [loadFailed, setLoadFailed] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const workspaceRef = useRef<Workspace | null>(null);
  const undoHistoryRef = useRef<Workspace[]>([]);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveVersionRef = useRef(0);
  const debouncedSaveTimerRef = useRef<number | null>(null);
  const pendingDebouncedWorkspaceRef = useRef<Workspace | null>(null);

  useEffect(() => {
    let cancelled = false;
    repository.load()
      .then((loaded) => {
        if (cancelled) return;
        workspaceRef.current = loaded;
        setWorkspace(loaded);
        setLoadFailed(false);
        setSaveState("saved");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadFailed(true);
        setSaveState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  useEffect(() => () => {
    if (debouncedSaveTimerRef.current === null) return;
    window.clearTimeout(debouncedSaveTimerRef.current);
    debouncedSaveTimerRef.current = null;
    const pending = pendingDebouncedWorkspaceRef.current;
    pendingDebouncedWorkspaceRef.current = null;
    if (pending) {
      // Flush the last viewport through the same serial queue as ordinary
      // saves. Calling the repository directly here lets an in-flight older
      // write finish after the newer one and restore stale local content.
      const operation = saveQueueRef.current
        .catch(() => undefined)
        .then(() => repository.save(pending));
      saveQueueRef.current = operation;
      void operation.catch(() => undefined);
    }
  }, [repository]);

  const cancelDebouncedSave = useCallback(() => {
    if (debouncedSaveTimerRef.current !== null) {
      window.clearTimeout(debouncedSaveTimerRef.current);
      debouncedSaveTimerRef.current = null;
    }
    pendingDebouncedWorkspaceRef.current = null;
  }, []);

  const persist = useCallback((next: Workspace) => {
    cancelDebouncedSave();
    const version = saveVersionRef.current + 1;
    saveVersionRef.current = version;
    setSaveState("saving");
    const operation = saveQueueRef.current
      .catch(() => undefined)
      .then(() => repository.save(next));
    saveQueueRef.current = operation;
    operation
      .then(() => {
        if (version === saveVersionRef.current) setSaveState("saved");
      })
      .catch(() => {
        if (version === saveVersionRef.current) setSaveState("error");
      });
  }, [cancelDebouncedSave, repository]);

  const schedulePersist = useCallback((next: Workspace) => {
    pendingDebouncedWorkspaceRef.current = next;
    if (debouncedSaveTimerRef.current !== null) window.clearTimeout(debouncedSaveTimerRef.current);
    debouncedSaveTimerRef.current = window.setTimeout(() => {
      const pending = pendingDebouncedWorkspaceRef.current;
      debouncedSaveTimerRef.current = null;
      pendingDebouncedWorkspaceRef.current = null;
      if (pending) persist(pending);
    }, 120);
  }, [persist]);

  const commit = useCallback((next: Workspace, options: WorkspaceCommitOptions = {}) => {
    const previous = workspaceRef.current;
    if (options.undo && previous) {
      undoHistoryRef.current.push(previous);
      if (undoHistoryRef.current.length > 30) undoHistoryRef.current.shift();
      setUndoCount(undoHistoryRef.current.length);
    }
    workspaceRef.current = next;
    setWorkspace(next);
    if (options.persistence === "debounced") schedulePersist(next);
    else if (options.persistence !== "none") persist(next);
  }, [persist, schedulePersist]);

  const undo = useCallback(() => {
    const previous = undoHistoryRef.current.pop();
    if (!previous) return null;
    workspaceRef.current = previous;
    setWorkspace(previous);
    setUndoCount(undoHistoryRef.current.length);
    persist(previous);
    return previous;
  }, [persist]);

  const retryLoad = useCallback(async () => {
    setLoadFailed(false);
    setSaveState("loading");
    try {
      const loaded = await repository.load();
      workspaceRef.current = loaded;
      setWorkspace(loaded);
      setLoadFailed(false);
      setSaveState("saved");
    } catch {
      setLoadFailed(true);
      setSaveState("error");
    }
  }, [repository]);

  const retrySave = useCallback(() => {
    const current = workspaceRef.current;
    if (current) persist(current);
  }, [persist]);

  return {
    workspace,
    workspaceRef,
    saveState,
    loadFailed,
    undoCount,
    commit,
    undo,
    retryLoad,
    retrySave,
  };
}
