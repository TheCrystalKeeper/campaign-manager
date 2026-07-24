import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { writeLocalFlag } from "../lib/localFlags";
import { DM_STEPS } from "./steps/dmSteps";
import { PLAYER_STEPS } from "./steps/playerSteps";
import { TutorialOverlay } from "./TutorialOverlay";
import { TUTORIAL_POLL_MS, useAnchorRect } from "./useAnchorRect";
import type { TutorialActions, TutorialMode, TutorialSignals } from "./types";
import { checkTutorialCoverage } from "./coverage";

type TutorialControllerProps = {
  mode: TutorialMode;
  signals: TutorialSignals;
  actions: TutorialActions;
};

/**
 * Drives one walkthrough: owns the step index, snapshots signals on step entry
 * (the baseline advanceWhen predicates compare against), runs each step's
 * `before` hook, and marks hands-on steps done when their condition fires.
 * The user always advances manually — done just shows ✓ and relabels the
 * button. Finish writes the cm-tutorial-<mode>-done flag and leaves.
 */
export function TutorialController({ mode, signals, actions }: TutorialControllerProps) {
  const steps = useMemo(() => (mode === "dm" ? DM_STEPS : PLAYER_STEPS), [mode]);
  const [stepIndex, setStepIndex] = useState(0);
  const [actionDone, setActionDone] = useState(false);
  const step = steps[Math.min(stepIndex, steps.length - 1)];

  const signalsRef = useRef(signals);
  signalsRef.current = signals;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const baselineRef = useRef<TutorialSignals>(signals);

  useEffect(() => {
    if (import.meta.env.DEV) checkTutorialCoverage();
  }, []);

  // Step entry: prep the UI surface, then snapshot the baseline.
  useEffect(() => {
    setActionDone(false);
    step.before?.(actionsRef.current);
    baselineRef.current = signalsRef.current;
  }, [step]);

  const markDone = useCallback(() => setActionDone(true), []);

  const finish = useCallback(() => {
    writeLocalFlag(`cm-tutorial-${mode}-done`, true);
    actionsRef.current.leave();
  }, [mode]);

  const next = useCallback(() => {
    setStepIndex((current) => {
      if (current >= steps.length - 1) {
        finish();
        return current;
      }
      return current + 1;
    });
  }, [steps.length, finish]);

  const back = useCallback(() => {
    setStepIndex((current) => Math.max(0, current - 1));
  }, []);

  // Signal-side done condition.
  useEffect(() => {
    if (actionDone || !step.advanceWhen) return;
    if (step.advanceWhen(signals, baselineRef.current)) markDone();
  }, [signals, step, actionDone, markDone]);

  // DOM-side done condition, evaluated on the slow poll.
  useEffect(() => {
    if (actionDone || !step.advanceWhenDom) return;
    const check = () => {
      if (step.advanceWhenDom!()) markDone();
    };
    check();
    const interval = window.setInterval(check, TUTORIAL_POLL_MS);
    return () => window.clearInterval(interval);
  }, [step, actionDone, markDone]);

  const rect = useAnchorRect(step.anchor, signals);
  const popoverRect = useAnchorRect(step.popoverAnchor ?? step.anchor, signals);

  return (
    <TutorialOverlay
      step={step}
      rect={rect}
      popoverRect={popoverRect}
      stepIndex={stepIndex}
      stepCount={steps.length}
      actionDone={actionDone}
      onNext={next}
      onBack={back}
      onExit={() => actionsRef.current.leave()}
    />
  );
}
