import { buildEvent, canonicalEvent, SLUGS, TASK_SLUG, TEST_EVENT } from "./events.js";
import { cutoffDate, decideAfterFailure, DISABLE_AFTER, isRetryable } from "./policy.js";
import { DeliveryError, postJson } from "./request.js";
import { signedHeaders } from "./sign.js";

const idOf = (value) => (value && typeof value === "object" ? value.id : value);
const SKIP = { skipWebhooks: true };

// One timer per delay for the whole process: after a burst of saves, or when a retry is due, kick the job runner. Needed because
// Payload's Next integration only starts its autoRun cron once an admin page has rendered; API-only traffic (or the first minutes
// after a restart) would otherwise leave queued deliveries waiting. The cron added in index.js remains the backstop.
const timers = new Map();
export function scheduleRun(payload, delayMs = 300) {
  const at = Math.max(300, Math.ceil(delayMs / 250) * 250);
  if (timers.has(at)) return;
  const timer = setTimeout(() => {
    timers.delete(at);
    payload.jobs.run({ limit: 25 }).catch((err) => console.error("[webhooks] job run failed:", err?.message ?? err));
  }, at);
  timer.unref?.();
  timers.set(at, timer);
}

const patchDelivery = (payload, id, data) => payload.update({ collection: SLUGS.deliveries, id, data, overrideAccess: true, context: SKIP });
const patchEndpoint = (payload, id, data) => payload.update({ collection: SLUGS.endpoints, id, data, overrideAccess: true, context: SKIP });

// Writes the log row and queues the job that sends it. `req` joins both to the save that caused them: if the save rolls back, so
// does the message. The row holds the event itself, so a retry or a replay sends exactly what the first attempt did.
export async function queueDelivery({ payload, req, endpoint, event, isTest = false }) {
  const delivery = await payload.create({
    collection: SLUGS.deliveries,
    data: { status: "queued", eventType: event.type, endpoint: endpoint.id, endpointName: endpoint.name, eventId: event.id, attempts: 0, isTest, event },
    overrideAccess: true,
    req,
    context: SKIP,
  });
  await payload.jobs.queue({ task: TASK_SLUG, input: { deliveryId: String(delivery.id), endpointId: String(endpoint.id) }, req });
  return delivery;
}

// The public address of a page or post, once the core's URL index knows it. Best effort and read-only: no entry (a media file,
// a form, a deleted page) simply means no link.
async function publicUrlOf(payload, event) {
  const { collection, id } = event.data ?? {};
  const domain = event.site?.domain;
  if (!domain || !id || !["pages", "posts"].includes(collection) || event.type.endsWith(".deleted")) return null;
  try {
    const found = await payload.find({
      collection: "site-urls",
      where: { doc: { equals: { relationTo: collection, value: Number.isNaN(Number(id)) ? id : Number(id) } } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    });
    const path = found.docs[0]?.path;
    if (typeof path !== "string") return null;
    return `https://${domain}${path.startsWith("/") ? path : `/${path}`}`;
  } catch {
    return null;
  }
}

// One HTTP attempt: signs, sends, and says what happened. Never throws.
async function send({ endpoint, delivery }) {
  const event = canonicalEvent(delivery.event);
  const body = JSON.stringify(event);
  const headers = signedHeaders({ secret: endpoint.secret, type: event.type, eventId: event.id, deliveryId: delivery.id, body });
  try {
    const { status } = await postJson(endpoint.url, { headers, body });
    return { ok: true, status };
  } catch (err) {
    const kind = err instanceof DeliveryError ? err.kind : "network";
    return { ok: false, kind, status: err.status ?? null, message: String(err.message ?? err).slice(0, 300) };
  }
}

const readEndpoint = (payload, id) =>
  payload.findByID({ collection: SLUGS.endpoints, id, depth: 0, overrideAccess: true, context: { revealWebhookSecrets: true } }).catch(() => null);

// One attempt of one delivery, as the job runs it. Everything is read again here rather than carried in the job row, so an edit
// to the endpoint applies to retries and no secret ever sits in the jobs table. All state is written here and the function
// returns normally (a retry is a new job with a wait), except when the delivery row isn't visible yet.
async function handler({ input, req }) {
  const { payload } = req;
  const delivery = await payload.findByID({ collection: SLUGS.deliveries, id: input.deliveryId, depth: 0, overrideAccess: true }).catch(() => null);
  // The save that queued this may not have committed yet: throwing lets Payload try again in a moment.
  if (!delivery) throw new Error("The delivery isn't visible yet");
  if (delivery.status === "sent") return { output: {} };

  const endpoint = await readEndpoint(payload, input.endpointId);
  if (!endpoint) {
    await patchDelivery(payload, delivery.id, { status: "skipped", lastError: "The endpoint was deleted before this was sent.", nextAttemptAt: null });
    return { output: {} };
  }
  if (endpoint.active === false) {
    await patchDelivery(payload, delivery.id, { status: "skipped", lastError: "The endpoint is switched off. Switch it on and replay this delivery to send it.", nextAttemptAt: null });
    return { output: {} };
  }

  if (delivery.event?.data && delivery.event.data.publicUrl == null && delivery.attempts === 0) {
    const publicUrl = await publicUrlOf(payload, delivery.event);
    if (publicUrl) delivery.event = { ...delivery.event, data: { ...delivery.event.data, publicUrl } };
  }

  const attempt = (delivery.attempts ?? 0) + 1;
  const result = await send({ endpoint, delivery });
  const now = new Date().toISOString();

  if (result.ok) {
    await patchDelivery(payload, delivery.id, { status: "sent", attempts: attempt, responseCode: result.status, lastError: null, nextAttemptAt: null, sentAt: now, event: delivery.event });
    await patchEndpoint(payload, endpoint.id, { consecutiveFailures: 0, lastSuccessAt: now, lastResponseCode: result.status });
    return { output: {} };
  }

  const failures = (endpoint.consecutiveFailures ?? 0) + 1;
  const decision = decideAfterFailure({ attempt, retryable: isRetryable(result), consecutiveFailures: failures });
  const waitMs = decision.retry ? decision.waitMs : null;
  const note = decision.disable ? ` The endpoint was switched off after ${DISABLE_AFTER} failed attempts in a row.` : "";
  await patchDelivery(payload, delivery.id, {
    status: decision.status,
    attempts: attempt,
    responseCode: result.status,
    lastError: `${result.message}${note}`.slice(0, 500),
    nextAttemptAt: waitMs ? new Date(Date.now() + waitMs).toISOString() : null,
    event: delivery.event,
  });
  await patchEndpoint(payload, endpoint.id, {
    consecutiveFailures: failures,
    lastFailureAt: now,
    lastResponseCode: result.status,
    ...(decision.disable
      ? { active: false, disabledAt: now, disabledReason: `Switched off automatically after ${failures} failed attempts in a row. Last error: ${result.message}`.slice(0, 300) }
      : {}),
  });
  if (decision.disable) console.warn(`[webhooks] endpoint "${endpoint.name}" switched off after ${failures} failed attempts in a row`);

  if (decision.retry) {
    await payload.jobs.queue({ task: TASK_SLUG, input: input, waitUntil: new Date(Date.now() + waitMs) });
    scheduleRun(payload, waitMs + 250);
  }
  return { output: {} };
}

export const deliverTask = {
  slug: TASK_SLUG,
  // Our own retries (above) are what the log shows; this only covers the delivery row not being visible yet.
  retries: { attempts: 4, backoff: { type: "exponential", delay: 1000 } },
  inputSchema: [
    { name: "deliveryId", type: "text", required: true },
    { name: "endpointId", type: "text", required: true },
  ],
  handler,
};

// The "send test event" button: one attempt right now, so the admin sees the answer. It is logged but never retried, and it
// neither counts toward switching the endpoint off nor resets that count.
export async function sendTestEvent({ payload, endpointId }) {
  const endpoint = await readEndpoint(payload, endpointId);
  if (!endpoint) return { ok: false, notFound: true, error: "That webhook no longer exists." };
  const origin = payload.config.serverURL || "";
  const event = buildEvent({ eventId: `evt_test_${Date.now().toString(36)}`, type: TEST_EVENT, collection: "", doc: {}, site: null, adminOrigin: origin, adminRoute: payload.config.routes?.admin || "/admin", test: true });
  const delivery = await payload.create({
    collection: SLUGS.deliveries,
    data: { status: "queued", eventType: event.type, endpoint: endpoint.id, endpointName: endpoint.name, eventId: event.id, attempts: 0, isTest: true, event },
    overrideAccess: true,
    context: SKIP,
  });
  const result = await send({ endpoint, delivery });
  const now = new Date().toISOString();
  await patchDelivery(payload, delivery.id, {
    status: result.ok ? "sent" : "failed",
    attempts: 1,
    responseCode: result.status ?? null,
    lastError: result.ok ? null : result.message,
    sentAt: result.ok ? now : null,
  });
  return result.ok ? { ok: true, status: result.status, deliveryId: delivery.id } : { ok: false, status: result.status, error: result.message, deliveryId: delivery.id };
}

// The "replay" button on a failed or skipped delivery: the same event (same id, so a receiver can tell), a fresh signature.
export async function replayDelivery({ payload, deliveryId }) {
  const delivery = await payload.findByID({ collection: SLUGS.deliveries, id: deliveryId, depth: 0, overrideAccess: true }).catch(() => null);
  if (!delivery) return { ok: false, notFound: true, error: "That delivery no longer exists." };
  if (delivery.status !== "failed" && delivery.status !== "skipped") return { ok: false, error: "Only a failed or skipped delivery can be replayed." };
  const endpoint = await payload.findByID({ collection: SLUGS.endpoints, id: idOf(delivery.endpoint) ?? "0", depth: 0, overrideAccess: true }).catch(() => null);
  if (!endpoint) return { ok: false, error: "The endpoint was deleted, so there is nowhere to send this." };
  if (endpoint.active === false) return { ok: false, error: "The endpoint is switched off. Switch it on first (and fix whatever made it fail)." };
  await patchDelivery(payload, delivery.id, { status: "queued", attempts: 0, lastError: null, nextAttemptAt: null, replays: (delivery.replays ?? 0) + 1 });
  await payload.jobs.queue({ task: TASK_SLUG, input: { deliveryId: String(delivery.id), endpointId: String(endpoint.id) } });
  scheduleRun(payload);
  return { ok: true };
}

// Keeps the log from growing for ever: entries older than WEBHOOKS_LOG_DAYS (30) that are no longer waiting for anything go.
export async function pruneDeliveries(payload) {
  try {
    await payload.delete({
      collection: SLUGS.deliveries,
      where: { and: [{ createdAt: { less_than: cutoffDate(new Date()).toISOString() } }, { status: { in: ["sent", "failed", "skipped"] } }] },
      overrideAccess: true,
      context: SKIP,
    });
  } catch (err) {
    console.error("[webhooks] could not prune the delivery log:", err?.message ?? err);
  }
}
