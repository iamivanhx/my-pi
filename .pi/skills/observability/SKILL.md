---
name: observability
description: Define proportional operational signals for a proposed change and express them as Issue acceptance criteria. Use conditionally when a feature adds user-facing behavior, a failure-prone integration, a background workflow, or a new operational dependency.
---

# Observability lens

Use this lens only when the proposed change needs a meaningful operational signal. Keep it proportional to the feature and its failure modes.

## Output contract

Do not create an observability document, Markdown artifact, or standalone Issue. Return only proposed acceptance-criteria bullets for the Issue being created. Each bullet must describe an observable operational outcome, not a prescribed implementation.

Identify the user-visible success path, meaningful failure modes, and the signals needed to diagnose them. Where applicable, propose criteria for structured errors, useful logs/metrics/traces, health or verification checks, and alertable regressions. Avoid generic telemetry requirements with no decision they support.

State assumptions or unresolved operational risks briefly so the human can decide whether they become acceptance criteria.
