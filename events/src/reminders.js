import { notify } from "./service.js";
import { SLUGS } from "./slugs.js";

const idOf = (value) => (value && typeof value === "object" ? value.id : value);
const HOUR = 60 * 60 * 1000;
export const DEFAULT_RETENTION_DAYS = Number.parseInt(process.env.EVENTS_RETENTION_DAYS ?? "", 10) || 180;

const settingsBySite = async (payload) => {
  const all = await payload.find({ collection: SLUGS.settings, limit: 500, pagination: false, depth: 0, overrideAccess: true }).catch(() => ({ docs: [] }));
  return new Map(all.docs.map((s) => [String(idOf(s.site)), s]));
};

/**
 * The reminder the day before: every confirmed RSVP for an event that starts in about a day gets one email, once. A person is marked
 * as reminded before the email goes, so two sweeps (or two servers) never send it twice; the cost is that a send that fails is not
 * retried, which for a reminder is the right way round.
 */
export async function sendDueReminders(payload, now = new Date()) {
  const from = new Date(now.getTime() + 20 * HOUR).toISOString();
  const to = new Date(now.getTime() + 28 * HOUR).toISOString();
  const found = await payload.find({
    collection: SLUGS.events,
    where: { and: [{ startsAt: { greater_than: from } }, { startsAt: { less_than: to } }, { _status: { equals: "published" } }] },
    limit: 100,
    pagination: false,
    depth: 1,
    draft: false,
    overrideAccess: true,
  });
  if (found.docs.length === 0) return 0;
  const settings = await settingsBySite(payload);
  let sent = 0;
  for (const event of found.docs) {
    const site = event.site && typeof event.site === "object" ? event.site : null;
    if (settings.get(String(idOf(event.site)))?.reminders === false) continue;
    const rsvps = await payload.find({
      collection: SLUGS.rsvps,
      where: { and: [{ event: { equals: event.id } }, { status: { equals: "confirmed" } }, { reminderSentAt: { exists: false } }] },
      limit: 1000,
      pagination: false,
      depth: 0,
      overrideAccess: true,
    });
    for (const rsvp of rsvps.docs) {
      try {
        await payload.update({ collection: SLUGS.rsvps, id: rsvp.id, data: { reminderSentAt: now.toISOString() }, overrideAccess: true, context: { eventsClaimed: true } });
        if (await notify(payload, "reminder", { rsvp, event, site })) sent++;
      } catch (err) {
        console.error("[events] reminder failed:", err?.message ?? err);
      }
    }
  }
  return sent;
}

/**
 * RSVPs are personal data: they go a set number of days after the event (per site in Event settings, 180 by default). Only RSVPs of
 * events that ended that long ago are touched; the events themselves stay.
 */
export async function pruneRsvps(payload, now = new Date()) {
  try {
    const settings = await settingsBySite(payload);
    const floor = Math.min(DEFAULT_RETENTION_DAYS, ...[...settings.values()].map((s) => s.retentionDays ?? DEFAULT_RETENTION_DAYS));
    const old = await payload.find({
      collection: SLUGS.events,
      where: { startsAt: { less_than: new Date(now.getTime() - floor * 24 * HOUR).toISOString() } },
      limit: 500,
      pagination: false,
      depth: 0,
      draft: true,
      overrideAccess: true,
    });
    let removed = 0;
    for (const event of old.docs) {
      const days = settings.get(String(idOf(event.site)))?.retentionDays ?? DEFAULT_RETENTION_DAYS;
      const end = new Date(event.endsAt ?? event.startsAt);
      if (Number.isNaN(end.getTime()) || end.getTime() > now.getTime() - days * 24 * HOUR) continue;
      const result = await payload.delete({ collection: SLUGS.rsvps, where: { event: { equals: event.id } }, overrideAccess: true, context: { eventsPrune: true } });
      removed += result?.docs?.length ?? 0;
    }
    return removed;
  } catch (err) {
    console.error("[events] could not remove old RSVPs:", err?.message ?? err);
    return 0;
  }
}
