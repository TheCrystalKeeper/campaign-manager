import type { StatblockApplyMode } from "../../lib/compendiumMap";
import { ApplyModeModal, type ApplyChoice } from "../ApplyModeModal";

/// <summary>
/// Shown after the DM picks a monster to apply onto an NPC that already has
/// content. Singular stats (HP/AC/abilities/...) are always replaced; this asks
/// how to handle the NPC's existing actions, features, and pill lists. The NPC's
/// name and alignment are always kept. A thin config over ApplyModeModal.
/// </summary>
export function StatblockApplyModal({
  monsterName,
  onChoose,
  onClose,
}: {
  monsterName: string;
  onChoose: (mode: StatblockApplyMode) => void;
  onClose: () => void;
}) {
  const choices: ApplyChoice<StatblockApplyMode>[] = [
    {
      mode: "add",
      label: "Add to existing",
      hint: `Keep this NPC's actions & features and add ${monsterName}'s on top.`,
    },
    {
      mode: "stats",
      label: "Stats only",
      hint: "Only update HP, AC, abilities and other numbers. Leave actions & features as they are.",
    },
    {
      mode: "replace",
      label: "Replace",
      hint: `Overwrite this NPC's actions & features with ${monsterName}'s.`,
    },
  ];

  return (
    <ApplyModeModal
      title={`Apply ${monsterName}'s stat block`}
      intro="The numbers (HP, AC, abilities, speed, senses…) will be replaced. This NPC keeps its own name. How should its actions & features be handled?"
      choices={choices}
      onChoose={onChoose}
      onClose={onClose}
    />
  );
}
