import { createHmac } from "node:crypto";

import { SLUGS } from "./collections.js";
import { safePost } from "./safePost.js";
import { mayHearOfDeletion } from "./scope.js";

export const TASK_SLUG = "polysite-notify";
export const MAX_RETRIES = 5;

const VERBS = { created: "was created", updated: "was updated", deleted: "was deleted", published: "was published" };

const humanize = (slug) => slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

// What the notification says. Deliberately built only from the minimal event
// (collection, title, actor) -- never document content -- so a form-
// submission alert can't leak what was submitted, and an alert about a
// deleted page can't resurrect its text.
export function describe(event, payload) {
  const origin = payload.config.serverURL || "";
  const adminRoute = payload.config.routes?.admin || "/admin";
  const path =
    event.event === "deleted" ? `${adminRoute}/collections/${event.collection}` : `${adminRoute}/collections/${event.collection}/${event.docId}`;
  return {
    title: `${humanize(event.collection)}: "${event.title}" ${VERBS[event.event] ?? event.event}`,
    body: event.actor ? `By ${event.actor}.` : "",
    link: origin ? `${origin}${path}` : path,
    absolute: Boolean(origin),
  };
}

function slackBody(d) {
  return { text: [`*${d.title}*`, d.body, d.absolute ? `<${d.link}|Open in Polysite>` : ""].filter(Boolean).join("\n") };
}

// Microsoft retired the Office 365 connector webhooks (rollout May 2026); the
// replacement "Workflows" webhook expects an Adaptive Card wrapped in a
// message envelope.
function teamsBody(d) {
  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            { type: "TextBlock", text: d.title, weight: "Bolder", wrap: true },
            ...(d.body ? [{ type: "TextBlock", text: d.body, wrap: true, isSubtle: true }] : []),
          ],
          actions: d.absolute ? [{ type: "Action.OpenUrl", title: "Open in Polysite", url: d.link }] : [],
        },
      },
    ],
  };
}

async function deliverToChannel({ channel, event, desc, deliveryId, payload }) {
  switch (channel.type) {
    case "slack":
      return safePost(channel.url, { body: slackBody(desc) });
    case "teams":
      return safePost(channel.url, { body: teamsBody(desc) });
    case "webhook": {
      const body = JSON.stringify({
        id: deliveryId,
        event: event.event,
        collection: event.collection,
        docId: event.docId,
        title: event.title,
        site: event.site,
        actor: event.actor,
        link: desc.link,
        at: event.at,
      });
      const headers = { "X-Polysite-Event": event.event, "X-Polysite-Delivery": String(deliveryId) };
      if (channel.secret) headers["X-Polysite-Signature"] = `sha256=${createHmac("sha256", channel.secret).update(body).digest("hex")}`;
      return safePost(channel.url, { headers, body });
    }
    case "email": {
      const to = String(channel.recipients ?? "")
        .split(/[\s,;]+/)
        .filter(Boolean)
        .join(", ");
      if (!to) throw new Error("This email channel has no recipients.");
      return payload.sendEmail({ to, subject: desc.title, text: [desc.body, desc.link].filter(Boolean).join("\n\n") });
    }
    default:
      throw new Error(`Unknown channel type "${channel.type}".`);
  }
}

async function patchDelivery(payload, id, data) {
  await payload.update({ collection: SLUGS.deliveries, id, data, overrideAccess: true, context: { skipNotify: true } });
}

// Runs once per attempt. Throwing makes Payload's jobs queue retry it with
// backoff; returning (including "skipped") ends it. Everything is re-read
// here rather than carried in the job row, so edits to a channel apply to
// retries and no secret ever sits in the jobs table.
async function handler({ input, req }) {
  const { payload } = req;
  const { deliveryId, watchId, event } = input;

  const delivery = await payload.findByID({ collection: SLUGS.deliveries, id: deliveryId, depth: 0, overrideAccess: true }).catch(() => null);
  if (!delivery || delivery.status === "sent") return { output: {} };

  const attempts = (delivery.attempts ?? 0) + 1;
  await patchDelivery(payload, deliveryId, { attempts });

  try {
    const watch = await payload.findByID({ collection: SLUGS.watches, id: watchId, depth: 0, overrideAccess: true }).catch(() => null);
    if (!watch) {
      await patchDelivery(payload, deliveryId, { status: "skipped", lastError: "The watch was removed before delivery." });
      return { output: {} };
    }

    const desc = describe(event, payload);

    if (watch.subscriberType === "channel") {
      const channelId = typeof watch.channel === "object" ? watch.channel?.id : watch.channel;
      const channel = channelId
        ? await payload
            .findByID({ collection: SLUGS.channels, id: channelId, depth: 0, overrideAccess: true, context: { revealNotifySecrets: true } })
            .catch(() => null)
        : null;
      if (!channel || channel.enabled === false) {
        await patchDelivery(payload, deliveryId, { status: "skipped", lastError: "The channel is missing or switched off." });
        return { output: {} };
      }
      await deliverToChannel({ channel, event, desc, deliveryId, payload });
    } else {
      const userId = typeof watch.user === "object" ? watch.user?.id : watch.user;
      const user = userId ? await payload.findByID({ collection: "users", id: userId, depth: 0, overrideAccess: true }).catch(() => null) : null;
      if (!user) {
        await patchDelivery(payload, deliveryId, { status: "skipped", lastError: "The subscriber no longer exists." });
        return { output: {} };
      }
      // Re-check, at delivery time, that this person can still open the
      // document -- a watch must never leak a title they couldn't read.
      // (A deleted document can't be re-read; they watched it while they
      // had access.)
      if (event.event === "deleted") {
        // Nothing to re-read, so check whose document it was.
        if (!mayHearOfDeletion(user, event)) {
          await patchDelivery(payload, deliveryId, { status: "skipped", lastError: "The subscriber is not on the site this document belonged to." });
          return { output: {} };
        }
      } else {
        try {
          await payload.findByID({
            collection: event.collection,
            id: event.docId,
            depth: 0,
            user: { ...user, collection: "users" },
            overrideAccess: false,
          });
        } catch {
          await patchDelivery(payload, deliveryId, { status: "skipped", lastError: "The subscriber no longer has access to this document." });
          return { output: {} };
        }
      }
      await payload.create({
        collection: SLUGS.inbox,
        data: { user: user.id, title: desc.title, body: desc.body, link: desc.link },
        overrideAccess: true,
      });
      if (watch.alsoEmail && user.email) {
        await payload.sendEmail({ to: user.email, subject: desc.title, text: [desc.body, desc.link].filter(Boolean).join("\n\n") });
      }
    }

    await patchDelivery(payload, deliveryId, { status: "sent", sentAt: new Date().toISOString(), lastError: null });
    return { output: {} };
  } catch (err) {
    await patchDelivery(payload, deliveryId, { status: "queued", lastError: String(err?.message ?? err).slice(0, 500) });
    throw err;
  }
}

export const notifyTask = {
  slug: TASK_SLUG,
  retries: { attempts: MAX_RETRIES, backoff: { type: "exponential", delay: 5000 } },
  inputSchema: [
    { name: "deliveryId", type: "text", required: true },
    { name: "watchId", type: "text", required: true },
    { name: "event", type: "json", required: true },
  ],
  handler,
  // Payload calls this after EVERY failed attempt, before it decides whether
  // to retry -- so it can't be taken as "gave up" (confirmed: the log showed
  // "failed" after attempt 1 of 6, then flipped to "sent"). The queue gives up
  // exactly when totalTried >= retries.attempts (queues/errors/handleTaskError.js);
  // only then is the delivery marked failed. Earlier attempts leave it
  // "queued" with the last error, as the handler already recorded.
  onFail: async ({ input, req, taskStatus }) => {
    if (taskStatus?.complete || (taskStatus?.totalTried ?? 0) < MAX_RETRIES) return;
    await patchDelivery(req.payload, input.deliveryId, { status: "failed" }).catch(() => {});
  },
};
