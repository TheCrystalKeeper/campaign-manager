import { useCallback, useRef, useState } from "react";
import type { ClientMessage, GameState } from "./types";
import { sceneMessageSceneId } from "./sceneMessages";

/// <summary>
/// Client-side, DM-only undo/redo for map edits (annotations, fog, walls, lights) and
/// tokens (add / move / update / delete). Each edit is recorded as a command/inverse pair
/// built from existing messages — no server or protocol changes. Undo/redo replay the
/// stored messages through the same `send` channel the edit used.
/// </summary>

const MAX_HISTORY = 40;

type HistoryEntry = {
  send: (msg: ClientMessage) => void;
  /** Message that reverses the edit. */
  undo: ClientMessage;
  /** Message that re-applies it. */
  redo: ClientMessage;
};

/// <summary>
/// Builds the inverse of a mutating message from the pre-edit state, or null when the
/// message isn't undoable. Scene-shape edits (fog/walls/lights/annotations) all invert to
/// an `UPDATE_SCENE` restoring the pre-edit scene; token ops invert per kind.
/// </summary>
export function buildInverse(
  state: GameState,
  msg: ClientMessage,
): { undo: ClientMessage; redo: ClientMessage } | null {
  // Ephemeral annotations (pointer-arrow pings, fading strokes) auto-expire — keep them
  // out of the undo history so a "look here" ping isn't an undo step.
  if (msg.type === "ADD_ANNOTATION" && (msg.annotation.ephemeral || msg.annotation.kind === "arrow")) {
    return null;
  }
  const sceneId = sceneMessageSceneId(msg);
  if (sceneId) {
    const scene = state.scenes.find((s) => s.id === sceneId);
    if (!scene) {
      return null;
    }
    return { undo: { type: "UPDATE_SCENE", scene }, redo: msg };
  }
  switch (msg.type) {
    case "ADD_TOKEN":
      return { undo: { type: "REMOVE_TOKEN", tokenId: msg.token.id }, redo: msg };
    case "REMOVE_TOKEN": {
      const token = state.tokens.find((t) => t.id === msg.tokenId);
      return token ? { undo: { type: "ADD_TOKEN", token }, redo: msg } : null;
    }
    case "MOVE_TOKEN": {
      const token = state.tokens.find((t) => t.id === msg.tokenId);
      return token ? { undo: { type: "UPDATE_TOKEN", token }, redo: msg } : null;
    }
    case "UPDATE_TOKEN": {
      const token = state.tokens.find((t) => t.id === msg.token.id);
      return token ? { undo: { type: "UPDATE_TOKEN", token }, redo: msg } : null;
    }
    default:
      return null;
  }
}

export type History = {
  /** Record an entry (clears the redo stack). */
  record: (entry: HistoryEntry) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  reset: () => void;
};

export function useHistory(): History {
  const undoRef = useRef<HistoryEntry[]>([]);
  const redoRef = useRef<HistoryEntry[]>([]);
  // Bump to re-render the buttons when the stacks change (refs hold the truth so that
  // replaying an entry never runs a side effect inside a setState updater).
  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const record = useCallback(
    (entry: HistoryEntry) => {
      undoRef.current = [...undoRef.current, entry].slice(-MAX_HISTORY);
      redoRef.current = [];
      bump();
    },
    [bump],
  );

  const undo = useCallback(() => {
    const stack = undoRef.current;
    if (stack.length === 0) {
      return;
    }
    const entry = stack[stack.length - 1];
    undoRef.current = stack.slice(0, -1);
    redoRef.current = [...redoRef.current, entry];
    entry.send(entry.undo);
    bump();
  }, [bump]);

  const redo = useCallback(() => {
    const stack = redoRef.current;
    if (stack.length === 0) {
      return;
    }
    const entry = stack[stack.length - 1];
    redoRef.current = stack.slice(0, -1);
    undoRef.current = [...undoRef.current, entry];
    entry.send(entry.redo);
    bump();
  }, [bump]);

  const reset = useCallback(() => {
    undoRef.current = [];
    redoRef.current = [];
    bump();
  }, [bump]);

  return {
    record,
    undo,
    redo,
    canUndo: undoRef.current.length > 0,
    canRedo: redoRef.current.length > 0,
    reset,
  };
}
