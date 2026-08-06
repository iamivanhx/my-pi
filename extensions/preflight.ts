import { randomUUID } from "node:crypto";

import type { EventBus, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const SUBAGENT_REQUEST_EVENT = "prompt-template:subagent:request";
const SUBAGENT_RESPONSE_EVENT = "prompt-template:subagent:response";

type PullRequest = {
  number: number;
  body: string;
  closingIssuesReferences: Array<{ number: number }>;
  statusCheckRollup?: Array<{ status?: string; conclusion?: string | null }>;
};

type Issue = { body: string; comments: Array<{ body: string }> };
type Verdict = "GO" | "NO-GO";
type PreflightRun = { pullRequest: PullRequest; issue: Issue; context: ExtensionContext; diff: string };
type PendingDelegation = { run: PreflightRun; kind: "writer" | "review" };
type DelegationResponse = { requestId?: string; status?: string; output?: string; error?: string };

function isSingleIssue(pullRequest: PullRequest): boolean {
  return Array.isArray(pullRequest.closingIssuesReferences) && pullRequest.closingIssuesReferences.length === 1;
}

function acceptanceCriteria(body: string): string[] {
  return body.split("\n").filter((line) => /^\s*- \[[ xX]\]\s+/.test(line));
}

function ciPasses(checks: PullRequest["statusCheckRollup"]): boolean {
  return Array.isArray(checks) && checks.length > 0 && checks.every((check) => check.status === "COMPLETED" && ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(check.conclusion ?? ""));
}

function hasCrossFamilyLook(issue: Issue): boolean {
  return issue.comments.some((comment) => /\b(?:pr-reviewer-(?:claude|gpt)|cross-family)\b/i.test(comment.body));
}

async function recordVerdict(pi: ExtensionAPI, run: PreflightRun, verdict: Verdict, detail: string): Promise<void> {
  const result = await pi.exec("gh", ["pr", "comment", String(run.pullRequest.number), "--body", `${verdict}\n\n${detail}`], { cwd: run.context.cwd });
  if (result.code !== 0) run.context.ui.notify(`Could not post the ${verdict} verdict: ${result.stderr.trim() || `exit code ${result.code}`}.`, "error");
}

async function readingGate(pi: ExtensionAPI, run: PreflightRun, findings = "No cross-family findings recorded."): Promise<void> {
  const criteria = acceptanceCriteria(run.issue.body);
  const briefing = [
    "## /preflight GO/NO-GO reading gate",
    "", "### CI", "All required checks passed.", "", "### Definition of done", ...criteria,
    "", "### Diff", "```diff", run.diff, "```", "", "### Findings for inline human disposition", findings,
  ].join("\n");
  pi.sendUserMessage(briefing, { deliverAs: "followUp" });

  const confirm = run.context.ui.confirm;
  const go = typeof confirm === "function" && await confirm.call(run.context.ui, "GO/NO-GO", briefing);
  if (!go) {
    const editor = run.context.ui.editor;
    const reason = typeof editor === "function" ? await editor.call(run.context.ui, "Why is this NO-GO?") : undefined;
    await recordVerdict(pi, run, "NO-GO", reason?.trim() || "No reason supplied.");
    return;
  }
  const ready = await pi.exec("gh", ["pr", "ready", String(run.pullRequest.number)], { cwd: run.context.cwd });
  if (ready.code !== 0) {
    run.context.ui.notify(`Could not mark PR #${run.pullRequest.number} ready: ${ready.stderr.trim() || `exit code ${ready.code}`}.`, "error");
    return;
  }
  await recordVerdict(pi, run, "GO", "Human reviewed the diff against the Issue acceptance criteria and dispositioned findings inline.");
}

export default function preflightExtension(pi: ExtensionAPI): void {
  const pending = new Map<string, PendingDelegation>();

  (pi.events as EventBus).on(SUBAGENT_RESPONSE_EVENT, async (payload: unknown) => {
    const response = payload as DelegationResponse;
    const delegation = response.requestId ? pending.get(response.requestId) : undefined;
    if (!delegation) return;
    pending.delete(response.requestId!);
    const { run, kind } = delegation;
    if (response.status !== "completed" || !response.output?.trim()) {
      run.context.ui.notify(`The delegated preflight ${kind} did not return usable output: ${response.error ?? response.status ?? "unknown"}.`, "error");
      return;
    }
    if (kind === "writer") {
      const updated = await pi.exec("gh", ["pr", "edit", String(run.pullRequest.number), "--body", response.output.trim()], { cwd: run.context.cwd });
      if (updated.code !== 0) {
        run.context.ui.notify(`Could not apply the drafted PR description: ${updated.stderr.trim() || `exit code ${updated.code}`}.`, "error");
        return;
      }
      if (hasCrossFamilyLook(run.issue)) return void readingGate(pi, run);
      const requestId = randomUUID();
      pending.set(requestId, { run, kind: "review" });
      (pi.events as EventBus).emit(SUBAGENT_REQUEST_EVENT, { version: 1, requestId, agent: "pr-reviewer-gpt", context: "fresh", cwd: run.context.cwd, task: `Perform the missing cross-family preflight look for PR #${run.pullRequest.number}. Use the findings contract.` });
      return;
    }
    const recorded = await pi.exec("gh", ["issue", "comment", String(run.pullRequest.closingIssuesReferences[0]!.number), "--body", `Cross-family look completed by pr-reviewer-gpt.\n\n${response.output.trim()}`], { cwd: run.context.cwd });
    if (recorded.code !== 0) {
      run.context.ui.notify(`Could not record the cross-family look: ${recorded.stderr.trim() || `exit code ${recorded.code}`}.`, "error");
      return;
    }
    await readingGate(pi, run, response.output.trim());
  });

  pi.registerCommand("preflight", {
    description: "Run proportional pull-request preflight checks",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return void ctx.ui.notify("/preflight requires an interactive session.", "warning");
      if (!ctx.isIdle()) return void ctx.ui.notify("Wait for the current agent run to finish before starting /preflight.", "warning");

      const pullRequestResult = await pi.exec("gh", ["pr", "view", "--json", "number,body,closingIssuesReferences,statusCheckRollup"], { cwd: ctx.cwd });
      if (pullRequestResult.code !== 0) return void ctx.ui.notify(`Could not resolve the current pull request: ${pullRequestResult.stderr.trim() || `exit code ${pullRequestResult.code}`}.`, "error");
      let pullRequest: PullRequest;
      try { pullRequest = JSON.parse(pullRequestResult.stdout) as PullRequest; } catch { return void ctx.ui.notify("Could not read the current pull request from gh output.", "error"); }
      if (!isSingleIssue(pullRequest)) return void ctx.ui.notify("/preflight full fan-out is not implemented yet; this command currently supports a single-Issue PR.", "warning");
      const issueNumber = pullRequest.closingIssuesReferences[0]!.number;

      const issueResult = await pi.exec("gh", ["issue", "view", String(issueNumber), "--json", "body,comments"], { cwd: ctx.cwd });
      if (issueResult.code !== 0) return void ctx.ui.notify(`Could not read Issue #${issueNumber}: ${issueResult.stderr.trim() || `exit code ${issueResult.code}`}.`, "error");
      let issue: Issue;
      try { issue = JSON.parse(issueResult.stdout) as Issue; } catch { return void ctx.ui.notify(`Could not read Issue #${issueNumber} from gh output.`, "error"); }
      const criteria = acceptanceCriteria(issue.body);
      if (!ciPasses(pullRequest.statusCheckRollup) || criteria.length === 0) {
        await recordVerdict(pi, { pullRequest, issue, context: ctx, diff: "" }, "NO-GO", !ciPasses(pullRequest.statusCheckRollup) ? "CI checks are not all passing." : "The linked Issue has no acceptance criteria.");
        return;
      }
      const diffResult = await pi.exec("gh", ["pr", "diff", String(pullRequest.number)], { cwd: ctx.cwd });
      if (diffResult.code !== 0) return void ctx.ui.notify(`Could not read PR #${pullRequest.number}'s diff: ${diffResult.stderr.trim() || `exit code ${diffResult.code}`}.`, "error");
      const run = { pullRequest, issue, context: ctx, diff: diffResult.stdout };

      if (!pullRequest.body.trim()) {
        const requestId = randomUUID();
        pending.set(requestId, { run, kind: "writer" });
        (pi.events as EventBus).emit(SUBAGENT_REQUEST_EVENT, { version: 1, requestId, agent: "writer", context: "fresh", cwd: ctx.cwd, task: `Draft a concise pull-request description for PR #${pullRequest.number} from its linked Issue. Do not invent decisions.\n\nIssue #${issueNumber}` });
        return;
      }
      if (!hasCrossFamilyLook(issue)) {
        const requestId = randomUUID();
        pending.set(requestId, { run, kind: "review" });
        (pi.events as EventBus).emit(SUBAGENT_REQUEST_EVENT, { version: 1, requestId, agent: "pr-reviewer-gpt", context: "fresh", cwd: ctx.cwd, task: `Perform the missing cross-family preflight look for PR #${pullRequest.number} and Issue #${issueNumber}. Use the findings contract.` });
        return;
      }
      await readingGate(pi, run);
    },
  });
}
