import { applyDelta } from "./db.js";
import { availability, HARD_MAX_GUESTS, redirectProblem } from "./rsvp.js";
import { availabilityOf, contribution, forgetAvailability, promoteWaitlist } from "./service.js";
import { MODULE, SLUGS } from "./slugs.js";
import { dedupeKey } from "./spam.js";
import { eventUrlFromDoc, eventsPath, RESERVED_EVENT_SLUGS } from "./urls.js";

// Sidebar icons, as SVG path data on a 24 x 24 grid (the core draws them; see AdminNav/icons.tsx).
const EVENTS_ICON = { paths: ["M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z", "M4 10h16", "M8 2v4", "M16 2v4", "M8 14h3", "M13 14h3", "M8 17h3"] };
const RSVPS_ICON = { paths: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M22 21v-2a4 4 0 0 0-3-3.9", "M16 3.1a4 4 0 0 1 0 7.8"] };

const ORDERS_ICON = { paths: ["M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z", "M13 5v14"] };
const ORDER_ACTIONS = "../../../plugins/events/src/admin/OrderActions#OrderActions";
const SUMMARY = "../../../plugins/events/src/admin/RsvpSummary#RsvpSummary";
const FRONT_LINK_CELL = "../../../plugins/events/src/admin/FrontLink#EventFrontLinkCell";
const FRONT_LINK_FIELD = "../../../plugins/events/src/admin/FrontLink#EventFrontLinkField";
const RESET = "../../../plugins/events/src/admin/ResetEventSettings#ResetEventSettings";

const clientError = (message, status = 400) => Object.assign(new Error(message), { status, isPublic: true });

// The events, their RSVPs and a small table of counters, built from the toolkit the core passes every plugin (a plugin can't import
// from the app). `site` is added to events and event-rsvps by the core, which scopes every collection a content-type plugin declares.
export function buildCollections(kit) {
  const { hasCapability, normalizeSlug, uniquePerSite, recordException, workflow, i18n } = kit;
  const slugIsFreePerSite = uniquePerSite(SLUGS.events, "slug");

  // Anyone with the events:read capability sees drafts too; everyone else (visitors included) sees only what is published.
  const readAccess = ({ req: { user } }) => (hasCapability(user, "events", "read") ? true : { _status: { equals: "published" } });
  const validateSlug = (value, options) => (typeof value === "string" && RESERVED_EVENT_SLUGS.includes(value) ? `"${value}" is part of the events addresses. Choose another slug.` : slugIsFreePerSite(value, options));

  async function revalidateSite() {
    const url = process.env.NUXT_REVALIDATE_URL;
    if (!url) return;
    try {
      await fetch(url, { method: "POST", headers: { "x-revalidate-secret": process.env.REVALIDATE_SECRET || "" } });
    } catch (err) {
      console.error("Failed to trigger frontend revalidation", err);
      recordException(err);
    }
  }

  const events = {
    slug: SLUGS.events,
    labels: { singular: "Event", plural: "Events" },
    custom: {
      polysite: {
        module: MODULE,
        icon: EVENTS_ICON,
        routable: { docType: "event", urlPath: (doc, { site }) => `${eventsPath(site)}/${doc.slug}`, previewUrl: (doc, req) => eventUrlFromDoc(doc, req) },
      },
    },
    admin: {
      useAsTitle: "title",
      defaultColumns: ["title", "startsAt", "_status", "reviewState", "frontLink"],
      group: "Content",
      description: "Events with an RSVP form. Each site lists its own under the section address set in Event settings.",
    },
    defaultSort: "startsAt",
    access: {
      read: readAccess,
      create: ({ req: { user } }) => hasCapability(user, "events", "create"),
      update: workflow.publishAware(SLUGS.events, ({ req: { user } }) => hasCapability(user, "events", "update")),
      delete: ({ req: { user } }) => hasCapability(user, "events", "delete"),
      readVersions: ({ req: { user } }) => hasCapability(user, "events", "read"),
    },
    versions: { maxPerDoc: 25, drafts: { autosave: false, schedulePublish: true, validate: false } },
    forceSelect: { site: true, slug: true },
    fields: [
      { name: "summaryPanel", type: "ui", admin: { components: { Field: SUMMARY } } },
      { name: "title", type: "text", required: true, hooks: { beforeDuplicate: [({ value }) => (typeof value === "string" && value ? `${value} (Copy)` : value)] } },
      {
        name: "slug",
        type: "text",
        required: true,
        hooks: { beforeValidate: [({ value }) => (typeof value === "string" ? normalizeSlug(value) : value)] },
        validate: validateSlug,
        admin: { description: "The end of the event's address, like spring-rally" },
      },
      { name: "frontLink", type: "ui", label: "Front-end Link", admin: { components: { Cell: FRONT_LINK_CELL, Field: FRONT_LINK_FIELD } } },
      ...workflow.reviewFields(SLUGS.events),
      {
        name: "startsAt",
        type: "date",
        required: true,
        label: "Starts",
        admin: { position: "sidebar", date: { pickerAppearance: "dayAndTime" }, description: "Shown in the event's own time zone (below)." },
      },
      { name: "endsAt", type: "date", label: "Ends", admin: { position: "sidebar", date: { pickerAppearance: "dayAndTime" }, description: "Optional. Without it the event is taken to last an hour." } },
      {
        name: "timeZone",
        type: "text",
        admin: { position: "sidebar", description: "The place's time zone, like America/Toronto. Empty uses the site's default (Event settings), then UTC." },
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
      { name: "venueName", type: "text", admin: { description: "The place's name, like City Hall" } },
      { name: "address", type: "text", admin: { description: "Street address, shown and put in the calendar file" } },
      { name: "onlineUrl", type: "text", label: "Online link", admin: { description: "For an online or hybrid event. Optional." } },
      { name: "heroImage", type: "upload", relationTo: "media", label: "Picture", admin: { description: "Shown at the top of the event and in the list." } },
      { name: "summary", type: "textarea", maxLength: 400, admin: { description: "A sentence or two for the list and for search results." } },
      { name: "body", type: "richText" },
      {
        name: "tickets",
        type: "array",
        label: "Tickets",
        admin: { description: "Leave empty for a free event with the RSVP form. Add tickets with a price to sell them instead: the RSVP form is replaced by a ticket form, and the visitor pays on the payment provider's page (set under Event settings). Capacity above counts people, one per ticket." },
        fields: [
          {
            name: "code",
            type: "text",
            required: true,
            admin: { description: "A short code, lower-case letters, digits, - and _ (like general or student). Used in the order and sent to the payment provider." },
            validate: (value) => (/^[a-z0-9][a-z0-9_-]{0,39}$/.test(String(value ?? "")) ? true : "Use lower-case letters, digits, - and _ (40 characters at most)."),
          },
          { name: "label", type: "text", required: true, admin: { description: "What the visitor sees, like General admission" } },
          { name: "description", type: "text" },
          { name: "price", type: "number", required: true, min: 0, admin: { description: "In dollars, like 25 or 12.50. 0 makes a free ticket." } },
          { name: "nonReceiptable", type: "number", min: 0, label: "Not eligible for a tax receipt", admin: { description: "How many dollars of the price are not eligible for a charitable receipt (the value of a meal, say). Empty means none." } },
          { name: "sponsorship", type: "checkbox", defaultValue: false, admin: { description: "A contribution, not a seat: it adds to the total but does not take a place." } },
          { name: "maxPerOrder", type: "number", min: 1, max: 20, admin: { description: "The most one person can buy in one order. Empty means 20." } },
        ],
      },
      {
        name: "rsvp",
        type: "group",
        label: "RSVP",
        fields: [
          { name: "open", type: "checkbox", defaultValue: true, label: "Taking RSVPs", admin: { description: "Untick to stop taking RSVPs without unpublishing the event." } },
          { name: "opensAt", type: "date", label: "Opens", admin: { date: { pickerAppearance: "dayAndTime" }, description: "Optional. Before this the page says registration isn't open yet." } },
          { name: "closesAt", type: "date", label: "Closes", admin: { date: { pickerAppearance: "dayAndTime" }, description: "Optional. Registration always closes when the event ends." } },
          { name: "capacity", type: "number", min: 1, admin: { description: "How many people can come in all. Empty means no limit." } },
          { name: "maxGuests", type: "number", min: 1, max: HARD_MAX_GUESTS, defaultValue: 1, label: "People per RSVP", admin: { description: "1 means one person per RSVP. More lets a person bring others (themselves included); capacity counts every person." } },
          { name: "waitlist", type: "checkbox", defaultValue: false, label: "Waiting list when full", admin: { description: "When on, people who RSVP after the event is full wait in order and are moved up automatically when a place opens." } },
          { name: "askPhone", type: "checkbox", defaultValue: false, label: "Ask for a phone number" },
          { name: "phoneRequired", type: "checkbox", defaultValue: false, admin: { condition: (_data, sibling) => Boolean(sibling?.askPhone) } },
          { name: "consentLabel", type: "text", admin: { description: "A checkbox the person must tick, such as \"I agree to be contacted about this event.\" Empty means no checkbox. Say here if their details go to another system." } },
          { name: "submitLabel", type: "text", defaultValue: "Register", label: "Button label" },
          { name: "confirmationMessage", type: "textarea", maxLength: 400, admin: { description: "Shown after a successful RSVP. Empty uses a standard message." } },
          { name: "redirectUrl", type: "text", label: "Send them to", admin: { description: "After a successful RSVP, go to this page instead of showing the message: a path on this site (like /thank-you) or a full https:// address." }, validate: (value) => redirectProblem(value) ?? true },
        ],
      },
      {
        // What the public site and the list read. Computed from the counters; never stored on the event, because an event has
        // versions and a stored copy of a count would be overwritten by publishing an older draft.
        name: "availability",
        type: "json",
        virtual: true,
        admin: { hidden: true, disableListColumn: true, disableListFilter: true },
        hooks: {
          afterRead: [
            async ({ siblingData, data, req }) => {
              const doc = { ...(data ?? {}), ...(siblingData ?? {}) };
              const id = doc.id ?? data?.id;
              if (id == null || !req?.payload) return undefined;
              try {
                return await availabilityOf(req.payload, { id, startsAt: doc.startsAt, endsAt: doc.endsAt, rsvp: doc.rsvp });
              } catch {
                return undefined;
              }
            },
          ],
        },
      },
    ],
    hooks: {
      // An event with RSVPs or orders is not deleted out from under them: they are people's details and, for orders, money. Staff are told
      // what to do instead. An event nobody registered for goes, together with its counter row.
      beforeDelete: [
        async ({ id, req }) => {
          const [rsvpCount, orderCount] = await Promise.all([
            req.payload.count({ collection: SLUGS.rsvps, where: { event: { equals: id } }, overrideAccess: true, req }),
            req.payload.count({ collection: SLUGS.orders, where: { event: { equals: id } }, overrideAccess: true, req }),
          ]);
          if (orderCount.totalDocs > 0) throw clientError(`This event has ${orderCount.totalDocs} ticket order${orderCount.totalDocs === 1 ? "" : "s"}, so it can't be deleted. Unpublish it instead.`, 409);
          if (rsvpCount.totalDocs > 0) throw clientError(`This event has ${rsvpCount.totalDocs} RSVP${rsvpCount.totalDocs === 1 ? "" : "s"}. Delete them first (they are people's details), or just unpublish the event.`, 409);
          await req.payload.delete({ collection: SLUGS.stats, where: { event: { equals: id } }, overrideAccess: true, req });
        },
      ],
      beforeChange: [workflow.publishRules(SLUGS.events, SLUGS.events)],
      afterChange: [
        async ({ doc, previousDoc, req }) => {
          if (workflow.changesLiveSite({ isDraftSave: workflow.isDraftRequest(req.query) })) await revalidateSite();
          // Room was made (a larger capacity, or the limit removed): let the waiting list in.
          const before = previousDoc?.rsvp?.capacity;
          const after = doc?.rsvp?.capacity;
          if (doc?._status === "published" && previousDoc && (after == null || (before != null && after > before))) {
            forgetAvailability(doc.id);
            await promoteWaitlist({ payload: req.payload, eventId: doc.id, req }).catch((err) => console.error("[events] promoting the waiting list failed:", err?.message ?? err));
          }
          return doc;
        },
      ],
      afterDelete: [
        async ({ doc }) => {
          if (doc?._status === "published") await revalidateSite();
        },
      ],
    },
  };

  const rsvps = {
    slug: SLUGS.rsvps,
    labels: { singular: "RSVP", plural: "RSVPs" },
    custom: { polysite: { module: MODULE, icon: RSVPS_ICON } },
    admin: {
      useAsTitle: "name",
      defaultColumns: ["name", "email", "event", "guests", "status", "createdAt"],
      group: "Content",
      description: "Who has registered for which event. People register on the site; staff can add, move between the waiting list and confirmed, or cancel here. Personal data: kept for the number of days set in Event settings after the event.",
    },
    defaultSort: "-createdAt",
    // Never public. Visitors register through the plugin's endpoint, which checks the event, the spam protections and the places left.
    access: {
      read: ({ req: { user } }) => hasCapability(user, "events", "read"),
      create: ({ req: { user } }) => hasCapability(user, "events", "create"),
      update: ({ req: { user } }) => hasCapability(user, "events", "update"),
      delete: ({ req: { user } }) => hasCapability(user, "events", "delete"),
    },
    indexes: [{ fields: ["event", "dedupeKey"], unique: true }],
    fields: [
      { name: "event", type: "relationship", relationTo: SLUGS.events, required: true, index: true },
      { name: "name", type: "text", required: true },
      { name: "email", type: "email", required: true, index: true },
      { name: "phone", type: "text" },
      { name: "guests", type: "number", defaultValue: 1, min: 1, max: HARD_MAX_GUESTS, admin: { description: "How many people, the person included." } },
      {
        name: "status",
        type: "select",
        defaultValue: "confirmed",
        required: true,
        index: true,
        options: [
          { label: "Confirmed", value: "confirmed" },
          { label: "Waiting list", value: "waitlisted" },
          { label: "Paying (places held)", value: "pending_payment" },
          { label: "Cancelled", value: "cancelled" },
        ],
        admin: { description: "Moving someone from the waiting list to Confirmed here does not check the capacity. Cancelling gives their places back and lets the next person in." },
      },
      { name: "notes", type: "textarea", admin: { description: "For staff only." } },
      {
        name: "consent",
        type: "group",
        admin: { readOnly: true },
        fields: [
          { name: "given", type: "checkbox", admin: { description: "They ticked the consent box." } },
          { name: "statement", type: "textarea", admin: { description: "The wording they were shown." } },
        ],
      },
      { name: "dedupeKey", type: "text", index: true, admin: { hidden: true, readOnly: true } },
      { name: "reminderSentAt", type: "date", admin: { readOnly: true } },
    ],
    hooks: {
      // One person, one place, however the RSVP was made: staff who add someone by hand give them the same key a visitor would get, a
      // cancelled RSVP lets go of its key (so the person can register again), and bringing one back checks nobody else holds it.
      beforeChange: [
        async ({ data, originalDoc, operation, req }) => {
          const status = data.status ?? originalDoc?.status ?? "confirmed";
          if (status === "cancelled") {
            data.dedupeKey = null;
            return data;
          }
          const event = data.event ?? originalDoc?.event;
          const email = data.email ?? originalDoc?.email;
          const eventId = event && typeof event === "object" ? event.id : event;
          if (eventId == null || !email) return data;
          const key = dedupeKey(eventId, email);
          if ((data.dedupeKey ?? originalDoc?.dedupeKey) === key) return data;
          const clash = await req.payload.find({
            collection: SLUGS.rsvps,
            where: { and: [{ event: { equals: eventId } }, { dedupeKey: { equals: key } }, ...(originalDoc?.id ? [{ id: { not_equals: originalDoc.id } }] : [])] },
            limit: 1,
            depth: 0,
            overrideAccess: true,
            req,
          });
          if (clash.totalDocs > 0 && operation !== "delete") throw clientError("Someone with this email address already has an RSVP for this event.");
          data.dedupeKey = key;
          return data;
        },
      ],
      // The places left follow every change to an RSVP, whoever made it (a staff edit, a cancellation, the waiting list). An RSVP
      // made through the site has already taken its places (context.eventsClaimed).
      afterChange: [
        async ({ doc, previousDoc, operation, req, context }) => {
          const eventId = typeof doc.event === "object" ? doc.event.id : doc.event;
          if (!(operation === "create" && context?.eventsClaimed)) {
            const now = contribution(doc);
            const before = operation === "create" ? { confirmed: 0, waitlisted: 0 } : contribution(previousDoc);
            const delta = { confirmed: now.confirmed - before.confirmed, waitlisted: now.waitlisted - before.waitlisted };
            if (delta.confirmed || delta.waitlisted) {
              if (!context?.eventsClaimed) await applyDelta(req.payload, eventId, delta);
              forgetAvailability(eventId);
              if (delta.confirmed < 0) await promoteWaitlist({ payload: req.payload, eventId, req }).catch((err) => console.error("[events] promoting the waiting list failed:", err?.message ?? err));
            }
          }
          return doc;
        },
      ],
      afterDelete: [
        async ({ doc, req, context }) => {
          const eventId = typeof doc.event === "object" ? doc.event.id : doc.event;
          const c = contribution(doc);
          if (c.confirmed || c.waitlisted) {
            await applyDelta(req.payload, eventId, { confirmed: -c.confirmed, waitlisted: -c.waitlisted });
            forgetAvailability(eventId);
            // Clearing out an old event's RSVPs must not email its waiting list.
            if (c.confirmed && !context?.eventsPrune) await promoteWaitlist({ payload: req.payload, eventId, req }).catch((err) => console.error("[events] promoting the waiting list failed:", err?.message ?? err));
          }
          return doc;
        },
      ],
    },
  };

  // An order for tickets: what was bought, what it came to, who is paying and how far the payment has got. It never holds a card number
  // (the visitor pays on the payment provider's page). Staff read it; nobody writes it by hand except to correct a stuck payment, through
  // the buttons on its screen.
  const orders = {
    slug: SLUGS.orders,
    labels: { singular: "Ticket order", plural: "Ticket orders" },
    custom: { polysite: { module: MODULE, icon: ORDERS_ICON } },
    admin: {
      useAsTitle: "reference",
      defaultColumns: ["reference", "name", "event", "status", "totalCents", "createdAt"],
      group: "Content",
      description: "Tickets bought for events. Money amounts are in cents (2500 is 25.00). A payment the provider could not confirm shows here, with buttons to check it again or to settle it by hand.",
    },
    defaultSort: "-createdAt",
    access: {
      read: ({ req: { user } }) => hasCapability(user, "events", "read"),
      create: () => false,
      update: () => false,
      delete: ({ req: { user } }) => hasCapability(user, "events", "delete"),
    },
    fields: [
      { name: "orderActions", type: "ui", admin: { components: { Field: ORDER_ACTIONS } } },
      { name: "reference", type: "text", required: true, unique: true, index: true, admin: { readOnly: true, description: "What the buyer is told to quote." } },
      {
        name: "status",
        type: "select",
        required: true,
        index: true,
        defaultValue: "pending",
        options: [
          { label: "Waiting for payment", value: "pending" },
          { label: "Paid", value: "paid" },
          { label: "Payment reported, being confirmed", value: "payment_reported" },
          { label: "Payment problem: needs a person", value: "payment_problem" },
          { label: "Expired", value: "expired" },
          { label: "Refunded", value: "refunded" },
        ],
        admin: { readOnly: true },
      },
      { name: "event", type: "relationship", relationTo: SLUGS.events, required: true, index: true, admin: { readOnly: true } },
      { name: "rsvp", type: "relationship", relationTo: SLUGS.rsvps, admin: { readOnly: true } },
      { name: "name", type: "text", admin: { readOnly: true } },
      { name: "email", type: "email", admin: { readOnly: true } },
      { name: "phone", type: "text", admin: { readOnly: true } },
      { name: "provider", type: "text", admin: { readOnly: true } },
      { name: "providerRef", type: "text", label: "Provider's order id", index: true, admin: { readOnly: true, description: "The payment provider's own id for the payment, once it has confirmed one." } },
      { name: "items", type: "json", admin: { readOnly: true, description: "What was bought: code, label, units, unit and line amounts (cents)." } },
      { name: "totalCents", type: "number", admin: { readOnly: true } },
      { name: "receiptableCents", type: "number", admin: { readOnly: true } },
      { name: "nonReceiptableCents", type: "number", admin: { readOnly: true } },
      { name: "sponsorshipCents", type: "number", admin: { readOnly: true } },
      { name: "attendeeUnits", type: "number", label: "People", admin: { readOnly: true } },
      { name: "currency", type: "text", admin: { readOnly: true } },
      { name: "holdExpiresAt", type: "date", admin: { readOnly: true, date: { pickerAppearance: "dayAndTime" }, description: "When the held places are let go if the payment is not settled." } },
      { name: "paidAt", type: "date", admin: { readOnly: true, date: { pickerAppearance: "dayAndTime" } } },
      { name: "attempts", type: "number", defaultValue: 0, admin: { readOnly: true, description: "How many times Polysite has asked the provider to confirm the payment." } },
      { name: "nextCheckAt", type: "date", admin: { readOnly: true } },
      { name: "note", type: "textarea", admin: { readOnly: true, description: "What the check found, in plain words." } },
      { name: "lastTransaction", type: "json", admin: { readOnly: true, description: "What the buyer's page reported after paying, as received (no card data)." } },
    ],
  };

  // The counters. Plugin-only: no one reads or writes them through the API.
  const stats = {
    slug: SLUGS.stats,
    labels: { singular: "Event counter", plural: "Event counters" },
    admin: { hidden: true, group: "Content" },
    access: { read: () => false, create: () => false, update: () => false, delete: () => false },
    fields: [
      { name: "event", type: "relationship", relationTo: SLUGS.events, required: true, unique: true, index: true },
      { name: "confirmedGuests", type: "number", defaultValue: 0, required: true },
      { name: "waitlistedGuests", type: "number", defaultValue: 0, required: true },
    ],
  };

  // The prose is translatable; the dates, the place, the picture and the RSVP rules are shared by every language.
  events.fields = i18n.localizeNamed(events.fields, ["title", "summary", "body", "venueName"]);

  return [events, rsvps, orders, stats];
}

export { availability, clientError };
