import { validateNavigation } from "./address.js";

export function domainMatches(host, pattern) {
  host = host.toLowerCase().replace(/\.$/, "");
  pattern = pattern.trim().toLowerCase().replace(/\.$/, "");
  if (pattern.startsWith("=")) return host === pattern.slice(1);
  if (pattern.startsWith("*.")) return host.endsWith("." + pattern.slice(2));
  return host === pattern || host.endsWith("." + pattern);
}

export function parseDomainRules(value) {
  const rules = value.split(/[\s,]+/).filter(Boolean);
  for (const rule of rules) {
    if (!/^(?:=|\*\.)?(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z\d-]+$/i.test(rule)) throw new Error(`Invalid domain rule: ${rule}`);
  }
  return [...new Set(rules.map((rule) => rule.toLowerCase()))];
}

export function routeRequest(value, context = {}) {
  const url = validateNavigation(value);
  const host = url.hostname.toLowerCase();
  const result = (mode, reason, policy = reason, inheritedFrom = null) => ({ mode, reason, policy, inheritedFrom });
  const site = context.sites?.[host];
  if (site?.mode === "direct") return result("direct", "USER_FORCE_DIRECT", "Site override");
  if (site?.mode === "proxy") return result("proxy", "USER_FORCE_PROXY", "Site override");
  if (context.mode === "direct") return result("direct", "USER_FORCE_DIRECT", "Global override");
  if (context.mode === "proxy") return result("proxy", "USER_FORCE_PROXY", "Global override");
  const temporary = context.temporary?.find((rule) => rule.expires > Date.now() && domainMatches(host, rule.domain));
  if (temporary) return result(temporary.mode, temporary.mode === "proxy" ? "PROXY_REQUIRED" : "DIRECT_ALLOWED", "Temporary rule");
  for (const [category, mode, reason] of [
    ["forceProxy", "proxy", "PROXY_REQUIRED"],
    ["forceDirect", "direct", "DIRECT_ALLOWED"],
    ["block", "proxy", "DOMAIN_BLOCKED"],
    ["allow", "direct", "DOMAIN_ALLOWED"],
  ]) {
    if (context.rules?.[category]?.some((rule) => domainMatches(host, rule))) return result(mode, reason, category);
  }
  if (context.parentRoute) return result(context.parentRoute.mode, "INHERITED_ROUTE", "Parent navigation", context.parentRoute.mode);
  return result(context.defaultRoute || "direct", "DIRECT_ALLOWED", "Default route");
}
