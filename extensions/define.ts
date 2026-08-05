import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WAYFINDER_SKILL = "wayfinder";
const GREENFIELD = "Greenfield";
const DRAFT_SPEC = "Draft a settled spec";

export default function defineExtension(pi: ExtensionAPI): void {
  pi.registerCommand("define", {
    description: "Define an idea through a wayfinder-first interview",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/define requires an interactive session.", "warning");
        return;
      }

      if (!ctx.isIdle()) {
        ctx.ui.notify("Wait for the current agent run to finish before starting /define.", "warning");
        return;
      }

      const wayfinder = ctx
        .getSystemPromptOptions()
        .skills
        ?.find((skill) => skill.name === WAYFINDER_SKILL);
      if (!wayfinder) {
        ctx.ui.notify(`The ${WAYFINDER_SKILL} skill is not loaded.`, "error");
        return;
      }

      let content: string;
      try {
        content = await readFile(wayfinder.filePath, "utf8");
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Could not load the ${WAYFINDER_SKILL} skill: ${details}`, "error");
        return;
      }

      const kind = await ctx.ui.select("What kind of idea is this?", ["Existing project", GREENFIELD]);
      if (!kind) return;

      const beat = await ctx.ui.select("What should happen next?", ["Chart with wayfinder", DRAFT_SPEC]);
      if (!beat) return;

      if (beat === DRAFT_SPEC) {
        pi.events.emit("subagents:rpc:v1:request", {
          version: 1,
          requestId: randomUUID(),
          method: "spawn",
          params: {
            agent: "writer",
            context: "fresh",
            cwd: ctx.cwd,
            task: [
              "Draft a decision-complete specification from the settled decisions. Surface unresolved decisions instead of inventing them.",
              args.trim() ? `Idea:\n${args.trim()}` : "",
            ].filter(Boolean).join("\n\n"),
          },
        });
        return;
      }

      pi.sendUserMessage([
        `${kind === GREENFIELD ? "This is a greenfield idea, so it must use the wayfinder route." : "Begin by charting this idea with wayfinder."}`,
        "Chart the route before proposing implementation. State the destination, map the frontier, and identify whether fog remains.",
        "",
        `<skill name="${WAYFINDER_SKILL}" location="${wayfinder.filePath}">`,
        content.trim(),
        "</skill>",
        args.trim() ? `\nIdea:\n${args.trim()}` : "",
      ].join("\n"));
    },
  });
}
