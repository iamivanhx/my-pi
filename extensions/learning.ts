import { readFile } from "node:fs/promises";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DOMAIN_MODELING_HOME = "Glossary or ADR";
const PRODUCT_ISSUE_HOME = "Product Issue";
const WORKFLOW_DEFECT_HOME = "my-pi workflow defect";

const ISSUE_ROUTES = [
  {
    home: PRODUCT_ISSUE_HOME,
    heading: "Learning",
    notificationName: "product learning",
    repository: undefined,
    titlePrefix: "Learning",
  },
  {
    home: WORKFLOW_DEFECT_HOME,
    heading: "Workflow learning",
    notificationName: "workflow learning",
    repository: "iamivanhx/my-pi",
    titlePrefix: "Workflow learning",
  },
] as const;

type IssueRoute = (typeof ISSUE_ROUTES)[number];

async function fileIssue(pi: ExtensionAPI, cwd: string, route: IssueRoute, learning: string) {
  return pi.exec(
    "gh",
    [
      "issue",
      "create",
      ...(route.repository ? ["--repo", route.repository] : []),
      "--title",
      `${route.titlePrefix}: ${learning}`,
      "--body",
      `## ${route.heading}\n\n${learning}\n\nFiled by \`/learning\`.`,
    ],
    { cwd, timeout: 10_000 },
  );
}

export default function learningExtension(pi: ExtensionAPI): void {
  pi.registerCommand("learning", {
    description: "Route a session learning to its single home",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/learning requires an interactive session.", "warning");
        return;
      }

      if (!ctx.isIdle()) {
        ctx.ui.notify("Wait for the current agent run to finish before starting /learning.", "warning");
        return;
      }

      const learning = args.trim() || (await ctx.ui.editor("What did you learn?"))?.trim();
      if (!learning) {
        ctx.ui.notify("No learning recorded.", "warning");
        return;
      }

      const home = await ctx.ui.select("Where should this learning live?", [
        DOMAIN_MODELING_HOME,
        PRODUCT_ISSUE_HOME,
        WORKFLOW_DEFECT_HOME,
      ]);

      if (home === DOMAIN_MODELING_HOME) {
        const domainModelingSkill = ctx
          .getSystemPromptOptions()
          .skills
          ?.find((skill) => skill.name === "domain-modeling");
        if (!domainModelingSkill) {
          ctx.ui.notify("The domain-modeling skill is not loaded.", "error");
          return;
        }

        let skillContent: string;
        try {
          skillContent = await readFile(domainModelingSkill.filePath, "utf8");
        } catch (error) {
          const details = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Could not load the domain-modeling skill: ${details}`, "error");
          return;
        }

        pi.sendUserMessage(
          [
            "Route this learning using the explicitly injected domain-modeling skill.",
            "",
            `<skill name=\"domain-modeling\" location=\"${domainModelingSkill.filePath}\">`,
            skillContent.replace(/^---[\s\S]*?---\s*/, "").trim(),
            "</skill>",
            "",
            `Learning:\n${learning}`,
            "",
            "Determine whether this belongs in the glossary or warrants an ADR, then complete that update.",
          ].join("\n"),
        );
        return;
      }

      const issueRoute = ISSUE_ROUTES.find((route) => route.home === home);
      if (!issueRoute) {
        return;
      }

      const result = await fileIssue(pi, ctx.cwd, issueRoute, learning);
      if (result.code !== 0) {
        const details = result.stderr.trim() || `exit code ${result.code}`;
        ctx.ui.notify(`Could not file ${issueRoute.notificationName}: ${details}`, "error");
        return;
      }

      ctx.ui.notify(`Filed ${issueRoute.notificationName}: ${result.stdout.trim()}`, "info");
    },
  });
}
