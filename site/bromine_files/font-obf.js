(function runtime() {
  let mapping = null, initialized = !1, observer = null;
  const OBF_DATASET = "obf";
  function encode(text) {
    if (!mapping)
      return text;
    const map = mapping;
    return text.split("").map(function(char) {
      return map[char] ?? char;
    }).join("");
  }
  function obfuscateTextNode(node) {
    if (node.nodeType === 3) {
      const text = node.textContent || "", encoded = encode(text);
      if (encoded !== text)
        node.textContent = encoded;
    }
  }
  function shouldObfuscate(el) {
    if (!el || !initialized)
      return !1;
    try {
      if (el.matches && el.matches(".obfuscate"))
        return !0;
    } catch (err) {
      console.error(err);
    }
    return !1;
  }
  function isInsideObfuscatedContainer(el) {
    if (!el)
      return !1;
    return el.dataset[OBF_DATASET] !== void 0 || el.parentElement != null && isInsideObfuscatedContainer(el.parentElement);
  }
  function processElementTree(el) {
    if (el.dataset && el.dataset[OBF_DATASET])
      return;
    el.dataset[OBF_DATASET] = "1";
    for (let i = 0;i < el.childNodes.length; i++) {
      const child = el.childNodes[i];
      if (child.nodeType === 3)
        obfuscateTextNode(child);
      else if (child.nodeType === 1) {
        const tag = child.tagName;
        if (tag === "SCRIPT" || tag === "STYLE")
          continue;
        if (shouldObfuscate(child) || isInsideObfuscatedContainer(child))
          processElementTree(child);
      }
    }
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT" && el.type !== "checkbox" && el.type !== "radio")
      el.placeholder = encode(el.placeholder || "");
  }
  async function init() {
    if (typeof window < "u" && window.__FONT_MAPPING__)
      mapping = window.__FONT_MAPPING__;
    else
      try {
        mapping = await (await fetch("/mappings.json?t=" + Date.now())).json();
      } catch (e) {
        console.error("Failed to load obfuscation mapping:", e);
        return;
      }
    initialized = !0;
    const all = document.querySelectorAll("*");
    for (let i = 0;i < all.length; i++) {
      const el = all[i];
      if (shouldObfuscate(el) && !el.dataset[OBF_DATASET])
        processElementTree(el);
    }
    if (typeof MutationObserver > "u")
      return;
    if (observer)
      observer.disconnect();
    observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.type === "attributes") {
          const target = mutation.target;
          if (target.nodeType === 1 && mutation.attributeName === "class") {
            const el = target;
            if (el.dataset[OBF_DATASET] && !el.matches(".obfuscate"))
              delete el.dataset[OBF_DATASET];
            if (shouldObfuscate(el))
              processElementTree(el);
          }
        }
        for (let i = 0;i < mutation.addedNodes.length; i++) {
          const node = mutation.addedNodes[i];
          if (node.nodeType === 1) {
            const el = node;
            if (el.matches && el.matches(".obfuscate")) {
              processElementTree(el);
              continue;
            }
            if (isInsideObfuscatedContainer(el)) {
              if (shouldObfuscate(el) || isInsideObfuscatedContainer(el))
                processElementTree(el);
            }
            if (el.querySelectorAll) {
              const obfChildren = el.querySelectorAll(".obfuscate");
              for (let k = 0;k < obfChildren.length; k++) {
                const child = obfChildren[k];
                if (!child.dataset[OBF_DATASET])
                  processElementTree(child);
              }
            }
          } else if (node.nodeType === 3) {
            const parent = node.parentElement;
            if (parent && (isInsideObfuscatedContainer(parent) || shouldObfuscate(parent)))
              obfuscateTextNode(node);
          }
        }
        if (mutation.type === "characterData" && mutation.target.parentElement) {
          const parent = mutation.target.parentElement;
          if (isInsideObfuscatedContainer(parent) || shouldObfuscate(parent))
            obfuscateTextNode(mutation.target);
        }
      });
    });
    observer.observe(document.body || document.documentElement, {
      childList: !0,
      subtree: !0,
      characterData: !0,
      attributes: !0,
      attributeFilter: ["class"]
    });
  }
  if (document.readyState === "complete")
    init();
  else
    window.addEventListener("load", init);
})();