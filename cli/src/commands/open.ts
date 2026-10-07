import type { Command } from "../command.ts";

// The studio in a browser: its Projects page, or one project's page. Over SSH
// or in a script, --print gives the address without opening anything.
const open: Command = {
  path: ["open"],
  args: "[project]",
  positionals: { min: 0, max: 1 },
  summary: "Open the studio (or a project's page) in the browser; --print only prints the address.",
  options: {
    print: { type: "boolean", description: "Print the address instead of opening it." },
  },
  examples: ["troupe open", "troupe open 'Cold brew' --print"],
  async run(ctx, { positionals, options }) {
    const path = positionals[0] ? `projects/${(await ctx.project(positionals[0])).id}` : "dashboard";
    const url = new URL(path, `${ctx.url}/`).href;
    const opened = options.print ? false : await ctx.io.openUrl(url);
    if (!options.print && !opened) ctx.note("No browser could be opened here: open the address yourself.");
    return { data: { url, opened }, text: url };
  },
};

export const openCommands: Command[] = [open];
