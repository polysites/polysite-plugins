"use client";
import { useConfig, useFormFields } from "@payloadcms/ui";
import { createElement as h, useEffect, useState } from "react";

import { buildPostUrl, newsPath } from "../urls.js";

// The public URL of a post: its site's domain, the site's news section, and the post's slug. Shown as a
// link in the Posts list (Cell) and under the slug in the editor (Field). Plain React.createElement (no JSX),
// like the plugin's other components. The scheme follows the admin's own, which matches the site's in every
// environment here (http locally, https in production).
//
// The list hands the Cell `site` as a bare id, not a populated object, so the site is looked up once per site
// per page load, shared by every row.
const siteCache = new Map();

function fetchSite(api, siteId) {
  let hit = siteCache.get(siteId);
  if (!hit) {
    hit = fetch(`${api}/sites/${siteId}?depth=0`, { credentials: "include" })
      .then((res) => res.json())
      .then((site) => (typeof site?.domain === "string" ? { domain: site.domain, section: newsPath(site) } : null))
      .catch(() => null);
    siteCache.set(siteId, hit);
  }
  return hit;
}

function useSiteInfo(siteRef) {
  const { config } = useConfig();
  const populated = siteRef && typeof siteRef === "object" ? siteRef : null;
  const siteId = populated ? populated.id : siteRef;
  const inline = typeof populated?.domain === "string" ? { domain: populated.domain, section: newsPath(populated) } : null;
  const [fetched, setFetched] = useState(null);
  const api = `${config.serverURL}${config.routes.api}`;

  useEffect(() => {
    if (inline || siteId === undefined || siteId === null || siteId === "") return;
    let cancelled = false;
    fetchSite(api, String(siteId)).then((info) => !cancelled && setFetched({ id: String(siteId), info }));
    return () => {
      cancelled = true;
    };
  }, [api, siteId, inline?.domain]); // eslint-disable-line react-hooks/exhaustive-deps

  if (inline) return inline;
  return siteId !== undefined && siteId !== null && fetched?.id === String(siteId) ? fetched.info : null;
}

const scheme = () => (typeof window !== "undefined" ? window.location.protocol.replace(":", "") : "https");
const linkStyle = { color: "inherit", textDecoration: "underline", wordBreak: "break-all" };

function Link({ href }) {
  return h("a", { href, target: "_blank", rel: "noopener noreferrer", style: linkStyle }, href.replace(/^https?:\/\//, ""));
}

export function PostFrontLinkCell({ rowData }) {
  const site = useSiteInfo(rowData?.site);
  return site ? h(Link, { href: buildPostUrl(site.domain, site.section, rowData?.slug, scheme()) }) : h("span", null, "—");
}

export function PostFrontLinkField() {
  const slug = useFormFields(([fields]) => fields.slug?.value);
  const siteRef = useFormFields(([fields]) => fields.site?.value);
  const site = useSiteInfo(siteRef);
  return h(
    "div",
    { className: "field-type", style: { marginBottom: "var(--base)" } },
    h("label", { className: "field-label" }, "Front-end Link"),
    site ? h(Link, { href: buildPostUrl(site.domain, site.section, slug, scheme()) }) : h("span", null, "—"),
  );
}
