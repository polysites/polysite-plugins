// An in-memory store with the same surface as src/store.js, for testing the import logic without a database.
export function memoryStore({ hasPosts = true, news = "news", nav = [] } = {}) {
  let clock = 1_000_000;
  const tick = () => (clock += 10);
  const cols = { pages: new Map(), posts: new Map(), "post-categories": new Map(), media: new Map(), redirects: new Map() };
  const maps = new Map(); // `${kind}|${key}` -> row
  let nextId = 1;
  const state = { nav: [...nav], logs: [], progress: [] };

  const store = {
    site: { id: 1, domain: "site.test" },
    hasPosts,
    state,
    cols,
    newsPath: () => news,
    async existingSlugs(collection) {
      return new Set([...cols[collection].values()].map((d) => d.slug));
    },
    async allMapKeys() {
      const out = new Map();
      for (const [k, v] of maps) if (k.startsWith("item|")) out.set(k.slice(5), v);
      return out;
    },
    async findMap(kind, key) {
      return maps.get(`${kind}|${key}`) ?? null;
    },
    async saveMap(kind, key, row) {
      maps.set(`${kind}|${key}`, { ...row });
    },
    async getDoc(collection, id) {
      return cols[collection]?.get(String(id)) ?? null;
    },
    async lastTouched(collection, id) {
      return cols[collection].get(String(id))?.touched ?? 0;
    },
    async findDocBySlug(collection, slug) {
      return [...cols[collection].values()].find((d) => d.slug === slug) ?? null;
    },
    async create(collection, data, { draft } = {}) {
      const id = String(nextId++);
      const doc = { id, ...structuredClone(data), draft: Boolean(draft), touched: tick() };
      cols[collection].set(id, doc);
      return doc;
    },
    async update(collection, id, data, { draft } = {}) {
      const doc = cols[collection].get(String(id));
      Object.assign(doc, structuredClone(data), { draft: Boolean(draft), touched: tick() });
      return doc;
    },
    async createMedia({ buffer, mimetype, filename, alt }) {
      const id = String(nextId++);
      cols.media.set(id, { id, size: buffer.length, mimetype, filename, alt, touched: tick() });
      return id;
    },
    async mediaExists(id) {
      return cols.media.has(String(id));
    },
    async findRedirect(fromPath) {
      return [...cols.redirects.values()].find((r) => r.fromPath === fromPath) ?? null;
    },
    async saveRedirect(id, data) {
      if (id) {
        Object.assign(cols.redirects.get(String(id)), data);
        return cols.redirects.get(String(id));
      }
      const doc = { id: String(nextId++), ...data };
      cols.redirects.set(doc.id, doc);
      return doc;
    },
    async getNav() {
      return state.nav.map((n) => ({ ...n }));
    },
    async setNav(items) {
      state.nav = items.map((n) => ({ ...n }));
    },
    async log(rows) {
      state.logs.push(...rows);
    },
    async setProgress(p) {
      state.progress.push(p);
    },
    // test helpers
    edit(collection, id, patch) {
      Object.assign(cols[collection].get(String(id)), patch, { touched: tick() });
    },
    bySlug(collection, slug) {
      return [...cols[collection].values()].find((d) => d.slug === slug);
    },
    logCodes() {
      return state.logs.map((l) => l.code);
    },
  };
  return store;
}
