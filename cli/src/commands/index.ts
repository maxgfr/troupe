import type { Command } from "../command.ts";
import { authCommands } from "./auth.ts";
import { chatCommands } from "./chat.ts";
import { compareCommands } from "./compare.ts";
import { exportCommands } from "./export.ts";
import { libraryCommands } from "./library.ts";
import { modelCommands } from "./models.ts";
import { openCommands } from "./open.ts";
import { projectCommands } from "./projects.ts";
import { renderCommands } from "./render.ts";
import { scriptCommands } from "./script.ts";

// In the order help lists them: the order of the work.
export const COMMANDS: Command[] = [
  ...authCommands,
  ...openCommands,
  ...modelCommands,
  ...projectCommands,
  ...scriptCommands,
  ...chatCommands,
  ...renderCommands,
  ...compareCommands,
  ...exportCommands,
  ...libraryCommands,
];
