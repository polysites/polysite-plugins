// The block description / validation and Markdown conversion of the MCP plugin, reused from the sibling folder instead of copied.
// Both files are dependency-free. Returns null when the folder is not there (see DESIGN.md, "Reuse of the MCP plugin").
let cached;

export async function loadMcp(importer = (u) => import(u)) {
  if (cached !== undefined) return cached;
  try {
    const [schema, markdown] = await Promise.all([
      importer(new URL("../../mcp/src/schema.js", import.meta.url).href),
      importer(new URL("../../mcp/src/markdown.js", import.meta.url).href),
    ]);
    cached = { describeBlocks: schema.describeBlocks, prepareBlocks: schema.prepareBlocks, markdownToLexical: markdown.markdownToLexical };
  } catch {
    cached = null;
  }
  return cached;
}

export const resetMcpCache = () => {
  cached = undefined;
};
