// What a new site (or a new editor) is asked to do, and how each step is told to be done. Pure functions: the dashboard card
// (admin/Checklist.js) fetches the facts and this decides what to show, so the rules can be tested without a browser.

const DOCS = "https://polysites.github.io/polysite/guide";

/**
 * `who` says which people see the step:
 *   "settings"  people who may change the site's settings
 *   "pages", "forms", "media"  people whose role can create in that module
 *   "super"     Super Admins (steps about people and the server)
 *   "anyone"    every signed-in person
 * `auto` steps tick themselves from `done(facts)`; the rest are ticked by hand because the CMS cannot see the answer.
 */
export const ITEMS = [
  {
    id: "identity",
    who: "settings",
    label: "Add your logo",
    hint: "Shown in the header instead of the site name. Upload it under Branding on the site's settings page.",
    href: ({ siteId }) => `/admin/collections/sites/${siteId}`,
    done: ({ site }) => Boolean(site?.logo),
  },
  {
    id: "menu",
    who: "settings",
    label: "Add a menu",
    hint: "The links across the top of the site. Add them under Branding on the site's settings page.",
    href: ({ siteId }) => `/admin/collections/sites/${siteId}`,
    done: ({ site }) => Array.isArray(site?.headerNavItems) && site.headerNavItems.length > 0,
  },
  {
    id: "domain",
    who: "settings",
    label: "Connect your domain",
    hint: "Set the site's domain to the address visitors will use, and point it at your server.",
    href: ({ siteId }) => `/admin/collections/sites/${siteId}`,
    docs: `${DOCS}/deploying`,
    done: ({ site }) => isPublicDomain(site?.domain),
  },
  {
    id: "page",
    who: "pages",
    label: "Add a page of your own",
    hint: "The starter home page is already there. Add another, such as About or Contact, and publish it.",
    href: () => "/admin/collections/pages/create",
    done: ({ ownPages }) => ownPages > 0,
  },
  {
    id: "media",
    who: "media",
    label: "Upload a picture",
    hint: "Every picture needs a short description for people who cannot see it.",
    href: () => "/admin/collections/media/create",
    done: ({ media }) => media > 0,
  },
  {
    id: "form",
    who: "forms",
    label: "Add a form",
    hint: "A contact form or a sign-up. Put it on a page with the Form block.",
    href: () => "/admin/collections/forms/create",
    docs: `${DOCS}/forms`,
    done: ({ forms }) => forms > 0,
  },
  {
    id: "drafts",
    who: "anyone",
    manual: true,
    label: "Learn how drafts and publishing work",
    hint: "Save a draft and nothing changes for visitors until you publish.",
    docs: `${DOCS}/publishing`,
  },
  {
    id: "editor",
    who: "super",
    label: "Invite an editor",
    hint: "Create an account for each person and give them this site and a role.",
    href: () => "/admin/collections/users/create",
    done: ({ editors }) => editors > 0,
  },
  {
    id: "backups",
    who: "super",
    manual: true,
    label: "Turn on backups",
    hint: "Backups run on the server, so Polysite cannot see whether they are set up. Tick this when you have checked.",
    docs: `${DOCS}/backups`,
  },
];

/** Whether this hostname is one visitors could reach, as opposed to a development name or a bare address. */
export function isPublicDomain(domain) {
  const host = String(domain ?? "").trim().toLowerCase().replace(/:\d+$/, "");
  if (!host || !host.includes(".")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return false;
  return !/\.(localhost|local|test|example|invalid|internal|lan)$/.test(host);
}

function canCreate(role, module) {
  const modules = Array.isArray(role?.modules) ? role.modules : [];
  return modules.includes(module) && role?.operations?.create === true;
}

/** Does this person see the step? `person` is the signed-in user with the role filled in (GET /api/users/me). */
export function sees(item, person) {
  if (!person) return false;
  const superAdmin = person.isSuperAdmin === true;
  switch (item.who) {
    case "anyone":
      return true;
    case "super":
      return superAdmin;
    case "settings":
      return superAdmin || person.role?.manageSiteSettings === true;
    default:
      return superAdmin || canCreate(person.role, item.who);
  }
}

/**
 * The steps this person sees, each with whether it is done.
 * `facts` holds what could be read (a number or object, or undefined where the read was refused); `byHand` is the list of ids
 * somebody ticked.
 */
export function evaluate({ person, facts, byHand = [] }) {
  const ticked = new Set(byHand);
  const items = ITEMS.filter((item) => sees(item, person)).map((item) => ({
    id: item.id,
    label: item.label,
    hint: item.hint,
    docs: item.docs,
    href: item.href ? item.href(facts) : undefined,
    manual: item.manual === true,
    done: item.manual ? ticked.has(item.id) : item.done(facts) === true,
  }));
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, complete: items.length > 0 && done === items.length };
}

/** The site a person is working on, from the cookie the site switcher keeps. */
export function siteIdFromCookie(cookie) {
  const match = /(?:^|;\s*)payload-tenant=([^;]+)/.exec(String(cookie ?? ""));
  if (!match) return undefined;
  const id = decodeURIComponent(match[1]).trim();
  return /^\d+$/.test(id) ? id : undefined;
}
