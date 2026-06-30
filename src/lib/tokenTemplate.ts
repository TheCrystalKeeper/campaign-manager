import type { Scene, Token } from "./types";

export type TokenTemplateCategory = "enemy" | "object" | "item" | "npc" | "other";

export type TokenTemplate = {
  id: string;
  name: string;
  label: string;
  category: TokenTemplateCategory;
  color: string;
  imageUrl: string | null;
};

export const TOKEN_TEMPLATE_CATEGORIES: { value: TokenTemplateCategory; label: string }[] = [
  { value: "enemy", label: "Enemy" },
  { value: "npc", label: "NPC" },
  { value: "object", label: "Object" },
  { value: "item", label: "Item" },
  { value: "other", label: "Other" },
];

const CATEGORY_COLORS: Record<TokenTemplateCategory, string> = {
  enemy: "#c45c5c",
  npc: "#9b59b6",
  object: "#8b7355",
  item: "#5c8ec4",
  other: "#7f8c8d",
};

/// <summary>
/// Returns the default ring color for a token template category.
/// </summary>
export function defaultColorForTokenCategory(category: TokenTemplateCategory): string {
  return CATEGORY_COLORS[category];
}

/// <summary>
/// Creates a new empty token template with sensible defaults.
/// </summary>
export function createTokenTemplate(
  name = "New token",
  category: TokenTemplateCategory = "enemy",
): TokenTemplate {
  return {
    id: `tmpl-${crypto.randomUUID().slice(0, 8)}`,
    name,
    label: name,
    category,
    color: defaultColorForTokenCategory(category),
    imageUrl: null,
  };
}

/// <summary>
/// Normalizes a persisted token template record.
/// </summary>
export function normalizeTokenTemplate(template: TokenTemplate): TokenTemplate {
  const category = TOKEN_TEMPLATE_CATEGORIES.some((item) => item.value === template.category)
    ? template.category
    : "other";
  const name = template.name?.trim() || "Token";
  return {
    ...template,
    name,
    label: template.label?.trim() || name,
    category,
    color: template.color || defaultColorForTokenCategory(category),
    imageUrl: template.imageUrl ?? null,
  };
}

/// <summary>
/// Places a map token on a scene from a saved library template.
/// </summary>
export function tokenFromTemplate(template: TokenTemplate, scene: Scene): Token {
  const normalized = normalizeTokenTemplate(template);
  return {
    id: `token-${crypto.randomUUID().slice(0, 8)}`,
    sceneId: scene.id,
    x: scene.centerX ?? scene.width / 2,
    y: scene.centerY ?? scene.height / 2,
    label: normalized.label,
    kind: "enemy",
    color: normalized.color,
    imageUrl: normalized.imageUrl,
    ownerPlayerId: null,
  };
}
