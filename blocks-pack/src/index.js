import { buildBlocks } from "./blocks.js";

// Adds extra content blocks to the page builder (the `content` field of Pages). It adds no collection and no field to any other
// collection; the blocks keep their data in tables of their own, created by this plugin's migration. Removing the plugin deletes
// nothing: the pages keep the data, and the public site simply shows nothing for a block it no longer knows.
//
// The page, the blocks field and every block already in it are left exactly as they were; a block this plugin already added (the
// config applied twice) is not added again.
export default function blocksPackPlugin(incomingConfig, kit) {
  const added = buildBlocks(kit);
  return {
    ...incomingConfig,
    collections: (incomingConfig.collections ?? []).map((collection) => {
      if (collection.slug !== "pages") return collection;
      return {
        ...collection,
        fields: (collection.fields ?? []).map((field) => {
          if (field.type !== "blocks" || field.name !== "content") return field;
          const have = new Set((field.blocks ?? []).map((block) => block.slug));
          return { ...field, blocks: [...(field.blocks ?? []), ...added.filter((block) => !have.has(block.slug))] };
        }),
      };
    }),
  };
}
