import {
  TOKEN_ENEMY_COLOR,
  TOKEN_ITEM_COLOR,
  type GameState,
  type Token,
} from "./types";

function tokenId(): string {
  return `token-${crypto.randomUUID().slice(0, 8)}`;
}

export function actorToken(
  state: GameState,
  sheetId: string | null,
  sceneId: string,
  x: number,
  y: number,
): Token {
  const record = sheetId ? state.sheets[sheetId] : null;
  const isPc = record?.kind === "pc";
  return {
    id: tokenId(),
    sceneId,
    x,
    y,
    label: record ? record.data.characterName || "Token" : "Token",
    color: TOKEN_ENEMY_COLOR,
    kind: isPc ? "player" : "enemy",
    imageUrl: record?.data.iconUrl ?? null,
    ownerPlayerId: isPc && record ? record.id : null,
    sheetId: record && !isPc ? record.id : null,
    conditions: [],
    showHp: "none",
  };
}

export function itemToken(
  state: GameState,
  itemId: string,
  sceneId: string,
  x: number,
  y: number,
): Token | null {
  const item = state.items[itemId];
  if (!item) return null;
  return {
    id: tokenId(),
    sceneId,
    x,
    y,
    label: item.name || "Item",
    color: TOKEN_ITEM_COLOR,
    kind: "item",
    imageUrl: item.iconUrl ?? null,
    ownerPlayerId: null,
    sheetId: null,
    itemId,
    conditions: [],
    showHp: "none",
  };
}
