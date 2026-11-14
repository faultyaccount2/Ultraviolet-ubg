const pages = {
  terms: ["Terms", "Use this service only for lawful browsing. No availability, compatibility or security guarantee is made. Website terms, permissions, subscriptions and download restrictions still apply."],
  privacy: ["Privacy", "Settings, bookmarks, history, session data, optional request logs and download metadata are stored in your browser. Request logging is off by default and bounded. Proxied responses are processed transiently; passwords, authorization headers and application cookies are not forwarded. Vercel may process operational request metadata under its own policy. Public cache is opt-in and clearable; sensitive queries and authenticated responses are excluded."],
  legal: ["Legal", "This is an HTTP(S) transport and browser UI, not a VPN, access-control bypass or content-hosting platform. The operator has not supplied legal entity or jurisdiction details. These pages are operational notices, not legal advice."],
  copyright: ["Copyright", "Third-party material belongs to its authors. This service does not grant copying rights, strip attribution, mirror websites or bypass copyright controls. Proxy use does not override source-site permissions."],
  dmca: ["Copyright complaints", "This service does not accept user uploads or host a user-generated-content library. No verified private copyright-complaint contact or designated agent has been configured. Contact the source host about source material; do not publish personal or legal information in public issue reports."],
  "acceptable-use": ["Acceptable use", "Do not use this service for attacks, internal-network access, credential theft, abusive requests, unlawful content access, automated scraping, rate-limit evasion, or bypassing authentication, creator permissions and paid features."],
  abuse: ["Abuse reports", "Report technical faults or suspected misuse without including credentials, private messages or sensitive personal information. Public repository issues are not a secure complaint channel; no private operator channel has been configured."],
  contact: ["Contact", "The source repository provides public technical issue reporting. No operator email address or private contact channel has been supplied. Do not post passwords, tokens or private complaint details."],
  transparency: ["Transparency", "Pages stay inside the application. PROXY is the default and uses a stateless Vercel HTTP(S) stream with address validation, DNS pinning and isolated documents. Optional DIRECT mode uses an iframe and may be refused by the source site. Optional WebSocket relay connections require Supabase Auth and an exact operator-configured host allowlist; they are time- and message-size-limited. uBlock Origin network filtering applies only to proxied HTTP(S) requests. Browser extension features and cross-origin direct-frame inspection are not provided. The about:blank wrapper and title/favicon settings change presentation, not network visibility."],
};
const key = location.pathname.split("/").filter(Boolean)[0];
const [title, text] = pages[key] || pages.legal;
document.title = `${title} · bromine`;
document.querySelector("h1").textContent = title;
document.querySelector("#legal-text").textContent = text;
for (const [path, [name]] of Object.entries(pages)) {
  const link = document.createElement("a");
  link.href = `/${path}`; link.textContent = name;
  document.querySelector("#legal-nav").append(link);
}
