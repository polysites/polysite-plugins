"use client";
import { createElement as h, useEffect, useState } from "react";

// A card on the admin dashboard that says the MCP endpoint is on and how to connect an AI agent to it. It is shown to anyone who may
// reach the API-key list (everyone signed in can make keys for their own account). Plain React.createElement (no JSX): plugin files
// are bundled as they are.
const box = { border: "1px solid var(--theme-elevation-150)", background: "var(--theme-elevation-50)", borderRadius: 4, padding: "14px 16px", marginBottom: 16 };
const code = { display: "block", fontFamily: "monospace", fontSize: 12, padding: "8px 10px", background: "var(--theme-elevation-100)", borderRadius: 3, overflowX: "auto", whiteSpace: "pre", margin: "6px 0" };

function Copy({ text }) {
  const [done, setDone] = useState(false);
  return h(
    "button",
    {
      type: "button",
      style: { fontSize: 12, cursor: "pointer", marginBottom: 6 },
      onClick: () => navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }),
    },
    done ? "Copied" : "Copy",
  );
}

export function McpPanel() {
  const [ok, setOk] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch("/api/payload-mcp-api-keys?limit=0&depth=0", { credentials: "include" })
      .then((r) => setOk(r.ok))
      .catch(() => setOk(false));
  }, []);

  if (!ok) return null;
  const url = `${origin}/api/mcp`;
  const claude = `claude mcp add --transport http polysite ${url} --header "Authorization: Bearer <your key>"`;
  const json = JSON.stringify({ mcpServers: { polysite: { type: "http", url, headers: { Authorization: "Bearer <your key>" } } } }, null, 2);

  return h(
    "div",
    { id: "polysite-mcp-panel", style: box },
    h("strong", null, "AI agents (MCP) is on"),
    h("p", { style: { margin: "6px 0" } }, "Connect Claude or any MCP client. It acts as you: what it may do is what your role allows."),
    h("ol", { style: { margin: "6px 0 8px 18px", padding: 0 } },
      h("li", null, h("a", { href: "/admin/collections/payload-mcp-api-keys/create" }, "Create a key"), " for your account, tick what it may use, generate and copy it (shown once)."),
      h("li", null, "Add the server to your agent with the address and key:"),
    ),
    h("div", null, "Server address", h("code", { style: code }, url)),
    h("div", null, "Claude Code", h(Copy, { text: claude }), h("code", { style: code }, claude)),
    h("div", null, "Other clients (JSON)", h(Copy, { text: json }), h("code", { style: code }, json)),
    h("p", { style: { margin: "6px 0 0" } }, h("a", { href: "/admin/collections/payload-mcp-api-keys" }, "Manage keys")),
  );
}
