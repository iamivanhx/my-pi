import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WAYFINDER_SKILL = "wayfinder";
const GREENFIELD = "Greenfield";
const DRAFT_SPEC = "Draft a settled spec";
const RESEARCH_TICKET = "Resolve a research ticket";
const PROTOTYPE = "Prototype look or behavior";
const THREAT_MODEL = "Apply threat-model lens";
const OBSERVABILITY = "Apply observability lens";

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

      const skills = ctx.getSystemPromptOptions().skills ?? [];
      const kind = await ctx.ui.select("What kind of idea is this?", ["Existing project", GREENFIELD]);
      if (!kind) return;

      if (kind !== GREENFIELD) {
        const beat = await ctx.ui.select("What should happen next?", [
          "Chart with wayfinder",
          DRAFT_SPEC,
          RESEARCH_TICKET,
          PROTOTYPE,
          THREAT_MODEL,
          OBSERVABILITY,
        ]);
        if (!beat) return;

        if (beat === PROTOTYPE) {
          const prototype = skills.find((skill) => skill.name === "prototype");
          if (!prototype) {
            ctx.ui.notify("The prototype skill is not loaded.", "error");
            return;
          }
          try {
            const content = await readFile(prototype.filePath, "utf8");
            pi.sendUserMessage([
              "The key unknown is look or behavior. Take the prototype detour before continuing the define flow.",
              "Use the prototype to answer this one question, then return with the decision it settles.",
              "",
              `<skill name="prototype" location="${prototype.filePath}">`,
              content.trim(),
              "</skill>",
              args.trim() ? `\nQuestion:\n${args.trim()}` : "",
            ].join("\n"));
          } catch (error) {
            const details = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(`Could not load the prototype skill: ${details}`, "error");
          }
          return;
        }

        const lens = beat === THREAT_MODEL ? "threat-model" : beat === OBSERVABILITY ? "observability" : undefined;
        if (lens) {
          const skill = skills.find((candidate) => candidate.name === lens);
          if (!skill) {
            ctx.ui.notify(`The ${lens} skill is not loaded.`, "error");
            return;
          }
          try {
            const content = await readFile(skill.filePath, "utf8");
            pi.sendUserMessage([
              `Run the ${lens} lens for this idea.`,
              "Turn its findings into acceptance criteria on the Issue created by this define flow; never create a separate lens document.",
              "",
              `<skill name="${lens}" location="${skill.filePath}">`,
              content.trim(),
              "</skill>",
              args.trim() ? `\nIdea:\n${args.trim()}` : "",
            ].join("\n"));
          } catch (error) {
            const details = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(`Could not load the ${lens} skill: ${details}`, "error");
          }
          return;
        }

        if (beat === DRAFT_SPEC || beat === RESEARCH_TICKET) {
          const requestId = randomUUID();
          let unsubscribe: (() => void) | undefined;
          unsubscribe = pi.events.on(`subagents:rpc:v1:reply:${requestId}`, (reply: unknown) => {
            unsubscribe?.();
            const response = reply as { success?: unknown; error?: { message?: unknown } };
            if (response.success === true) {
              ctx.ui.notify("Define workflow dispatched; pi-subagents will surface the completed result.", "info");
              return;
            }
            if (response.success !== false || typeof response.error?.message !== "string") return;
            ctx.ui.notify(`Could not dispatch the define workflow: ${response.error.message}`, "error");
          });
          pi.events.emit("subagents:rpc:v1:request", {
            version: 1,
            requestId,
            method: "spawn",
            params: beat === DRAFT_SPEC
              ? {
                  context: "fresh",
                  cwd: ctx.cwd,
                  chain: [
                    {
                      agent: "writer",
                      task: [
                        "Draft a decision-complete specification from the settled decisions. Surface unresolved decisions instead of inventing them.",
                        args.trim() ? `Idea:\n${args.trim()}` : "",
                      ].filter(Boolean).join("\n\n"),
                    },
                    {
                      parallel: [
                        {
                          agent: "pr-reviewer-claude",
                          task: "Review this specification against the settled decisions. Report actionable gaps using the findings contract.\n\n{previous}",
                        },
                        {
                          agent: "pr-reviewer-gpt",
                          task: "Review this specification against the settled decisions. Report actionable gaps using the findings contract.\n\n{previous}",
                        },
                      ],
                    },
                  ],
                }
              : {
                  agent: "researcher",
                  context: "fresh",
                  cwd: ctx.cwd,
                  task: [
                    "Resolve this research ticket with primary sources where available. Distinguish verified facts from inferences and cite supporting sources.",
                    args.trim() ? `Research question:\n${args.trim()}` : "",
                  ].filter(Boolean).join("\n\n"),
                },
          });
          return;
        }
      }

      const wayfinder = skills.find((skill) => skill.name === WAYFINDER_SKILL);
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
