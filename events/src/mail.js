// The emails an RSVP sends: confirmation, "you're on the waiting list", "a place opened up", a reminder the day before, and "you've
// given your place back". The text is built by pure functions (tested on their own); sending goes through Payload's own
// sendEmail, which is the Email plugin's SMTP when that is installed. Without an email adapter nothing is sent, and nothing fails.

const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** "Saturday, November 14, 2026 at 6:30 PM EST", in the event's own time zone. */
export function formatWhen(event, locale = "en-CA") {
  const start = event?.startsAt ? new Date(event.startsAt) : null;
  if (!start || Number.isNaN(start.getTime())) return "";
  const zone = event?.timeZone || "UTC";
  const options = { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" };
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: zone }).format(start);
  } catch {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(start);
  }
}

const where = (event) => [event?.venueName, event?.address].filter(Boolean).join(", ") || (event?.onlineUrl ? `Online: ${event.onlineUrl}` : "");

const KINDS = {
  confirmed: { subject: (e) => `You're registered: ${e.title}`, lead: (r) => (r.guests > 1 ? `Thank you, ${r.name}. We have you down for ${r.guests} people.` : `Thank you, ${r.name}. You're registered.`) },
  waitlisted: { subject: (e) => `You're on the waiting list: ${e.title}`, lead: (r) => `Thank you, ${r.name}. The event is full, so you're on the waiting list${r.guests > 1 ? ` for ${r.guests} people` : ""}. We'll email you if a place opens up.` },
  promoted: { subject: (e) => `A place opened up: ${e.title}`, lead: (r) => `Good news, ${r.name}: a place opened up and you're now registered${r.guests > 1 ? ` for ${r.guests} people` : ""}.` },
  reminder: { subject: (e) => `Tomorrow: ${e.title}`, lead: (r) => `A reminder, ${r.name}: you're registered for tomorrow.` },
  cancelled: { subject: (e) => `You've given up your place: ${e.title}`, lead: (r) => `${r.name}, you've given up your place. Nothing more is needed.` },
};

const money = (cents, currency = "CAD") => `${(Number(cents) / 100).toFixed(2)} ${currency}`;

/** "2 x Standard ticket: 50.00 CAD" lines for a paid order, plus the total. */
function orderLines(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return [...items.map((i) => `${i.units} x ${i.label}: ${money(i.totalCents, order.currency)}`), `Total paid: ${money(order.totalCents, order.currency)}`, ...(order.reference ? [`Your reference: ${order.reference}`] : [])];
}

/** { subject, text, html } for one kind of message. `links` is { event, cancel, ics } (any may be missing); `order` adds the tickets and total. */
export function buildMessage(kind, { rsvp, event, site, links = {}, order }) {
  const spec = KINDS[kind];
  if (!spec) throw new Error(`[events] unknown message kind ${kind}`);
  const when = formatWhen(event);
  const place = where(event);
  const lead = spec.lead(rsvp);
  const live = kind !== "cancelled" && kind !== "waitlisted";
  const lines = [
    lead,
    "",
    event.title,
    ...(when ? [when] : []),
    ...(place ? [place] : []),
    ...(order ? ["", ...orderLines(order)] : []),
    ...(links.event ? ["", `Details: ${links.event}`] : []),
    ...(live && links.ics ? [`Add to your calendar: ${links.ics}`] : []),
    ...(kind !== "cancelled" && links.cancel ? ["", `Can't make it? Give your place back: ${links.cancel}`] : []),
    "",
    site?.name ? `${site.name}` : "",
  ];
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const html = [
    `<p>${esc(lead)}</p>`,
    `<p><strong>${esc(event.title)}</strong>${when ? `<br>${esc(when)}` : ""}${place ? `<br>${esc(place)}` : ""}</p>`,
    order ? `<p>${orderLines(order).map(esc).join("<br>")}</p>` : "",
    links.event ? `<p><a href="${esc(links.event)}">Event details</a></p>` : "",
    live && links.ics ? `<p><a href="${esc(links.ics)}">Add to your calendar</a></p>` : "",
    kind !== "cancelled" && links.cancel ? `<p style="font-size:90%">Can't make it? <a href="${esc(links.cancel)}">Give your place back</a>.</p>` : "",
    site?.name ? `<p style="color:#666">${esc(site.name)}</p>` : "",
  ].join("\n");
  return { subject: spec.subject(event), text, html };
}

/** Sends one message. Never throws: an email problem must not fail a registration. Resolves true when it was handed to the adapter. */
export async function sendMessage(payload, { to, message, from }) {
  try {
    await payload.sendEmail({ to, subject: message.subject, text: message.text, html: message.html, ...(from ? { from } : {}) });
    return true;
  } catch (err) {
    console.error("[events] could not send an email:", err?.message ?? err);
    return false;
  }
}
