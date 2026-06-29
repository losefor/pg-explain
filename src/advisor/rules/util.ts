import type {
  AnalysisContext,
  Diagnostic,
  DiagnosticLocation,
  PlanNode,
  Remediation,
  Rule,
  Severity,
} from "../../core/model.ts";

export const DOCS = "https://www.postgresql.org/docs/current";

export function locationOf(node: PlanNode): DiagnosticLocation {
  const loc: DiagnosticLocation = { kind: "node", nodeId: node.id, nodeType: node.nodeType };
  if (node.relationName) loc.relation = node.relationName;
  return loc;
}

/**
 * Build a plan finding. The Diagnostic `code` is the rule id (a PGX_* code), severity
 * is resolved through config overrides, and the location points at the offending node.
 * Every rule goes through here so all findings carry remediation + a node location.
 */
export function makeFinding(
  rule: Rule,
  ctx: AnalysisContext,
  node: PlanNode,
  parts: {
    title: string;
    detail: string;
    cause: string;
    remediation: Remediation;
    docsUrl?: string;
    meta?: Diagnostic["meta"];
    /** Per-finding severity fallback (e.g. underestimate→warn); config still wins. */
    severity?: Severity;
  },
): Diagnostic {
  const d: Diagnostic = {
    code: rule.id,
    domain: "plan",
    severity: ctx.severityOf(rule.id, parts.severity ?? rule.defaultSeverity),
    title: parts.title,
    detail: parts.detail,
    cause: parts.cause,
    remediation: parts.remediation,
    location: locationOf(node),
  };
  if (parts.docsUrl) d.docsUrl = parts.docsUrl;
  if (parts.meta) d.meta = parts.meta;
  return d;
}

/** First child is the outer (driving) side of a join. */
export function outerChild(node: PlanNode): PlanNode | undefined {
  return node.children[0];
}
