import type { EventAvailability } from "../types/events";

// How an event's time and places are written. Always in the event's own time zone (an explicit one, so the server and the browser
// draw the same text and the page never changes after it loads).

function validZone(zone: string | null | undefined): string {
  if (!zone) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

const parse = (iso: string | null | undefined): Date | null => {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

/** "Saturday, November 14, 2026". */
export function formatEventDay(startsAt: string | undefined, zone?: string | null, locale = "en-CA"): string {
  const start = parse(startsAt);
  return start ? new Intl.DateTimeFormat(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: validZone(zone) }).format(start) : "";
}

/** "6:30 PM – 8:30 PM EST" (or just the start). When the event ends on another day the end carries its date. */
export function formatEventTimes(startsAt: string | undefined, endsAt: string | null | undefined, zone?: string | null, locale = "en-CA"): string {
  const start = parse(startsAt);
  if (!start) return "";
  const timeZone = validZone(zone);
  const time = (d: Date, withZone: boolean) => new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", ...(withZone ? { timeZoneName: "short" } : {}), timeZone }).format(d);
  const end = parse(endsAt);
  if (!end || end <= start) return time(start, true);
  const dayOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(d);
  if (dayOf(start) === dayOf(end)) return `${time(start, false)} – ${time(end, true)}`;
  const endDay = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone }).format(end);
  return `${time(start, false)} – ${endDay}, ${time(end, true)}`;
}

/** A short date for a card: "Nov 14". */
export function formatEventShortDate(startsAt: string | undefined, zone?: string | null, locale = "en-CA"): { month: string; day: string } {
  const start = parse(startsAt);
  if (!start) return { month: "", day: "" };
  const timeZone = validZone(zone);
  return {
    month: new Intl.DateTimeFormat(locale, { month: "short", timeZone }).format(start),
    day: new Intl.DateTimeFormat(locale, { day: "numeric", timeZone }).format(start),
  };
}

/** What the places say, in plain words. `t` is the page's own translate function. */
export function availabilityText(a: EventAvailability | null | undefined, t: (key: string, fallback: string, values?: Record<string, string | number>) => string): string {
  if (!a) return "";
  switch (a.state) {
    case "closed":
      return t("events.closed", "Registration is closed.");
    case "upcoming":
      return t("events.notYetOpen", "Registration hasn't opened yet.");
    case "full":
      return t("events.full", "This event is full.");
    case "waitlist":
      return t("events.waitlist", "This event is full. You can join the waiting list.");
    default:
      if (a.spotsLeft === null) return "";
      return a.spotsLeft === 1 ? t("events.oneLeft", "1 place left") : t("events.placesLeft", "{count} places left", { count: a.spotsLeft });
  }
}

/** Whether the visitor can still try to register (including joining the waiting list). */
export const canRegister = (a: EventAvailability | null | undefined): boolean => a?.state === "open" || a?.state === "waitlist";

/** A redirect target the page will follow: a path on this site, or an https address. */
export function safeRedirect(target: string | null | undefined): { to: string; external: boolean } | null {
  const value = (target ?? "").trim();
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return { to: value, external: false };
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? { to: url.toString(), external: true } : null;
  } catch {
    return null;
  }
}

/** JSON for a <script type="application/ld+json">: "<" is escaped so a title can't close the tag. */
export function eventJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
