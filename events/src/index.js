import { buildCollections } from "./collections.js";
import { endpoints } from "./endpoints.js";
import { buildOrderEndpoints } from "./orderEndpoints.js";
import { expireOrders, retryReported } from "./orders.js";
import { pruneRsvps, sendDueReminders } from "./reminders.js";
import { checkEventsPath, DEFAULT_EVENTS_LABEL, DEFAULT_EVENTS_PATH, DEFAULT_PER_PAGE } from "./urls.js";

// What of a site's event settings the public site may read. The core attaches these to the site the web app already fetches, as
// `site.extensions.events` (apps/cms/src/plugins/siteSettings.ts).
export const PUBLIC_FIELDS = ["label", "path", "perPage", "defaultTimeZone"];

// Events with free RSVP. Adds `events` and `event-rsvps` (the content), a small table of counters, and `event-settings`, one row per
// site, which says where that site shows its events. Applied before the core plugins (the manifest says
// `"kind": ["content-type", "site-settings"]`), which then scope the collections to a site and wire the role module, SEO and the URL index.
//
//  - RSVP: a public endpoint (endpoints.js) checks the event, the spam protections and the places left, takes the places with one
//    atomic statement (db.js), writes the RSVP and sends the confirmation (service.js, mail.js);
//  - waiting list: a cancellation, a staff change or a larger capacity moves the next person up automatically;
//  - reminders and clean-up: two small background sweeps (reminders.js).
//
// Removing the plugin deletes nothing: its tables stay in the database.
export default function eventsPlugin(incomingConfig, kit) {
  const EventSettings = {
    slug: "event-settings",
    labels: { singular: "Event settings", plural: "Event settings" },
    admin: {
      group: "Administration",
      description: "Where this site shows its events, and what happens around them. Turn the Events module on for the site under General, Enabled Modules.",
      hidden: ({ user }) => !kit.canManageSiteSettings(user),
      custom: { navSubgroup: "Site features" },
    },
    access: {
      read: ({ req: { user } }) => Boolean(user),
      create: ({ req: { user } }) => kit.canManageSiteSettings(user),
      update: ({ req: { user } }) => kit.canManageSiteSettings(user),
      delete: ({ req: { user } }) => kit.canManageSiteSettings(user),
    },
    fields: [
      { name: "label", type: "text", defaultValue: DEFAULT_EVENTS_LABEL, admin: { description: "The heading of the list of events, and what themes call the section." } },
      {
        name: "path",
        type: "text",
        label: "Section address",
        defaultValue: DEFAULT_EVENTS_PATH,
        admin: { description: "The list lives at /<this>, and each event at /<this>/<event-slug>. A page with the same slug as this is hidden by the list." },
        validate: (value) => checkEventsPath(value) ?? true,
      },
      { name: "perPage", type: "number", label: "Events per page", defaultValue: DEFAULT_PER_PAGE, min: 1, max: 50 },
      {
        name: "defaultTimeZone",
        type: "text",
        admin: { description: "Used for an event that has no time zone of its own, like America/Toronto. Empty means UTC." },
        validate: (value) => {
          if (!value) return true;
          try {
            new Intl.DateTimeFormat("en", { timeZone: value });
            return true;
          } catch {
            return "That isn't a time zone name. Use one like America/Toronto or Europe/Paris.";
          }
        },
      },
      { name: "senderName", type: "text", admin: { description: "The name confirmation emails come from, like \"Spring Rally\". The address is the site's email setting." } },
      {
        name: "paymentProvider",
        type: "text",
        admin: { description: "Who takes the money for tickets, by the name the payment plugin gives it. Empty uses the only one installed. Only needed for events with priced tickets." },
        validate: (value, { req }) => {
          const wanted = String(value ?? "").trim();
          if (!wanted) return true;
          const installed = Object.keys(req?.payload?.config?.custom?.polysitePayments ?? {});
          return installed.includes(wanted) ? true : `No payment plugin called "${wanted}" is installed.${installed.length ? ` Installed: ${installed.join(", ")}.` : " None is installed."}`;
        },
      },
      { name: "currency", type: "text", defaultValue: "CAD", admin: { description: "Three letters, like CAD or USD. Shown with ticket prices and in emails; the payment provider's own page decides what is charged." }, validate: (value) => (!value || /^[A-Z]{3}$/.test(String(value)) ? true : "Use three capital letters, like CAD.") },
      { name: "reminders", type: "checkbox", defaultValue: true, label: "Send a reminder the day before", admin: { description: "One email to everyone confirmed, about 24 hours before the event starts." } },
      {
        name: "retentionDays",
        type: "number",
        label: "Keep RSVPs for (days)",
        defaultValue: 180,
        min: 1,
        max: 3650,
        admin: { description: "RSVPs hold names and email addresses. They are deleted this many days after the event ends. The events themselves stay." },
      },
      { name: "resetEvents", type: "ui", admin: { components: { Field: "../../../plugins/events/src/admin/ResetEventSettings#ResetEventSettings" } } },
    ],
    custom: { polysite: { siteSettings: { key: "events", publicFields: PUBLIC_FIELDS } } },
  };

  const previous = incomingConfig.onInit;
  return {
    ...incomingConfig,
    collections: [...(incomingConfig.collections ?? []), ...buildCollections(kit), EventSettings],
    endpoints: [...(incomingConfig.endpoints ?? []), ...endpoints, ...buildOrderEndpoints(kit)],
    onInit: async (payload) => {
      await previous?.(payload);
      // Two light sweeps for a single-server install: reminders every ten minutes, old RSVPs every six hours.
      const remind = () => sendDueReminders(payload).catch((err) => console.error("[events] reminder sweep failed:", err?.message ?? err));
      const prune = () => pruneRsvps(payload);
      // Every minute: let go of the places of orders nobody finished paying for, and look again at payments that could not be confirmed.
      const orders = () => Promise.all([expireOrders(payload), retryReported(payload)]).catch((err) => console.error("[events] order sweep failed:", err?.message ?? err));
      setInterval(orders, Number.parseInt(process.env.EVENTS_SWEEP_MS ?? "", 10) || 60 * 1000).unref?.();
      setInterval(remind, 10 * 60 * 1000).unref?.();
      setInterval(prune, 6 * 60 * 60 * 1000).unref?.();
      setTimeout(prune, 60 * 1000).unref?.();
    },
  };
}
