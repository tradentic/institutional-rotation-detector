import type { HttpRequestInterceptor, HttpRequestOptions } from "@airnub/resilient-http-core";

export interface GuardrailRule {
  allowHosts?: string[];
  denyHosts?: string[];
  allowedMethods?: string[];
  deniedMethods?: string[];
  maxBodySizeBytes?: number;
  pathPrefixes?: string[];
}

export interface GuardrailSelector {
  agentId?: string;
  toolName?: string;
}

export interface GuardrailConfig {
  selector?: GuardrailSelector;
  rule: GuardrailRule;
}

export interface BrowserGuardrailsOptions {
  rules: GuardrailConfig[];
  defaultRule?: GuardrailRule;
}

function matchesRule(request: HttpRequestOptions, rule: GuardrailRule): void {
  const url = request.url ?? request.urlParts?.href ?? request.path ?? "";
  const parsed = new URL(url, typeof window === "undefined" ? "http://localhost" : undefined);
  if (rule.allowHosts && !rule.allowHosts.includes(parsed.host)) {
    throw new Error(`Host ${parsed.host} not allowed`);
  }
  if (rule.denyHosts && rule.denyHosts.includes(parsed.host)) {
    throw new Error(`Host ${parsed.host} denied`);
  }
  const method = (request.method ?? "GET").toUpperCase();
  if (rule.allowedMethods && !rule.allowedMethods.map((m) => m.toUpperCase()).includes(method)) {
    throw new Error(`Method ${method} not allowed`);
  }
  if (rule.deniedMethods && rule.deniedMethods.map((m) => m.toUpperCase()).includes(method)) {
    throw new Error(`Method ${method} denied`);
  }
  if (rule.pathPrefixes && !rule.pathPrefixes.some((p) => parsed.pathname.startsWith(p))) {
    throw new Error(`Path ${parsed.pathname} not allowed`);
  }
  if (rule.maxBodySizeBytes && typeof request.body === "string" && request.body.length > rule.maxBodySizeBytes) {
    throw new Error("Body too large");
  }
}

export function createBrowserGuardrailsInterceptor(options: BrowserGuardrailsOptions): HttpRequestInterceptor {
  return {
    beforeSend: async ({ request }) => {
      const extensions = request.extensions ?? {};
      const agentId = (request.agentContext as any)?.agentId ?? extensions["agent.id"];
      const toolName = extensions["ai.tool"] as string | undefined;
      const match = options.rules.find((rule) => {
        return (
          (!rule.selector?.agentId || rule.selector.agentId === agentId) &&
          (!rule.selector?.toolName || rule.selector.toolName === toolName)
        );
      });
      const rule = match?.rule ?? options.defaultRule;
      if (rule) {
        matchesRule(request, rule);
      }
    },
  };
}

