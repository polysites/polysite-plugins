import { SLUGS } from "./slugs.js";

// The places left for an event are counted in a small table of its own (event-stats), not on the event: an event has versions and
// drafts, and publishing a draft would write an old copy of a counter over the live one. The count is changed with single atomic
// UPDATE statements, so two people taking the last place at the same moment cannot both get it: the database serialises them.
//
// The statements are built as text because a plugin has no access to the query builder. Every value that goes into one is first
// forced through `int()`, which accepts only whole numbers, so nothing a visitor typed can reach the SQL.
const int = (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`[events] expected a whole number, got ${String(value).slice(0, 40)}`);
  return n;
};
const idOf = (value) => (value && typeof value === "object" ? value.id : value);

const run = async (payload, raw) => {
  const result = await payload.db.execute({ drizzle: payload.db.drizzle, raw });
  return result?.rows ?? (Array.isArray(result) ? result : []);
};

/** The stats row for an event, made when it is first needed. */
export async function ensureStats(payload, eventId) {
  const find = () => payload.find({ collection: SLUGS.stats, where: { event: { equals: eventId } }, limit: 1, depth: 0, overrideAccess: true });
  const found = await find();
  if (found.docs[0]) return found.docs[0];
  try {
    return await payload.create({ collection: SLUGS.stats, data: { event: eventId, confirmedGuests: 0, waitlistedGuests: 0 }, overrideAccess: true });
  } catch {
    // Another request made it first (the event field is unique).
    return (await find()).docs[0];
  }
}

export async function readStats(payload, eventId) {
  // Read only: a page view must never write. An event nobody has registered for has no row yet, which means zero.
  const found = await payload.find({ collection: SLUGS.stats, where: { event: { equals: eventId } }, limit: 1, depth: 0, overrideAccess: true });
  const row = found.docs[0] ?? {};
  return { confirmedGuests: row.confirmedGuests ?? 0, waitlistedGuests: row.waitlistedGuests ?? 0 };
}

/** Takes `guests` places if there is room (capacity null means unlimited). Resolves true when they were taken. */
export async function claimConfirmed(payload, eventId, guests, capacity) {
  await ensureStats(payload, eventId);
  const g = int(guests);
  const room = capacity === null || capacity === undefined ? "" : `AND "confirmed_guests" + ${g} <= ${int(capacity)}`;
  const rows = await run(payload, `UPDATE "event_stats" SET "confirmed_guests" = "confirmed_guests" + ${g} WHERE "event_id" = ${int(eventId)} ${room} RETURNING "confirmed_guests"`);
  return rows.length > 0;
}

/** Changes the counts by the given (possibly negative) amounts, never below zero. */
export async function applyDelta(payload, eventId, { confirmed = 0, waitlisted = 0 }) {
  if (!confirmed && !waitlisted) return;
  await ensureStats(payload, eventId);
  await run(
    payload,
    `UPDATE "event_stats" SET "confirmed_guests" = GREATEST(0, "confirmed_guests" + ${int(confirmed)}), "waitlisted_guests" = GREATEST(0, "waitlisted_guests" + ${int(waitlisted)}) WHERE "event_id" = ${int(eventId)}`,
  );
}

/** Sets the counts from the RSVPs themselves: the repair button, for when someone edited the database by hand. */
export async function recount(payload, eventId) {
  const rsvps = await payload.find({ collection: SLUGS.rsvps, where: { event: { equals: eventId } }, limit: 10_000, pagination: false, depth: 0, overrideAccess: true });
  let confirmed = 0;
  let waitlisted = 0;
  for (const r of rsvps.docs) {
    if (r.status === "confirmed") confirmed += r.guests ?? 1;
    if (r.status === "waitlisted") waitlisted += r.guests ?? 1;
  }
  await ensureStats(payload, eventId);
  await run(payload, `UPDATE "event_stats" SET "confirmed_guests" = ${int(confirmed)}, "waitlisted_guests" = ${int(waitlisted)} WHERE "event_id" = ${int(eventId)}`);
  return { confirmedGuests: confirmed, waitlistedGuests: waitlisted };
}

export const eventIdOf = idOf;
