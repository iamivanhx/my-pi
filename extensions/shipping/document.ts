export type ShippingEnvironment = {
  deploy: string;
  verify: string;
};

export type ShippingDocument = {
  environments: Record<string, ShippingEnvironment>;
  rollback: string;
  ciCheck: string;
  monitoringUrl?: string;
};

export class ShippingDocumentError extends Error {
  readonly field: string;

  constructor(field: string) {
    super(field);
    this.field = field;
    this.name = "ShippingDocumentError";
  }
}

export const SHIPPING_DOCUMENT_FORMAT = `---
{
  "environments": {
    "staging": {
      "deploy": "pnpm run deploy:staging",
      "verify": "pnpm run verify:staging"
    },
    "production": {
      "deploy": "pnpm run deploy:production",
      "verify": "pnpm run verify:production"
    }
  },
  "rollback": "pnpm run rollback -- --environment {environment}",
  "ciCheck": "release",
  "monitoringUrl": "https://monitoring.example.com/releases"
}
---`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ShippingDocumentError(field);
  }

  return value.trim();
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    throw new ShippingDocumentError("JSON frontmatter");
  }

  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (!isRecord(parsed)) {
      throw new ShippingDocumentError("JSON frontmatter");
    }

    return parsed;
  } catch (error) {
    if (error instanceof ShippingDocumentError) {
      throw error;
    }
    throw new ShippingDocumentError("valid JSON frontmatter");
  }
}

export function parseShippingDocument(content: string): ShippingDocument {
  const frontmatter = parseFrontmatter(content);
  if (!isRecord(frontmatter.environments) || Object.keys(frontmatter.environments).length === 0) {
    throw new ShippingDocumentError("environments");
  }

  const environments = Object.fromEntries(
    Object.entries(frontmatter.environments).map(([name, value]) => {
      if (!name.trim() || !isRecord(value)) {
        throw new ShippingDocumentError(`environments.${name || "<name>"}`);
      }

      return [name, {
        deploy: requiredString(value.deploy, `environments.${name}.deploy`),
        verify: requiredString(value.verify, `environments.${name}.verify`),
      }];
    }),
  );

  const monitoringUrl = frontmatter.monitoringUrl === undefined
    ? undefined
    : requiredString(frontmatter.monitoringUrl, "monitoringUrl");

  return {
    environments,
    rollback: requiredString(frontmatter.rollback, "rollback"),
    ciCheck: requiredString(frontmatter.ciCheck, "ciCheck"),
    ...(monitoringUrl ? { monitoringUrl } : {}),
  };
}
