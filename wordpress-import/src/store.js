// The import's view of the CMS: Payload's local API behind the small interface importer.js is written against.
// Everything here runs as the system (overrideAccess), after the endpoint has checked the person may import into this site.

export const COLLECTIONS = { imports: "wordpress-imports", map: "wordpress-import-map", log: "wordpress-import-log" };

const idOf = (v) => (v && typeof v === "object" ? v.id : v);

export async function createStore(payload, { siteId, importId }) {
  const siteDoc = await payload.findByID({ collection: "sites", id: siteId, depth: 0, overrideAccess: true });
  const news = String(siteDoc?.extensions?.news?.path ?? "").trim().replace(/^\/+|\/+$/g, "") || "news";
  const siteWhere = { site: { equals: siteId } };
  const hasPosts = Boolean(payload.collections?.posts && payload.collections?.["post-categories"]);

  const findOne = async (collection, extra) => {
    const res = await payload.find({ collection, where: { and: [siteWhere, ...extra] }, limit: 1, depth: 0, overrideAccess: true });
    return res.docs[0] ?? null;
  };

  const store = {
    site: { id: siteId, domain: siteDoc?.domain },
    hasPosts,
    newsPath: () => news,

    async existingSlugs(collection) {
      const res = await payload.find({ collection, where: siteWhere, limit: 0, pagination: false, depth: 0, overrideAccess: true, select: { slug: true } });
      return new Set(res.docs.map((d) => d.slug));
    },

    async allMapKeys() {
      const res = await payload.find({ collection: COLLECTIONS.map, where: { and: [siteWhere, { kind: { equals: "item" } }] }, limit: 0, pagination: false, depth: 0, overrideAccess: true });
      return new Map(res.docs.map((d) => [d.key, d]));
    },
    async findMap(kind, key) {
      return findOne(COLLECTIONS.map, [{ kind: { equals: kind } }, { key: { equals: key } }]);
    },
    async saveMap(kind, key, row) {
      const current = await store.findMap(kind, key);
      const data = { kind, key, collection: row.collection, docId: String(row.docId), writtenAt: Number(row.writtenAt) || Date.now(), hash: row.hash ?? null, site: siteId };
      if (current) await payload.update({ collection: COLLECTIONS.map, id: current.id, data, depth: 0, overrideAccess: true });
      else await payload.create({ collection: COLLECTIONS.map, data, depth: 0, overrideAccess: true });
    },

    async getDoc(collection, id) {
      return (await payload.findByID({ collection, id, depth: 0, overrideAccess: true, disableErrors: true })) ?? null;
    },
    // The latest edit of a document, counting saved drafts (a draft of a published page changes only its newest version).
    async lastTouched(collection, id) {
      const doc = await store.getDoc(collection, id);
      let t = doc?.updatedAt ? Date.parse(doc.updatedAt) : 0;
      if (payload.collections?.[collection]?.config?.versions) {
        const v = await payload.findVersions({ collection, where: { parent: { equals: id } }, sort: "-updatedAt", limit: 1, depth: 0, overrideAccess: true });
        const vt = v.docs[0]?.updatedAt ? Date.parse(v.docs[0].updatedAt) : 0;
        if (vt > t) t = vt;
      }
      return t;
    },
    async findDocBySlug(collection, slug) {
      return findOne(collection, [{ slug: { equals: slug } }]);
    },
    async create(collection, data, { draft } = {}) {
      return payload.create({ collection, data: { ...data, site: siteId }, ...(draft === undefined ? {} : { draft }), depth: 0, overrideAccess: true });
    },
    async update(collection, id, data, { draft } = {}) {
      return payload.update({ collection, id, data, ...(draft === undefined ? {} : { draft }), depth: 0, overrideAccess: true });
    },

    async createMedia({ buffer, mimetype, filename, alt }) {
      const doc = await payload.create({
        collection: "media",
        data: { alt, site: siteId },
        file: { data: buffer, mimetype, name: filename, size: buffer.length },
        depth: 0,
        overrideAccess: true,
      });
      return doc.id;
    },
    async mediaExists(id) {
      return Boolean(await store.getDoc("media", id));
    },

    async findRedirect(fromPath) {
      return findOne("redirects", [{ fromPath: { equals: fromPath } }]);
    },
    async saveRedirect(id, data) {
      if (id) return payload.update({ collection: "redirects", id, data, depth: 0, overrideAccess: true });
      return payload.create({ collection: "redirects", data: { ...data, site: siteId }, depth: 0, overrideAccess: true });
    },

    async getNav() {
      const site = await payload.findByID({ collection: "sites", id: siteId, depth: 0, overrideAccess: true });
      return (site?.headerNavItems ?? []).map((n) => ({ id: n.id, label: n.label, href: n.href }));
    },
    async setNav(items) {
      const rows = items.map(({ id, label, href }) => (id ? { id, label, href } : { label, href }));
      await payload.update({ collection: "sites", id: siteId, data: { headerNavItems: rows }, depth: 0, overrideAccess: true });
    },

    async log(rows) {
      for (const r of rows) {
        await payload.create({ collection: COLLECTIONS.log, data: { job: idOf(importId), site: siteId, ...r }, depth: 0, overrideAccess: true }).catch((err) => {
          console.error("[wordpress-import] could not write a log row:", err?.message ?? err);
        });
      }
    },
  };
  return store;
}
