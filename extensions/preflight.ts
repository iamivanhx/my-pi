import { randomUUID } from "node:crypto";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type PullRequest = {
  number: number;
  title: string;
  body: string;
  headRefName: string;
  baseRefName: string;
  closingIssuesReferences: Array<{ number: number }>;
};

function isSingleIssuePullRequest(pullRequest: PullRequest): boolean {
  return pullRequest.closingIssuesReferences.length === 1;
}

export default function preflightExtension(pi: ExtensionAPI): void {
  pi.registerCommand("preflight", {
    description: "Run proportional pull-request preflight checks",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/preflight requires an interactive session.", "warning");
        return;
      }
      if (!ctx.isIdle()) {
        ctx.ui.notify("Wait for the current agent run to finish before starting /preflight.", "warning");
        return;
      }

      const result = await pi.exec("gh", [
        "pr", "view", "--json", "number,title,body,closingIssuesReferences,headRefName,baseRefName",
      ], { cwd: ctx.cwd });
      if (result.code !== 0) {
        ctx.ui.notify(`Could not resolve the current pull request: ${result.stderr.trim() || `exit code ${result.code}`}.`, "error");
        return;
      }

      let pullRequest: PullRequest;
      try {
        pullRequest = JSON.parse(result.stdout) as PullRequest;
      } catch {
        ctx.ui.notify("Could not read the current pull request from gh output.", "error");
        return;
      }
      if (!isSingleIssuePullRequest(pullRequest)) {
        ctx.ui.notify("/preflight full fan-out is not implemented yet; this command currently supports a single-Issue PR.", "warning");
        return;
      }
      if (pullRequest.body.trim()) return;

      const issueNumber = pullRequest.closingIssuesReferences[0]!.number;
      pi.events.emit("subagents:rpc:v1:request", {
        version: 1,
        requestId: randomUUID(),
        method: "spawn",
        params: {
          agent: "writer",
          context: "fresh",
          cwd: ctx.cwd,
          task: `Draft a concise pull-request description for PR #${pullRequest.number} from its linked Issue. Do not invent decisions.\n\nIssue #${issueNumber}`,
        },
      });
    },
  });
}
