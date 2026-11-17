const pages = {
  terms: ["Terms", [
    "Bromine is an experimental browser proxy and workspace. Use it only for lawful purposes and only with rights to access the remote services you choose.",
    "Bromine does not provide a VPN, guarantee anonymity, or bypass passwords, access controls, paid features, rate limits, CAPTCHAs, Cloudflare checks or other site restrictions. Websites and network operators may collect data and block or limit proxy traffic.",
    "You are responsible for following applicable law and the terms of the destination website. Features and availability can change; no compatibility, uptime or data-loss guarantee is made. Do not send secrets or sensitive material to support channels that are not private."
  ].join(" ")],
  privacy: ["Privacy", [
    "Bromine stores settings, bookmarks, history, open tabs and download metadata in this browser. A Wisp URL that you enter is stored in this browser profile; the public build does not supply the operator's private Wisp server to new profiles. Clearing browser storage removes these local settings.",
    "Scramjet runs on a separate frontend origin and uses the Bare or Wisp endpoint selected in Settings for website traffic. Bare terminates upstream TLS at its service; its operator can see request contents. Wisp relays TCP; its operator can see connection destinations and unencrypted traffic, while HTTPS remains encrypted end to end between the browser transport and website. Each endpoint operator may keep operational logs under its own policy.",
    "Optional request logs are local, transient metadata and are limited per tab. They do not include request bodies, cookies or authorization values. Sensitive URL parameters are removed from saved history, bookmarks, sessions and download metadata. Eligible public assets may be cached in this browser; the Classic legacy engine may also use the deployment edge cache. Open directly uses the browser's ordinary site session, separate from proxy storage. No analytics or remote wallpaper is required by the glass desktop."
  ].join(" ")],
  legal: ["Legal", "Bromine is an experimental browser proxy. This page describes current product behavior; it is not legal advice and does not create a service guarantee. The repository does not identify the service operator's legal entity, jurisdiction, or private legal contact. Operators must replace this notice with accurate deployment-specific information and seek qualified advice."],
  copyright: ["Copyright", "Bromine does not offer user uploads or a public publishing library. It retrieves pages selected by users and may cache eligible public assets for a limited time. Content remains the responsibility of its source and rights holders. Proxy access does not grant permission to copy, redistribute, record, or reuse a work. For a concern about content hosted at a third-party destination, contact that site's operator as well as the Bromine operator if the Bromine service itself is implicated."],
  dmca: ["Copyright complaints", [
    "No designated-agent name, postal address, telephone number, email, or private complaint channel has been configured for this deployment. Do not send legal notices, personal data, or evidence through public GitHub issues. A policy page alone does not register a DMCA agent or establish safe-harbor eligibility.",
    "Before operating publicly, the service operator should determine with counsel whether a designated agent is required, register the agent with the U.S. Copyright Office when applicable, publish the same contact details here, and establish a monitored notice and counter-notice process. A notice generally identifies the copyrighted work and the material location, gives claimant contact details, includes good-faith and accuracy/authority statements under penalty of perjury, and is signed. Counter-notices have separate statutory requirements and timelines.",
    "See the official U.S. Copyright Office Section 512 guide and DMCA Designated Agent Directory linked below. This service cannot guarantee that a third-party destination will remove or change its content."
  ].join(" ")],
  "acceptable-use": ["Acceptable use", "Do not use Bromine to attack systems, access private networks, steal credentials, evade paid access or authentication, defeat site rate limits, run abusive automation, or violate copyright and other rights. Destination owners and transport operators may block traffic. No CAPTCHA or access-control solver is included."],
  abuse: ["Abuse reports", "This deployment has no verified private abuse-report mailbox. Do not include passwords, access tokens, private messages, or sensitive personal information in public issue reports. Before public operation, the operator should publish a monitored abuse contact and explain what information to include and how urgent reports are handled."],
  contact: ["Contact", "The repository accepts public technical issues, but public issues are not a secure channel for legal, privacy, or security reports. The project has not supplied a verified operator email or postal address. The service operator must publish accurate private contact details before relying on this page for support or legal requests."],
  transparency: ["Transparency", [
    "Scramjet is the standard proxy engine for new browser profiles. Website requests use the Bare HTTP endpoint or the Wisp URL configured in that browser. New public builds do not include a private Wisp endpoint. The legacy Classic HTTP proxy remains available only in advanced settings for compatibility.",
    "A Wisp server must enforce its own origin, destination, port and resource restrictions. The Oracle Wisp endpoint configured by an individual is not shared by this build. Direct browsing opens a separate first-party browser tab; cookies and verification sessions do not move between direct browsing and proxy sessions.",
    "Sites may refuse proxy traffic, embedded frames, third-party storage or automated-looking connections. No CAPTCHA, Cloudflare, authentication, or access-control bypass is provided. The rain effect is generated locally and makes no network request."
  ].join(" ")],
};

const key = location.pathname.split("/").filter(Boolean)[0];
const [title, text] = pages[key] || pages.legal;
document.title = `${title} · bromine`;
document.querySelector("h1").textContent = title;
document.querySelector("#legal-text").textContent = text;
for (const [path, [name]] of Object.entries(pages)) {
  const link = document.createElement("a");
  link.href = `/${path}`;
  link.textContent = name;
  document.querySelector("#legal-nav").append(link);
}
