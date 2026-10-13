// Local development only: switches search on for the dev site, so the box and the results page can be tried straight away.
// The core's dev seed scripts (apps/cms/scripts/devPlugins.ts) call `seedDevData` for every installed plugin that has this file.

export async function seedDevData(payload, { site }) {
  const found = await payload.find({ collection: "search-settings", where: { site: { equals: site.id } }, limit: 1, depth: 0, overrideAccess: true });
  const current = found.docs[0];
  if (current?.enabled === true) return `Search is already on for ${site.domain}.`;
  if (current) await payload.update({ collection: "search-settings", id: current.id, data: { enabled: true }, overrideAccess: true });
  else await payload.create({ collection: "search-settings", data: { site: site.id, enabled: true }, overrideAccess: true });
  return `Switched search on for ${site.domain}.`;
}
