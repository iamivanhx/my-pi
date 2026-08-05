import { readFile } from "node:fs/promises";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SETUP_SKILL_NAME = "setup-matt-pocock-skills";

export default function setupExtension(pi: ExtensionAPI): void {
  pi.registerCommand("setup", {
    description: "Onboard this project and record its shipping workflow",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/setup requires an interactive session.", "warning");
        return;
      }

      if (!ctx.isIdle()) {
        ctx.ui.notify("Wait for the current agent run to finish before starting /setup.", "warning");
        return;
      }

      const setupSkill = ctx
        .getSystemPromptOptions()
        .skills
        ?.find((skill) => skill.name === SETUP_SKILL_NAME);
      if (!setupSkill) {
        ctx.ui.notify(`The ${SETUP_SKILL_NAME} skill is not loaded.`, "error");
        return;
      }

      let skillContent: string;
      try {
        skillContent = await readFile(setupSkill.filePath, "utf8");
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Could not load the ${SETUP_SKILL_NAME} skill: ${details}`, "error");
        return;
      }

      pi.sendUserMessage(
        [
          "Onboard this project inline. Do not delegate to agents.",
          "",
          "First, complete Part 1 using the explicitly injected pinned skill, unchanged.",
          "",
          `<skill name=\"${SETUP_SKILL_NAME}\" location=\"${setupSkill.filePath}\">`,
          skillContent.trim(),
          "</skill>",
          "",
          "Then interview me for Part 2 and write a slim shipping.md for this project.",
          "Ask only for:",
          "- deploy command per environment",
          "- health-check/verify command",
          "- rollback move",
          "- CI check name",
          "- monitoring URL optional",
          args.trim() ? `\nAdditional setup context:\n${args.trim()}` : "",
        ].join("\n"),
      );
    },
  });
}
