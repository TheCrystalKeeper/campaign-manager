import { MAP_TOOLS, toolsForRole } from "../map/tools/registry";
import { PANELS } from "../panels/registry";
import { DM_STEPS } from "./steps/dmSteps";
import { PLAYER_STEPS } from "./steps/playerSteps";
import type { TutorialStep } from "./types";

/**
 * Dev-mode drift alarm (the project has no test runner, so this runs once when a
 * tutorial mounts under `import.meta.env.DEV` and is dead code in prod builds):
 *
 *  - a map tool or dockable panel visible to a role with NO step anchoring it →
 *    a feature was added but the tour doesn't teach it. Add a step, or add the
 *    id to the exempt set below with a reason.
 *  - a step anchoring a tool/panel id that no longer exists in the registries →
 *    a feature was removed/renamed. Delete or retarget the step.
 *
 * Steps also degrade gracefully at runtime (missing anchors → centered popover,
 * Skip step always works) — this check exists so drift gets FIXED, not survived.
 */

/** Features deliberately not given their own step, with the reason on record. */
const TUTORIAL_EXEMPT: Record<"dm" | "player", Set<string>> = {
  // Select is the default tool; the dm-toolbar overview step covers it in copy.
  dm: new Set(["tool:select"]),
  player: new Set([]),
};

function anchorSelectors(steps: TutorialStep[]): string {
  return steps
    .map((step) =>
      step.anchor.kind === "selector" || step.anchor.kind === "selectorAll"
        ? step.anchor.selector
        : "",
    )
    .join("\n");
}

function checkMode(mode: "dm" | "player", steps: TutorialStep[]): string[] {
  const problems: string[] = [];
  const anchors = anchorSelectors(steps);
  const exempt = TUTORIAL_EXEMPT[mode];
  const isDm = mode === "dm";

  for (const tool of toolsForRole(isDm)) {
    if (exempt.has(`tool:${tool.id}`)) continue;
    if (!anchors.includes(`data-tool-id="${tool.id}"`)) {
      problems.push(`${mode} tour: map tool "${tool.id}" has no step anchoring it`);
    }
  }
  for (const panel of PANELS.filter((p) => p.dockable && p.roles.includes(mode))) {
    if (exempt.has(`panel:${panel.id}`)) continue;
    if (!anchors.includes(`data-dock-tab="${panel.id}"`)) {
      problems.push(`${mode} tour: dock panel "${panel.id}" has no step anchoring it`);
    }
  }

  // Reverse direction: every anchored tool/panel id must still exist.
  for (const step of steps) {
    if (step.anchor.kind !== "selector" && step.anchor.kind !== "selectorAll") continue;
    const toolRef = step.anchor.selector.match(/data-tool-id="([^"]+)"/)?.[1];
    if (toolRef && !MAP_TOOLS.some((tool) => tool.id === toolRef)) {
      problems.push(`${mode} tour: step "${step.id}" anchors removed tool "${toolRef}"`);
    }
    const panelRef = step.anchor.selector.match(/data-dock-tab="([^"]+)"/)?.[1];
    if (panelRef && !PANELS.some((panel) => panel.id === panelRef)) {
      problems.push(`${mode} tour: step "${step.id}" anchors removed panel "${panelRef}"`);
    }
  }
  return problems;
}

let reported = false;

export function checkTutorialCoverage(): void {
  if (reported) return;
  reported = true;
  const problems = [...checkMode("dm", DM_STEPS), ...checkMode("player", PLAYER_STEPS)];
  if (problems.length > 0) {
    console.error(
      `[tutorial] coverage drift — the walkthroughs are out of sync with the feature registries:\n` +
        problems.map((p) => `  • ${p}`).join("\n") +
        `\nAdd/retarget steps in src/tutorial/steps/, or record an exemption in src/tutorial/coverage.ts.`,
    );
  }
}
