"use client";
import { createElement as h, useEffect, useState } from "react";

// A list cell on pages and posts: one small tag per language the site offers, solid when this item has text in it and faint when
// it doesn't ("missing translation"). Reads the item's title in every language (`locale=all`), one request per visible row.
// The authoritative check is on the server; this only draws what it finds. Plain React.createElement (no JSX), like every plugin
// admin component.
const cache = new Map();

async function load(collection, id) {
  const key = `${collection}:${id}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      fetch(`/api/${collection}/${id}?locale=all&depth=0&draft=true&select[title]=true&select[site]=true`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    );
  }
  return cache.get(key);
}

const offered = new Map();
async function languagesOfSite(siteId) {
  if (siteId === undefined || siteId === null) return ["en"];
  if (!offered.has(siteId)) {
    offered.set(
      siteId,
      // The site's row in this plugin's own collection; a site with no row offers English only.
      fetch(`/api/site-languages?where[site][equals]=${encodeURIComponent(siteId)}&limit=1&depth=0`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((res) => {
          const s = res?.docs?.[0];
          const list = Array.isArray(s?.languages) ? s.languages.filter(Boolean) : [];
          if (!list.length) return ["en"];
          const def = list.includes(s.defaultLanguage) ? s.defaultLanguage : list[0];
          return [def, ...list.filter((c) => c !== def)];
        })
        .catch(() => ["en"]),
    );
  }
  return offered.get(siteId);
}

export function TranslationsCell({ rowData, collectionSlug }) {
  const [state, setState] = useState(null);
  const id = rowData?.id;

  useEffect(() => {
    let stopped = false;
    if (id === undefined || !collectionSlug) return undefined;
    (async () => {
      const doc = await load(collectionSlug, id);
      if (!doc || stopped) return;
      const siteId = doc.site && typeof doc.site === "object" ? doc.site.id : doc.site;
      const languages = await languagesOfSite(siteId);
      if (stopped) return;
      const titles = doc.title && typeof doc.title === "object" ? doc.title : {};
      setState({ languages, has: (code) => typeof titles[code] === "string" && titles[code].trim() !== "" });
    })();
    return () => {
      stopped = true;
    };
  }, [id, collectionSlug]);

  if (!state || state.languages.length < 2) return null;
  return h(
    "span",
    { style: { display: "inline-flex", gap: "4px", flexWrap: "wrap" } },
    state.languages.map((code) =>
      h(
        "span",
        {
          key: code,
          title: state.has(code) ? `Has ${code} text` : `Missing translation: ${code}`,
          style: {
            padding: "1px 6px",
            borderRadius: "10px",
            fontSize: "11px",
            textTransform: "uppercase",
            border: "1px solid var(--theme-elevation-300)",
            opacity: state.has(code) ? 1 : 0.4,
            textDecoration: state.has(code) ? "none" : "line-through",
          },
        },
        code,
      ),
    ),
  );
}
