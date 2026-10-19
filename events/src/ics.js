// A calendar file (RFC 5545) for one event, so "add to calendar" works in any calendar app. Pure.

const pad = (n) => String(n).padStart(2, "0");
const utc = (date) => `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
const escapeText = (text) => String(text ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// Lines are folded at 75 octets, continuation lines start with a space (never splitting a multi-byte character).
function fold(line) {
  const out = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.map((l, i) => (i === 0 ? l : ` ${l}`));
}

/**
 * `event` is { id, title, summary, startsAt, endsAt, venueName, address, onlineUrl }; `url` is the event's public address.
 * Returns the file's text, or null when the event has no usable start time.
 */
export function buildIcs(event, { url, domain, now = new Date() } = {}) {
  const start = event?.startsAt ? new Date(event.startsAt) : null;
  if (!start || Number.isNaN(start.getTime())) return null;
  const parsedEnd = event.endsAt ? new Date(event.endsAt) : null;
  const end = parsedEnd && !Number.isNaN(parsedEnd.getTime()) && parsedEnd > start ? parsedEnd : new Date(start.getTime() + 60 * 60 * 1000);
  const where = [event.venueName, event.address].filter(Boolean).join(", ") || event.onlineUrl || "";
  const description = [event.summary, url ? `Details: ${url}` : "", event.onlineUrl ? `Join online: ${event.onlineUrl}` : ""].filter(Boolean).join("\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Polysite//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:event-${event.id}@${domain || "polysite"}`,
    `DTSTAMP:${utc(now)}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${escapeText(event.title)}`,
    ...(where ? [`LOCATION:${escapeText(where)}`] : []),
    ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []),
    ...(url ? [`URL:${url}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.flatMap(fold).join("\r\n")}\r\n`;
}

/** Links that open the event in the common web calendars. */
export function calendarLinks(event, { url } = {}) {
  const start = event?.startsAt ? new Date(event.startsAt) : null;
  if (!start || Number.isNaN(start.getTime())) return {};
  const parsedEnd = event.endsAt ? new Date(event.endsAt) : null;
  const end = parsedEnd && !Number.isNaN(parsedEnd.getTime()) && parsedEnd > start ? parsedEnd : new Date(start.getTime() + 60 * 60 * 1000);
  const where = [event.venueName, event.address].filter(Boolean).join(", ") || event.onlineUrl || "";
  const details = [event.summary, url].filter(Boolean).join("\n");
  const google = new URL("https://calendar.google.com/calendar/render");
  google.searchParams.set("action", "TEMPLATE");
  google.searchParams.set("text", event.title ?? "");
  google.searchParams.set("dates", `${utc(start)}/${utc(end)}`);
  if (details) google.searchParams.set("details", details);
  if (where) google.searchParams.set("location", where);
  const outlook = new URL("https://outlook.live.com/calendar/0/deeplink/compose");
  outlook.searchParams.set("path", "/calendar/action/compose");
  outlook.searchParams.set("rru", "addevent");
  outlook.searchParams.set("subject", event.title ?? "");
  outlook.searchParams.set("startdt", start.toISOString());
  outlook.searchParams.set("enddt", end.toISOString());
  if (details) outlook.searchParams.set("body", details);
  if (where) outlook.searchParams.set("location", where);
  return { google: google.toString(), outlook: outlook.toString() };
}
