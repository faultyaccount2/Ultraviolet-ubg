import { parse, parseFragment, serialize } from "parse5";
import safeParser from "postcss-safe-parser";
import valueParser from "postcss-value-parser";
import { parseModule, parseScript } from "meriyah";
import { analyze } from "eslint-scope";
import { proxyUrl, moduleUrl } from "../shared/proxy-url.js";
import { mapSrcset } from "../shared/srcset.js";
import { decodeCssUrl } from "../shared/css-url.js";

function rewriteUrl(value, base, options) {
  if (!value.trim() || value.trim().startsWith("#")) return value;
  const url = new URL(value, base);
  if (!["http:", "https:"].includes(url.protocol)) return value;
  return proxyUrl(url.href, options);
}

export function rewriteJavaScript(source, target, options = {}) {
  if (!options.module && !/\b(?:location|import|export)\b/.test(source)) return source;
  let isModule = Boolean(options.module);
  const parseOptions = { ranges: true, next: true, webcompat: true };
  let ast;
  try { ast = (isModule ? parseModule : parseScript)(source, { ...parseOptions, globalReturn: !isModule }); }
  catch (error) {
    if (isModule || !(error instanceof SyntaxError)) throw error;
    // Preloads and generated script URLs do not always identify their module goal.
    ast = parseModule(source, parseOptions);
    isModule = true;
  }
  const changes = [];
  const parents = new WeakMap();
  const wrap = (node, prefix, suffix) => {
    changes.push({ start: node.start, end: node.start, order: -node.end, value: prefix });
    changes.push({ start: node.end, end: node.end, order: -node.start, value: suffix });
  };
  const hasLocation = (node) => node?.type === "ObjectPattern" && node.properties.some((property) =>
    property.type === "Property" && (!property.computed && property.key.name === "location" || property.key.value === "location"));
  const nodes = [[ast, null, false]];
  while (nodes.length) {
    const [node, parent, optionalChain] = nodes.pop();
    if (!node || typeof node !== "object") continue;
    if (parent) parents.set(node, parent);
    if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type) && node.source) {
      changes.push({
        start: node.source.start, end: node.source.end,
        value: JSON.stringify(moduleUrl(node.source.value, target, "", options)),
      });
    } else if (node.type === "ImportExpression") {
      wrap(node.source, "globalThis.__bromineModuleUrl(", `,${JSON.stringify(target)})`);
    } else if (node.type === "MemberExpression" && node.object.type === "MetaProperty" &&
        node.object.meta.name === "import" &&
        (!node.computed && node.property.name === "url" || node.computed && node.property.value === "url")) {
      changes.push({ start: node.start, end: node.end, value: options.inlineModule ? "globalThis.__bromineDocumentUrl" : JSON.stringify(target) });
      continue;
    } else if (node.type === "MemberExpression" && node.object.type !== "Super" && !optionalChain &&
        (!node.computed && node.property.name === "location" || node.computed && node.property.value === "location")) {
      wrap(node.object, "globalThis.__bromineLocationObject(", ")");
    } else if (node.type === "VariableDeclarator" && node.init && hasLocation(node.id)) {
      wrap(node.init, "globalThis.__bromineLocationObject(", ")");
    } else if (node.type === "AssignmentExpression" && hasLocation(node.left)) {
      wrap(node.right, "globalThis.__bromineLocationObject(", ")");
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child?.type) nodes.push([child, node, optionalChain || node.type === "ChainExpression"]);
      }
      else if (value?.type) nodes.push([value, node, optionalChain || node.type === "ChainExpression"]);
    }
  }
  const scopes = analyze(ast, {
    ecmaVersion: 2024, sourceType: isModule ? "module" : "script", ignoreEval: true, fallback: "iteration",
  });
  for (const reference of scopes.globalScope.through) {
    const node = reference.identifier;
    if (node.name !== "location" || reference.tainted) continue;
    const parent = parents.get(node);
    const shorthand = parent?.type === "Property" && parent.shorthand && parent.value === node;
    changes.push({
      start: node.start, end: node.end,
      value: `${shorthand ? "location:" : ""}globalThis.__bromineLocation${reference.isWrite() ? ".href" : ""}`,
    });
  }
  changes.sort((left, right) => left.start - right.start || left.end - right.end || (left.order || 0) - (right.order || 0));
  const output = [];
  let position = 0;
  for (const change of changes) {
    output.push(source.slice(position, change.start), change.value);
    position = change.end;
  }
  output.push(source.slice(position));
  return output.join("");
}

export function rewriteCss(source, base, options = {}) {
  const root = safeParser(source);
  function rewriteValue(value, type = "image") {
    const parsed = valueParser(value);
    parsed.walk((node) => {
      if (node.type !== "function" || node.value.toLowerCase() !== "url") return;
      const raw = valueParser.stringify(node.nodes).trim();
      const url = node.nodes.length === 1 && node.nodes[0].type === "string" ? node.nodes[0].value : raw;
      node.nodes = [{ type: "string", quote: '"', value: rewriteUrl(decodeCssUrl(url), base, { ...options, type }) }];
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
  return mapSrcset(value, (url) => rewriteUrl(url, base, options));
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
  const options = { adblock, origin: new URL(target).origin + "/", ...extra };
  for (const node of nodes) {
    if (!node.tagName) continue;
    const rel = (attr(node, "rel") || "").toLowerCase();
    const isModule = node.tagName === "script" && (attr(node, "type") || "").toLowerCase() === "module" ||
      node.tagName === "link" && rel.includes("modulepreload");
    const isScriptLink = node.tagName === "link" && (isModule || rel.split(/\s+/).includes("preload") && attr(node, "as") === "script");
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
        type = node.tagName !== "link" ? "document" : isScriptLink ? "script" : rel.includes("stylesheet") ? "stylesheet" : rel.includes("icon") ? "image" : "other";
      } else if (item.name === "src") {
        type = node.tagName === "script" ? "script" : ["img", "input"].includes(node.tagName) ? "image" : node.tagName === "iframe" ? "subdocument" : "media";
      } else if (item.name === "poster" || item.name === "background") type = "image";
      else if (item.name === "data" && node.tagName === "object") type = "object";
      if (type) item.value = rewriteUrl(item.value, base, { ...options, type, module: isModule });
      if (item.name === "srcset" || item.name === "imagesrcset") item.value = rewriteSrcset(item.value, base, { ...options, type: "image" });
      if (item.name === "style") item.value = rewriteCss(item.value, base, options);
      if (item.name.startsWith("on")) item.value = rewriteJavaScript(item.value, base, options);
    }
    if (node.tagName === "img" || node.tagName === "script" && attr(node, "src") ||
        node.tagName === "link" && rel.includes("stylesheet") || isScriptLink || ["audio", "video"].includes(node.tagName)) {
      setAttr(node, "crossorigin", "use-credentials");
    }
    if (node.tagName === "style") {
      for (const child of node.childNodes) if (child.nodeName === "#text") child.value = rewriteCss(child.value, base, options);
    }
    const scriptType = (attr(node, "type") || "").toLowerCase();
    if (node.tagName === "script" && !attr(node, "src") &&
        (!scriptType || isModule || /^(?:application|text)\/(?:javascript|ecmascript|x-javascript)(?:;|$)/.test(scriptType))) {
      for (const child of node.childNodes) if (child.nodeName === "#text") {
        child.value = rewriteJavaScript(child.value, base, { ...options, module: isModule, inlineModule: isModule });
      }
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
  setAttr(bridge, "data-cache-version", extra.cacheVersion || "");
  setAttr(bridge, "data-response-status", String(extra.responseStatus || 200));
  setAttr(bridge, "data-verification", extra.verification ? "1" : "0");
  setAttr(bridge, "data-cookie-state", extra.cookieState || "");
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
