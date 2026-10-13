// The settings of an import, with their defaults. Kept apart from the importer so the collections can read them
// without loading the XML and HTML libraries when the CMS builds its config.
export const DEFAULT_OPTIONS = {
  targetStatus: "draft",
  importPages: true,
  importPosts: true,
  importTags: true,
  importMedia: true,
  includeDrafts: false,
  includePrivate: false,
  includeTrashed: false,
  overwrite: false,
  onSlugConflict: "skip",
  bylineMode: "author",
  bylineText: "",
  authorMap: "",
  allowedMediaHosts: "",
  mediaMaxMb: 15,
  allowHttpMedia: true,
  createRedirects: true,
  menuMode: "append",
  menuName: "",
};
