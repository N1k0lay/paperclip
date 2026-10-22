import { lazy } from "react";
import { useDialogActions, useDialogState } from "../context/DialogContext";
import { DeferredOverlay } from "./DeferredOverlay";

const NewIssueDialog = lazy(() => import("./NewIssueDialog").then((module) => ({ default: module.NewIssueDialog })));
const NewProjectDialog = lazy(() => import("./NewProjectDialog").then((module) => ({ default: module.NewProjectDialog })));
const NewGoalDialog = lazy(() => import("./NewGoalDialog").then((module) => ({ default: module.NewGoalDialog })));
const NewAgentDialog = lazy(() => import("./NewAgentDialog").then((module) => ({ default: module.NewAgentDialog })));

export function BoardDialogs() {
  const { newIssueOpen, newProjectOpen, newGoalOpen, newAgentOpen } = useDialogState();
  const { closeNewIssue, closeNewProject, closeNewGoal, closeNewAgent } = useDialogActions();
  return <>
    <DeferredOverlay requested={newIssueOpen} title="Новая задача" onClose={closeNewIssue}><NewIssueDialog /></DeferredOverlay>
    <DeferredOverlay requested={newProjectOpen} title="Новый проект" onClose={closeNewProject}><NewProjectDialog /></DeferredOverlay>
    <DeferredOverlay requested={newGoalOpen} title="Новая цель" onClose={closeNewGoal}><NewGoalDialog /></DeferredOverlay>
    <DeferredOverlay requested={newAgentOpen} title="Новый агент" onClose={closeNewAgent}><NewAgentDialog /></DeferredOverlay>
  </>;
}
