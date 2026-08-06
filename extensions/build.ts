import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import type { EventBus, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const GATES = [
  "Open Issue",
  "Clarify requirements and post program design",
  "Red test",
  "Green implementation",
  "Code review and defect hunt",
  "Final full suite",
  "Commit and push",
  "PR action",
  "Close Issue",
] as const;

const SUBAGENT_REQUEST_EVENT = "prompt-template:subagent:request";
const SUBAGENT_RESPONSE_EVENT = "prompt-template:subagent:response";

type Gate = "clarify" | "red" | "green" | "review" | "full-suite" | "commit" | "push" | "pr" | "close" | "done";
type Transition = "design" | "red" | "green" | "full-suite" | "commit" | "push";
type Severity = "Critical" | "Major" | "Minor" | "Observation";
type FindingSource = "code-review" | "issue-reviewer";

type Finding = {
  severity: Severity;
  location: string;
  detail: string;
  source: FindingSource;
};

type Issue = {
  number: number;
  title: string;
  body: string;
};

type BuildRun = {
  issue: Issue;
  groupIssues: number[];
  defaultBranch: string;
  currentBranch: string;
  gate: Gate;
  transitions: Map<string, Transition>;
  announced: Set<Gate>;
  skills: Map<string, string>;
  context: ExtensionContext;
  reviewRequestId?: string;
};

type DelegationResponse = {
  requestId?: string;
  status?: string;
  output?: string;
  error?: string;
};

function todoList(): string {
  return GATES.map((title, index) => `${index + 1}. ${title}`).join("\n");
}

function nextGate(current: Gate): Gate {
  const gates: Gate[] = ["clarify", "red", "green", "review", "full-suite", "commit", "push", "pr", "close", "done"];
  return gates[gates.indexOf(current) + 1] ?? "done";
}

function isTestCommand(command: string): boolean {
  return /\b(pnpm|npm|yarn|bun)\s+(run\s+)?test\b|\b(node\s+--test|vitest|jest|pytest|cargo\s+test|go\s+test)\b/.test(command);
}

function isFullSuiteCommand(command: string): boolean {
  const normalized = command.trim();
  if (!isTestCommand(normalized) || /(^|\s)(tests?|__tests__)\//.test(normalized)) return false;
  return /^(pnpm|npm|yarn|bun)\s+(run\s+)?test\b|^(node\s+--test|vitest(\s+run)?|jest|pytest|cargo\s+test|go\s+test)\b/.test(normalized);
}

function isIssueComment(command: string, issueNumber: number): boolean {
  return new RegExp(`\\bgh\\s+issue\\s+comment\\s+#?${issueNumber}\\b`).test(command);
}

function isTestPath(path: string): boolean {
  return /(^|\/)(tests?|__tests__)\//.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

function bashFailed(event: { isError: boolean }): boolean {
  return event.isError;
}

function hasPriorSessionWork(branch: unknown[]): boolean {
  return branch.some((entry) => {
    if (!entry || typeof entry !== "object") return true;
    const type = (entry as { type?: unknown }).type;
    return type !== "model_change" && type !== "thinking_level_change" && type !== "session_info";
  });
}

function parseIssueNumber(args: string): number | undefined {
  const match = args.trim().match(/^#?(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

function parseGroupIssues(issue: Issue): number[] {
  const group = issue.body.match(/^PR group:\s*(.+)$/im)?.[1];
  const numbers = group?.match(/\d+/g)?.map(Number) ?? [];
  return [...new Set([issue.number, ...numbers])].sort((left, right) => left - right);
}

function parseFindings(output: string, source: FindingSource): Finding[] {
  const contract = /^\s*(?:[-*]\s+)?(Critical|Major|Minor|Observation)\s*—\s*([^—]+?)\s*—\s*(.+?)\s*$/gim;
  return [...output.matchAll(contract)].map(([, severity, location, detail]) => ({
    severity: `${severity[0].toUpperCase()}${severity.slice(1).toLowerCase()}` as Severity,
    location: location.trim(),
    detail: detail.trim(),
    source,
  }));
}

function formatFinding(finding: Finding): string {
  return `${finding.severity} — ${finding.location} — ${finding.detail} (${finding.source})`;
}

function isBlockingFinding(finding: Finding): boolean {
  return finding.severity === "Critical" || finding.severity === "Major";
}

function declaresNoFindings(output: string): boolean {
  return /^no (?:actionable )?findings(?: qualify)?\.?$/i.test(output.trim());
}

function issueBranchName(issue: Issue): string {
  const slug = issue.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "issue";
  return `build/${issue.number}-${slug}`;
}

async function currentBranch(pi: ExtensionAPI, cwd: string): Promise<string | undefined> {
  const branch = await pi.exec("git", ["branch", "--show-current"], { cwd });
  return branch.code === 0 ? branch.stdout.trim() || undefined : undefined;
}

async function defaultBranch(pi: ExtensionAPI, cwd: string): Promise<string | undefined> {
  const branch = await pi.exec("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd });
  if (branch.code === 0) return branch.stdout.trim().replace(/^origin\//, "") || undefined;

  const repository = await pi.exec("gh", ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"], { cwd });
  return repository.code === 0 ? repository.stdout.trim() || undefined : undefined;
}

function isProtectedBranch(run: BuildRun): boolean {
  return run.currentBranch === run.defaultBranch;
}

type GitWriteAction = "commit" | "push";

function gitWriteActions(command: string): GitWriteAction[] {
  return [...command.matchAll(/\bgit\s+(commit|push)\b/g)].map((match) => match[1] as GitWriteAction);
}

function pushesToDefaultBranch(command: string, branch: string): boolean {
  const pushCommand = command.match(/\bgit\s+push\b(?<arguments>.*)$/)?.groups?.arguments;
  if (!pushCommand) return false;

  const fullRef = `refs/heads/${branch}`;
  return pushCommand.trim().split(/\s+/).some((ref) =>
    ref === branch || ref === fullRef || ref.endsWith(`:${branch}`) || ref.endsWith(`:${fullRef}`),
  );
}

async function guardDefaultBranch(pi: ExtensionAPI, run: BuildRun, action: GitWriteAction, command: string, cwd: string): Promise<ReturnType<typeof block> | undefined> {
  const branch = await currentBranch(pi, cwd);
  if (!branch) return block("cannot determine the current branch; refusing to continue.");

  run.currentBranch = branch;
  if (pushesToDefaultBranch(command, run.defaultBranch)) {
    return block("cannot push directly to the repository default branch.");
  }
  if (isProtectedBranch(run)) return block(`cannot ${action} directly to the repository default branch.`);

  return undefined;
}

function gateName(gate: Gate): string {
  return {
    clarify: GATES[1],
    red: GATES[2],
    green: GATES[3],
    review: GATES[4],
    "full-suite": GATES[5],
    commit: "Commit",
    push: "Push",
    pr: GATES[7],
    close: GATES[8],
    done: "Complete",
  }[gate];
}

function block(reason: string) {
  return { block: true, reason: `/build gate: ${reason}` };
}

function commandForGate(run: BuildRun, command: string): Transition | undefined {
  if (run.gate === "clarify" && isIssueComment(command, run.issue.number)) return "design";
  if (run.gate === "red" && isTestCommand(command)) return "red";
  if (run.gate === "green" && isTestCommand(command)) return "green";
  if (run.gate === "full-suite" && isFullSuiteCommand(command)) return "full-suite";
  if (run.gate === "commit" && /\bgit\s+commit\b/.test(command)) return "commit";
  if (run.gate === "push" && /\bgit\s+push\b/.test(command)) return "push";
  return undefined;
}

function collectCodeReviewFindings(run: BuildRun): Finding[] | Promise<Finding[]> {
  const input = run.context.ui.input;
  if (typeof input !== "function") return [];

  const collect = (): Promise<Finding[]> => input.call(
    run.context.ui,
    "Code-review findings",
    "Paste each finding as Severity — file:line — finding and impact; leave blank only when there are none",
  ).then((output) => {
    const trimmed = output?.trim() ?? "";
    if (!trimmed || declaresNoFindings(trimmed)) return [];
    const findings = parseFindings(trimmed, "code-review");
    if (findings.length > 0) return findings;
    run.context.ui.notify("Could not parse the code-review findings. Use one line per finding: Critical|Major|Minor|Observation — file:line — finding and impact.", "error");
    return collect();
  });
  return collect();
}

async function createFollowUps(pi: ExtensionAPI, run: BuildRun, findings: Finding[]): Promise<string[] | undefined> {
  const urls: string[] = [];
  for (const finding of findings) {
    const body = [
      "## Deferred blocking review finding",
      "",
      formatFinding(finding),
      "",
      `Originating Issue: #${run.issue.number}`,
      `Provenance: /build review gate; source: ${finding.source}.`,
      "",
      "This work was explicitly accepted for deferral by a human during /build.",
    ].join("\n");
    const created = await pi.exec("gh", [
      "issue", "create",
      "--title", `Follow up: ${finding.severity} review finding for #${run.issue.number} at ${finding.location}`,
      "--label", "ready-for-agent",
      "--body", body,
    ], { cwd: run.context.cwd });
    if (created.code !== 0) {
      run.context.ui.notify(`Could not create a follow-up for ${formatFinding(finding)}: ${created.stderr.trim() || `exit code ${created.code}`}. Blocking findings remain undispositioned.`, "error");
      return undefined;
    }
    urls.push(created.stdout.trim());
  }
  return urls;
}

async function processCompletedReview(pi: ExtensionAPI, run: BuildRun, response: DelegationResponse, codeReviewFindings: Finding[]): Promise<void> {
  run.reviewRequestId = undefined;
  const findings = [
    ...codeReviewFindings,
    ...parseFindings(response.output ?? "", "issue-reviewer"),
  ];
  const blocking = findings.filter(isBlockingFinding);
  const nonBlocking = findings.filter((finding) => !isBlockingFinding(finding));

  if (blocking.length > 0) {
    pi.sendUserMessage([
      "Blocking review findings must be resolved or explicitly accepted before the final suite:",
      ...blocking.map((finding) => `- ${formatFinding(finding)}`),
      nonBlocking.length > 0 ? "\nMinor and Observation findings are non-blocking and are surfaced for human disposition:" : "",
      ...nonBlocking.map((finding) => `- ${formatFinding(finding)}`),
    ].filter(Boolean).join("\n"), { deliverAs: "followUp" });

    const select = run.context.ui.select;
    const choice = typeof select === "function"
      ? await select.call(run.context.ui, "Blocking review findings", [
        "Remediate with a focused red/green cycle",
        "Accept risk and create linked follow-up Issues",
      ])
      : undefined;
    if (choice === "Remediate with a focused red/green cycle") {
      run.gate = "red";
      run.announced.delete("review");
      run.announced.delete("red");
      run.announced.delete("green");
      pi.sendUserMessage("Remediate the blocking findings with a focused red/green cycle. Write a failing test for the fix, make it pass, then /build will re-run the review gate.", { deliverAs: "followUp" });
      return;
    }
    if (choice !== "Accept risk and create linked follow-up Issues") {
      pi.sendUserMessage("No explicit disposition was selected. Critical and Major findings remain blocking; final suite, commit, push, PR action, and Issue closure are unavailable.", { deliverAs: "followUp" });
      return;
    }

    const confirm = run.context.ui.confirm;
    const accepted = typeof confirm === "function" && await confirm.call(
      run.context.ui,
      "Accept blocking review findings?",
      `Accept and defer ${blocking.length} Critical/Major finding(s)? A ready-for-agent linked follow-up Issue will be created for each one.`,
    );
    if (!accepted) {
      pi.sendUserMessage("Human acceptance was not confirmed. Critical and Major findings remain blocking.", { deliverAs: "followUp" });
      return;
    }
    const followUps = await createFollowUps(pi, run, blocking);
    if (!followUps) return;

    run.gate = "full-suite";
    pi.sendUserMessage([
      "The blocking findings were explicitly accepted and deferred to linked follow-up Issues:",
      ...followUps.map((url) => `- ${url}`),
      nonBlocking.length > 0 ? "\nMinor and Observation findings remain surfaced for human disposition." : "",
      "\nEnter the final full-suite gate now. Run the project's complete test suite; no further implementation changes are allowed.",
    ].filter(Boolean).join("\n"), { deliverAs: "followUp" });
    return;
  }

  run.gate = "full-suite";
  pi.sendUserMessage([
    "The issue-reviewer completed its fresh-context defect hunt.",
    findings.length > 0 ? `\nFindings for human disposition:\n${findings.map(formatFinding).join("\n")}` : "",
    "\nMinor and Observation findings are non-blocking. Enter the final full-suite gate now; no further implementation changes are allowed.",
  ].join("\n"), { deliverAs: "followUp" });
}

async function readSkill(run: BuildRun, name: string): Promise<{ path: string; content: string } | undefined> {
  const path = run.skills.get(name);
  if (!path) return undefined;
  return { path, content: await readFile(path, "utf8") };
}

function startMessage(run: BuildRun): string {
  return [
    `Execute Issue #${run.issue.number}: ${run.issue.title} through the mandatory /build gates.`,
    "",
    "Write this exact gate list through the manage_todo_list tool now, marking Open Issue completed and Clarify requirements in progress:",
    todoList(),
    "",
    "Issue:",
    run.issue.body || "(No Issue body.)",
    "",
    "Gate 2 is active. Clarify requirements with the human. Before writing or running any test, post a proportional program-design note to the Issue using gh issue comment. The note must name the interfaces, types, module boundaries, and file layout for this Issue. Do not begin implementation or tests until that comment succeeds.",
  ].join("\n");
}

async function promptGate(pi: ExtensionAPI, run: BuildRun, ctx: ExtensionContext): Promise<void> {
  if (run.announced.has(run.gate)) return;
  run.announced.add(run.gate);

  if (run.gate === "red") {
    const skill = await readSkill(run, "tdd");
    if (!skill) {
      run.announced.delete(run.gate);
      ctx.ui.notify("The tdd skill is not loaded; /build cannot enter the red-test gate.", "error");
      return;
    }
    pi.sendUserMessage([
      "The program-design note was posted. Enter the red-test gate. Use the explicitly injected tdd skill below. Write one focused failing test at the agreed public seam, run that test, and do not implement production code until it fails.",
      "",
      `<skill name="tdd" location="${skill.path}">`,
      skill.content.trim(),
      "</skill>",
    ].join("\n"), { deliverAs: "followUp" });
    return;
  }

  if (run.gate === "green") {
    pi.sendUserMessage("The focused test is red. Implement only enough production code to make it pass, then run that same test. Do not refactor or begin review yet.", { deliverAs: "followUp" });
    return;
  }

  if (run.gate === "review") {
    const skill = await readSkill(run, "code-review");
    if (!skill) {
      run.announced.delete(run.gate);
      ctx.ui.notify("The code-review skill is not loaded; /build cannot enter the review gate.", "error");
      return;
    }
    const requestId = randomUUID();
    run.reviewRequestId = requestId;
    pi.sendUserMessage([
      "The green test passed. Enter the code-review gate; implementation is now frozen.",
      "",
      `<skill name="code-review" location="${skill.path}">`,
      skill.content.trim(),
      "</skill>",
      "",
      "Complete the injected code review, then translate every actionable finding into this exact contract for collection: <Critical|Major|Minor|Observation> — <file>:<line> — <finding and impact>. If there are no findings, say so. An independent issue-reviewer is being dispatched in fresh context for the issue-scoped diff. Wait for both review sources before the full suite.",
    ].join("\n"), { deliverAs: "followUp" });
    (pi.events as EventBus).emit(SUBAGENT_REQUEST_EVENT, {
      version: 1,
      requestId,
      agent: "issue-reviewer",
      context: "fresh",
      cwd: ctx.cwd,
      task: `Review the implementation for Issue #${run.issue.number}: ${run.issue.title}. Inspect git diff against the issue base and report only findings in the issue-reviewer findings contract.`,
      timeoutMs: 10 * 60 * 1_000,
      artifacts: true,
    });
    return;
  }

  const messages: Partial<Record<Gate, string>> = {
    "full-suite": "The independent review is complete. Run the project's final full test suite now. Do not make further changes in this gate.",
    commit: "The final full suite passed. Commit the completed Issue now; do not push yet.",
    push: "The commit succeeded. Push the current branch now; /build will perform the PR action and close the Issue with plain gh.",
  };
  const message = messages[run.gate];
  if (message) pi.sendUserMessage(message, { deliverAs: "followUp" });
}

async function performPrAction(pi: ExtensionAPI, run: BuildRun, ctx: ExtensionContext): Promise<void> {
  const branchName = await currentBranch(pi, ctx.cwd);
  if (!branchName) {
    ctx.ui.notify("Could not determine the pushed branch for PR action.", "error");
    return;
  }
  if (branchName === run.defaultBranch) {
    ctx.ui.notify("Refusing to create a PR from the repository default branch.", "error");
    return;
  }

  run.currentBranch = branchName;
  const listed = await pi.exec("gh", ["pr", "list", "--state", "open", "--limit", "100", "--json", "number,body,closingIssuesReferences,headRefName"], { cwd: ctx.cwd });
  if (listed.code !== 0) {
    ctx.ui.notify(`Could not list draft PRs: ${listed.stderr.trim() || `exit code ${listed.code}`}`, "error");
    return;
  }

  let pullRequests: Array<{
    number: number;
    body: string;
    headRefName: string;
    closingIssuesReferences?: Array<{ number: number }>;
  }>;
  try {
    pullRequests = JSON.parse(listed.stdout) as typeof pullRequests;
  } catch {
    ctx.ui.notify("Could not read open draft PRs from gh output.", "error");
    return;
  }
  const existing = pullRequests.find((pullRequest) =>
    pullRequest.headRefName === branchName || pullRequest.closingIssuesReferences?.some((issue) => issue.number === run.issue.number),
  );

  if (existing) {
    const knownIssues = new Set(existing.closingIssuesReferences?.map((issue) => issue.number));
    const missingIssues = run.groupIssues.filter((number) => !knownIssues.has(number));
    if (missingIssues.length > 0) {
      const closes = missingIssues.map((number) => `Closes #${number}`).join("\n");
      const updatedBody = `${existing.body.trim()}\n\n${closes}`.trim();
      const update = await pi.exec("gh", ["pr", "edit", String(existing.number), "--body", updatedBody], { cwd: ctx.cwd });
      if (update.code !== 0) {
        ctx.ui.notify(`Could not update draft PR #${existing.number}: ${update.stderr.trim() || `exit code ${update.code}`}`, "error");
        return;
      }
    }
    ctx.ui.notify(`Reusing draft PR #${existing.number}; its closing issue references are the source of truth.`, "info");
  } else {
    const closes = run.groupIssues.map((number) => `Closes #${number}`).join("\n");
    const created = await pi.exec("gh", ["pr", "create", "--draft", "--title", run.issue.title, "--body", closes], { cwd: ctx.cwd });
    if (created.code !== 0) {
      ctx.ui.notify(`Could not create the draft PR: ${created.stderr.trim() || `exit code ${created.code}`}`, "error");
      return;
    }
    ctx.ui.notify(`Opened draft PR: ${created.stdout.trim()}`, "info");
  }

  run.gate = "close";
  const closed = await pi.exec("gh", ["issue", "close", String(run.issue.number)], { cwd: ctx.cwd });
  if (closed.code !== 0) {
    ctx.ui.notify(`PR action succeeded, but could not close Issue #${run.issue.number}: ${closed.stderr.trim() || `exit code ${closed.code}`}. /build will retry closure when the next agent turn ends.`, "error");
    return;
  }
  run.gate = "done";
  ctx.ui.notify(`Issue #${run.issue.number} completed through all nine /build gates.`, "info");
}

export default function buildExtension(pi: ExtensionAPI): void {
  let activeRun: BuildRun | undefined;

  pi.registerCommand("build", {
    description: "Build one Issue through the nine SDLC gates",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/build requires an interactive session.", "warning");
        return;
      }
      if (!ctx.isIdle()) {
        ctx.ui.notify("Start /build only when the current agent run is idle.", "warning");
        return;
      }
      if (activeRun) {
        ctx.ui.notify(`/build is already executing Issue #${activeRun.issue.number}.`, "warning");
        return;
      }

      const issueNumber = parseIssueNumber(args);
      if (!issueNumber) {
        ctx.ui.notify("Usage: /build <Issue number>.", "warning");
        return;
      }
      const sessionManager = ctx.sessionManager as { getBranch?: () => unknown[] } | undefined;
      if (sessionManager?.getBranch && hasPriorSessionWork(sessionManager.getBranch())) {
        ctx.ui.notify("/build must start in a fresh session window.", "warning");
        return;
      }

      const opened = await pi.exec("gh", ["issue", "view", String(issueNumber), "--json", "number,title,body"], { cwd: ctx.cwd });
      if (opened.code !== 0) {
        ctx.ui.notify(`Could not open Issue #${issueNumber}: ${opened.stderr.trim() || `exit code ${opened.code}`}`, "error");
        return;
      }

      let issue: Issue;
      try {
        issue = JSON.parse(opened.stdout) as Issue;
      } catch {
        ctx.ui.notify(`Could not read Issue #${issueNumber} from gh output.`, "error");
        return;
      }
      if (issue.number !== issueNumber || !issue.title || typeof issue.body !== "string") {
        ctx.ui.notify(`Issue #${issueNumber} has incomplete metadata.`, "error");
        return;
      }

      const [branch, repositoryDefaultBranch] = await Promise.all([
        currentBranch(pi, ctx.cwd),
        defaultBranch(pi, ctx.cwd),
      ]);
      if (!branch || !repositoryDefaultBranch) {
        ctx.ui.notify("Could not determine the current and default branches; /build cannot begin.", "error");
        return;
      }
      const issueBranch = issueBranchName(issue);
      if (branch === repositoryDefaultBranch) {
        const created = await pi.exec("git", ["switch", "-c", issueBranch], { cwd: ctx.cwd });
        if (created.code !== 0) {
          const switched = await pi.exec("git", ["switch", issueBranch], { cwd: ctx.cwd });
          if (switched.code !== 0) {
            ctx.ui.notify(`Could not create or check out Issue branch ${issueBranch}: ${switched.stderr.trim() || created.stderr.trim() || `exit code ${switched.code}`}`, "error");
            return;
          }
        }
      }

      const skills = (ctx.getSystemPromptOptions?.().skills ?? []).map((skill) => [skill.name, skill.filePath] as const);
      activeRun = {
        issue,
        groupIssues: parseGroupIssues(issue),
        defaultBranch: repositoryDefaultBranch,
        currentBranch: branch === repositoryDefaultBranch ? issueBranch : branch,
        gate: "clarify",
        transitions: new Map(),
        announced: new Set(),
        skills: new Map(skills),
        context: ctx,
      };
      pi.sendUserMessage(startMessage(activeRun));
    },
  });

  pi.on("tool_call", (event, ctx) => {
    const run = activeRun;
    if (!run) return;

    if (event.toolName === "write" || event.toolName === "edit") {
      const path = event.input.path as string;
      if (run.gate === "clarify") {
        return block("post the program-design note before writing the first red test.");
      }
      if (run.gate === "red" && !isTestPath(path)) {
        return block("Red test is active; production writes wait for the failing test.");
      }
      if (["review", "full-suite", "commit", "push", "pr", "close"].includes(run.gate)) {
        return block(`${gateName(run.gate)} is active; implementation is frozen.`);
      }
      return;
    }

    if (event.toolName !== "bash") return;
    const command = event.input.command as string;
    if (isTestCommand(command) && run.gate === "clarify") {
      return block("post the program-design note before the first red test.");
    }
    if (isTestCommand(command) && run.gate === "review") {
      return block("wait for the issue-reviewer before the final full suite.");
    }
    if (isTestCommand(command) && ["commit", "push", "pr", "close"].includes(run.gate)) {
      return block(`${gateName(run.gate)} is active; the suite has already passed.`);
    }
    const actions = gitWriteActions(command);
    const action = actions[0];
    if (action) {
      return guardDefaultBranch(pi, run, action, command, ctx.cwd).then((blocked) => {
        if (blocked) return blocked;
        if (actions.length > 1) return block("run commit and push as separate commands.");
        if (action === "commit" && run.gate !== "commit") {
          return block(`cannot commit before the final full suite; current gate is ${gateName(run.gate)}.`);
        }
        if (action === "push" && run.gate !== "push") {
          return block(`cannot push before commit; current gate is ${gateName(run.gate)}.`);
        }
        const transition = commandForGate(run, command);
        if (transition) run.transitions.set(event.toolCallId, transition);
        return undefined;
      });
    }
    if (/\bgh\s+pr\s+(create|edit|close|merge|ready-for-review)\b|\bgh\s+issue\s+close\b/.test(command)) {
      return block("PR action and Issue closure are performed by /build after push.");
    }

    const transition = commandForGate(run, command);
    if (transition) run.transitions.set(event.toolCallId, transition);
  });

  pi.on("tool_result", (event) => {
    const run = activeRun;
    if (!run || event.toolName !== "bash") return;
    const transition = run.transitions.get(event.toolCallId);
    if (!transition) return;
    run.transitions.delete(event.toolCallId);

    const failed = bashFailed(event);
    if (transition === "red" && failed) run.gate = nextGate(run.gate);
    else if (transition !== "red" && !failed) run.gate = nextGate(run.gate);
  });

  pi.on("agent_end", async (_event, ctx) => {
    const run = activeRun;
    if (!run) return;
    if (run.gate === "pr" || run.gate === "close") {
      await performPrAction(pi, run, ctx);
      if ((run.gate as Gate) === "done") activeRun = undefined;
      return;
    }
    await promptGate(pi, run, ctx);
  });

  (pi.events as EventBus).on(SUBAGENT_RESPONSE_EVENT, (payload) => {
    const run = activeRun;
    const response = payload as DelegationResponse;
    if (!run || run.gate !== "review" || response.requestId !== run.reviewRequestId) return;
    if (response.status !== "completed") {
      run.reviewRequestId = undefined;
      run.announced.delete("review");
      pi.sendUserMessage(`The issue-reviewer did not complete (${response.status ?? "unknown"}): ${response.error ?? "no details"}. Retry the review gate; do not run the final suite yet.`, { deliverAs: "followUp" });
      return;
    }
    const reviewerOutput = response.output?.trim() ?? "";
    if (reviewerOutput && !declaresNoFindings(reviewerOutput) && parseFindings(reviewerOutput, "issue-reviewer").length === 0) {
      run.reviewRequestId = undefined;
      run.announced.delete("review");
      pi.sendUserMessage("The issue-reviewer returned non-empty findings that do not follow the required contract. Retry the review gate and do not run the final suite yet.", { deliverAs: "followUp" });
      return;
    }
    const codeReviewFindings = collectCodeReviewFindings(run);
    if (Array.isArray(codeReviewFindings)) {
      void processCompletedReview(pi, run, response, codeReviewFindings);
    } else {
      void codeReviewFindings.then((findings) => processCompletedReview(pi, run, response, findings));
    }
  });
}
