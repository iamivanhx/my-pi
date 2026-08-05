import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ExecResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { parseShippingDocument, ShippingDocumentError } from "./shipping/document.ts";

const SHIPPING_DOCUMENT_NAME = "shipping.md";
const DEPLOY_TIMEOUT_MS = 15 * 60 * 1_000;
const MAX_OUTPUT_LENGTH = 1_000;

function formatRollback(command: string, environment: string): string {
  return command.replaceAll("{environment}", environment);
}

function truncateOutput(output: string): string {
  const truncated = output.slice(0, MAX_OUTPUT_LENGTH);
  return truncated.length === output.length ? truncated : `${truncated}\n[output truncated]`;
}

function describeCommandFailure(result: ExecResult): string {
  const output = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
  return output ? truncateOutput(output) : `exit code ${result.code}`;
}

function reportedErrors(...results: ExecResult[]): string {
  const errorLines = results
    .flatMap((result) => [result.stderr, result.stdout])
    .flatMap((output) => output.split("\n"))
    .filter((line) => /\b(error|exception|fatal|failed)\b/i.test(line))
    .filter((line) => !/\b(no|0)\s+(errors?|failures?)\b/i.test(line));

  return truncateOutput([...new Set(errorLines)].join("\n").trim());
}

function reviewLocation(ciCheck: string, monitoringUrl?: string): string {
  return `Review CI check: ${ciCheck}.${monitoringUrl ? ` Monitoring: ${monitoringUrl}` : ""}`;
}

export default function shipExtension(pi: ExtensionAPI): void {
  pi.registerCommand("ship", {
    description: "Deploy and verify the selected environment from shipping.md",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/ship requires an interactive session.", "warning");
        return;
      }

      if (!ctx.isIdle()) {
        ctx.ui.notify("Wait for the current agent run to finish before starting /ship.", "warning");
        return;
      }

      let shippingDocument: string;
      try {
        shippingDocument = await readFile(join(ctx.cwd, SHIPPING_DOCUMENT_NAME), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          ctx.ui.notify("No shipping.md found. Run /setup to record this project's shipping workflow.", "warning");
          return;
        }

        const details = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Could not read shipping.md: ${details}. Run /setup to recreate it.`, "warning");
        return;
      }

      let workflow;
      try {
        workflow = parseShippingDocument(shippingDocument);
      } catch (error) {
        const field = error instanceof ShippingDocumentError ? error.field : "valid JSON frontmatter";
        ctx.ui.notify(`shipping.md is incomplete (${field}). Run /setup to complete it before shipping.`, "warning");
        return;
      }

      const environments = Object.keys(workflow.environments).sort();
      let environment = args.trim();
      if (environment) {
        if (!environments.includes(environment)) {
          ctx.ui.notify(
            `shipping.md does not define the ${environment} environment. Choose one of: ${environments.join(", ")}.`,
            "warning",
          );
          return;
        }
      } else if (environments.length === 1) {
        environment = environments[0];
      } else {
        environment = (await ctx.ui.select("Choose an environment to ship", environments)) ?? "";
        if (!environment) {
          ctx.ui.notify("No environment selected. /ship cancelled.", "warning");
          return;
        }
      }

      const commands = workflow.environments[environment];
      const rollback = formatRollback(workflow.rollback, environment);
      ctx.ui.notify(`Rollback ready for ${environment}: ${rollback}`, "info");

      ctx.ui.notify(`Deploying ${environment}...`, "info");
      const deployment = await pi.exec("sh", ["-lc", commands.deploy], {
        cwd: ctx.cwd,
        timeout: DEPLOY_TIMEOUT_MS,
      });
      if (deployment.code !== 0) {
        ctx.ui.notify(`Deploy failed:\n${describeCommandFailure(deployment)}`, "error");
        return;
      }

      ctx.ui.notify(`Deployment to ${environment} succeeded.`, "info");
      ctx.ui.notify(`Verifying ${environment}...`, "info");
      const verification = await pi.exec("sh", ["-lc", commands.verify], {
        cwd: ctx.cwd,
        timeout: DEPLOY_TIMEOUT_MS,
      });
      if (verification.code !== 0) {
        ctx.ui.notify(`Verification failed:\n${describeCommandFailure(verification)}`, "error");
        return;
      }

      ctx.ui.notify(`Verification for ${environment} succeeded.`, "info");
      const errors = reportedErrors(deployment, verification);
      if (errors) {
        ctx.ui.notify(
          `Errors reported while shipping the changed path:\n${errors}\n${reviewLocation(workflow.ciCheck, workflow.monitoringUrl)}`,
          "warning",
        );
        return;
      }

      ctx.ui.notify(
        `No errors reported while shipping the changed path. ${reviewLocation(workflow.ciCheck, workflow.monitoringUrl)}`,
        "info",
      );
    },
  });
}
