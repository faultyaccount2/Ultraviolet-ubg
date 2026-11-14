import { parse, parseFragment, serialize } from "parse5";
import postcss from "postcss";
import valueParser from "postcss-value-parser";
import { proxyUrl } from "../shared/proxy-url.js";

function rewriteUrl(value, base, options) {
  if (!value.trim() || value.trim().startsWith("#")) return value;
  const url = new URL(value, base);
  if (!["http:", "https:"].includes(url.protocol)) return value;
  return proxyUrl(url.href, options);
}

export function rewriteCss(source, base, options = {}) {
  const root = postcss.parse(source);
  function rewriteValue(value, type = "image") {
    const parsed = valueParser(value);
    parsed.walk((node) => {
      if (node.type !== "function" || node.value.toLowerCase() !== "url") return;
      const raw = valueParser.stringify(node.nodes).trim();
      const url = node.nodes.length === 1 && node.nodes[0].type === "string" ? node.nodes[0].value : raw;
      node.nodes = [{ type: "string", quote: '"', value: rewriteUrl(url, base, { ...options, type }) }];
      return false;
    });
    return parsed.toString();
  }
  root.walkDecls((declaration) => { declaration.value = rewriteValue(declaration.value, declaration.parent.type === "atrule" && declaration.parent.name.toLowerCase() === "font-face" ? "font" : "image"); });
  root.walkAtRules("import", (rule) => {
    const parsed = valueParser(rewriteValue(rule.params));
    const first = parsed.nodes.find((node) => node.type !== "space");
    if (first?.type === "string") first.value = rewriteUrl(first.value, base, { ...options, type: "stylesheet" });
    if (first?.type === "function" && first.value.toLowerCase() === "url") {
      const value = first.nodes[0]?.value;
      if (value?.startsWith("/api/proxy?")) {
        const query = new URL(value, "https://proxy.example").searchParams;
        first.nodes[0].value = proxyUrl(query.get("url"), { ...options, type: "stylesheet" });
      }
    }
    rule.params = parsed.toString();
  });
  root.walkAtRules("charset", (rule) => { rule.params = '"UTF-8"'; });
  return root.toString();
}

function rewriteSrcset(value, base, options) {
  const candidates = [];
  let position = 0;
  while (position < value.length) {
    while (/[\s,]/.test(value[position] || "") && position < value.length) position++;
    const start = position;
    while (position < value.length && !/\s/.test(value[position])) position++;
    let url = value.slice(start, position);
    if (!url) break;
    let descriptor = "";
    if (url.endsWith(",")) url = url.replace(/,+$/, "");
    else {
      const begin = position;
      while (position < value.length && value[position] !== ",") position++;
      descriptor = value.slice(begin, position).trim();
      position++;
    }
    candidates.push(`${rewriteUrl(url, base, options)}${descriptor ? ` ${descriptor}` : ""}`);
  }
  return candidates.join(", ");
}

const attr = (node, name) => node.attrs?.find((item) => item.name === name)?.value;
function setAttr(node, name, value) {
  const item = node.attrs.find((item) => item.name === name);
  if (item) item.value = value;
  else node.attrs.push({ name, value });
}
function nodesOf(root) {
  const nodes = [];
  function walk(node) {
    nodes.push(node);
    node.childNodes?.forEach(walk);
    if (node.content) walk(node.content);
  }
  walk(root);
  return nodes;
}

export function rewriteHtml(source, target, requestUrl, adblock = true, extra = {}) {
  const document = parse(source);
  const nodes = nodesOf(document);
  const baseElement = nodes.find((node) => node.tagName === "base" && attr(node, "href"));
  const base = baseElement ? new URL(attr(baseElement, "href"), target).href : target;
  const options = { adblock, origin: target, ...extra };
  for (const node of nodes) {
    if (!node.tagName) continue;
    const rel = (attr(node, "rel") || "").toLowerCase();
    const httpEquiv = (attr(node, "http-equiv") || "").toLowerCase();
    if (node.tagName === "base" || node.tagName === "meta" && httpEquiv === "content-security-policy" ||
        node.tagName === "link" && /(?:preconnect|dns-prefetch)/.test(rel)) {
      node.parentNode.childNodes = node.parentNode.childNodes.filter((child) => child !== node);
      continue;
    }
    node.attrs = node.attrs.filter((item) => item.name !== "integrity");
    if (node.tagName === "meta" && attr(node, "charset")) setAttr(node, "charset", "utf-8");
    if (node.tagName === "meta" && httpEquiv === "content-type") setAttr(node, "content", "text/html; charset=utf-8");
    if (node.tagName === "meta" && httpEquiv === "refresh") {
      const content = attr(node, "content") || "";
      const refresh = content.match(/^\s*(\d+(?:\.\d+)?)\s*;\s*url\s*=\s*['"]?(.+?)['"]?\s*$/i);
      if (refresh) {
        setAttr(node, "data-proxy-refresh", JSON.stringify({ seconds: Number(refresh[1]), url: new URL(refresh[2], base).href }));
      }
      node.attrs = node.attrs.filter((item) => item.name !== "http-equiv");
    }
    if (node.tagName === "form") {
      const action = new URL(attr(node, "action") || target, base).href;
      setAttr(node, "data-proxy-action", action);
      setAttr(node, "action", rewriteUrl(action, base, { ...options, type: "document" }));
      node.attrs = node.attrs.filter((item) => item.name !== "target");
    }
    for (const item of node.attrs) {
      let type;
      if (item.name === "href" && ["a", "area", "link"].includes(node.tagName)) {
        type = node.tagName !== "link" ? "document" : rel.includes("stylesheet") ? "stylesheet" : rel.includes("icon") ? "image" : "other";
      } else if (item.name === "src") {
        type = node.tagName === "script" ? "script" : ["img", "input"].includes(node.tagName) ? "image" : node.tagName === "iframe" ? "subdocument" : "media";
      } else if (item.name === "poster" || item.name === "background") type = "image";
      else if (item.name === "data" && node.tagName === "object") type = "object";
      if (type) item.value = rewriteUrl(item.value, base, { ...options, type });
      if (item.name === "srcset" || item.name === "imagesrcset") item.value = rewriteSrcset(item.value, base, { ...options, type: "image" });
      if (item.name === "style") item.value = rewriteCss(item.value, base, options);
    }
    if (node.tagName === "style") {
      for (const child of node.childNodes) if (child.nodeName === "#text") child.value = rewriteCss(child.value, base, options);
    }
  }
  const head = nodes.find((node) => node.tagName === "head");
  const bridge = parseFragment('<script src="/proxy-client.js"></script>').childNodes[0];
  setAttr(bridge, "data-target", target);
  setAttr(bridge, "data-base", base);
  setAttr(bridge, "data-request", requestUrl);
  setAttr(bridge, "data-adblock", adblock ? "1" : "0");
  setAttr(bridge, "data-logging", extra.logging ? "1" : "0");
  setAttr(bridge, "data-cache", extra.cache === false ? "0" : "1");
  bridge.parentNode = head;
  head.childNodes.unshift(bridge);
  return serialize(document);
}

export function errorHtml(message) {
  const document = parse('<!doctype html><html><head><meta charset="utf-8"><title>Unable to load page</title></head><body><main><h1>Unable to load this page</h1><p data-proxy-error></p><p>This proxy handles public HTTP(S) pages. WebSockets require the separately configured relay; VPN, TCP and UDP connections are not provided.</p></main></body></html>');
  const paragraph = nodesOf(document).find((node) => node.tagName === "p" && node.attrs.some((item) => item.name === "data-proxy-error"));
  paragraph.childNodes.push({ nodeName: "#text", value: message, parentNode: paragraph });
  return serialize(document);
}
