// Where a project stands, as the dashboard shows it. The stored status only
// records the wizard (draft until it is finished, then scripting); the rest
// follows from the project's renders and exports, so it never goes stale:
//
//   scripting   no finished video yet (writing, or every render failed)
//   generating  a render is queued or running
//   review      a finished video waits to be checked and exported
//   done        a video was exported
export type ProjectStage = "draft" | "scripting" | "generating" | "review" | "done";

export function projectStage(input: {
  stored: ProjectStage;
  running: number;
  finished: number;
  exported: number;
}): ProjectStage {
  if (input.stored === "draft") return "draft";
  if (input.running > 0) return "generating";
  if (input.exported > 0) return "done";
  if (input.finished > 0) return "review";
  return "scripting";
}

export const STAGE_LABELS: Record<ProjectStage, string> = {
  draft: "Draft",
  scripting: "Script",
  generating: "Rendering",
  review: "To review",
  done: "Exported",
};
