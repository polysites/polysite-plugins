// A "get your site ready" checklist on the admin dashboard, for a new site or a new editor.
//
// The steps tick themselves where the CMS can see the answer (a logo uploaded, a page added, a domain that is not a development
// name) and are ticked by hand where it cannot (backups run on the server). It is dismissible, and what was dismissed or ticked is
// remembered per site in this plugin's own table, `onboarding-progress`: nothing is added to Sites or to any core table. Reading
// the facts (pages, forms, media, people) uses the same API, and so the same access rules, as the rest of the admin: what the
// signed-in person may not read, the card does not show.
//
// It is a plugin, not core code, because it needs a table of its own, nothing in the core depends on it, and a team that does not
// want a checklist should be able to remove it. It declares itself as per-site settings (`custom.polysite.siteSettings`) so the core
// scopes the table to a site; none of its fields reach the public site (`publicFields` is empty).

const CARD = "../../../plugins/onboarding/src/admin/Checklist#Checklist";

const knownIds = (value) => value == null || (Array.isArray(value) && value.every((v) => typeof v === "string" && /^[a-z0-9-]{1,40}$/.test(v))) || "Use the names of steps.";

export default function onboardingPlugin(incomingConfig) {
  const Progress = {
    slug: "onboarding-progress",
    labels: { singular: "Setup checklist", plural: "Setup checklists" },
    admin: {
      // Reached from the dashboard card; nobody edits it as a document.
      hidden: true,
      useAsTitle: "title",
    },
    // Any signed-in person may read and update the row of a site they belong to (the core ANDs the site scope on top), because dismissing
    // the checklist is not a site setting. Only a Super Admin removes one.
    access: {
      read: ({ req: { user } }) => Boolean(user),
      create: ({ req: { user } }) => Boolean(user),
      update: ({ req: { user } }) => Boolean(user),
      delete: ({ req: { user } }) => user?.isSuperAdmin === true,
    },
    fields: [
      { name: "title", type: "text", defaultValue: "Setup checklist", admin: { hidden: true } },
      { name: "dismissed", type: "checkbox", defaultValue: false, label: "Dismissed" },
      // Plain text, not a select: a step can be added or renamed without a migration.
      { name: "doneByHand", type: "text", hasMany: true, validate: knownIds, label: "Ticked by hand" },
    ],
    custom: { polysite: { siteSettings: { key: "onboarding", publicFields: [] } } },
  };

  return {
    ...incomingConfig,
    collections: [...(incomingConfig.collections ?? []), Progress],
    admin: {
      ...incomingConfig.admin,
      components: { ...incomingConfig.admin?.components, beforeDashboard: [...(incomingConfig.admin?.components?.beforeDashboard ?? []), CARD] },
    },
  };
}
