---
name: threat-model
description: Identify concrete security threats for a proposed change and express mitigations as Issue acceptance criteria. Use conditionally when a feature touches trust boundaries, credentials, authorization, user data, external input, or LLM I/O.
---

# Threat model

Use this lens only when the change introduces or changes a meaningful trust boundary. Keep it proportional to the feature.

## Output contract

Do not create a threat-model document, Markdown artifact, or standalone Issue. Return only proposed acceptance-criteria bullets for the Issue being created. Each bullet must describe an observable security property, not an implementation preference.

For each relevant boundary, consider the asset, actor, entry point, threat, and required observable outcome. Cover only applicable risks, including authorization, data exposure, input validation, secret handling, dependency or webhook trust, and auditability.

State assumptions or unresolved risks briefly so the human can decide whether they become acceptance criteria.
