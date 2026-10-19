# Events

Events with a free RSVP, a waiting list and, if you want, paid tickets. Each site lists its own events at `/events` (or any address you choose), with a page per event, an RSVP form, a calendar file, confirmation and reminder emails, and an attendee list for staff.

**Scope:** per-site. The plugin is installed once; each site turns the **Events** module on and sets its section in **Event settings**. This is a **content-type plugin**, built the same way as [posts](../posts/README.md). Remove the folder and the site keeps working, without events; its tables stay in the database.

- [Turn it on](#turn-it-on-for-a-site) · [Make an event](#make-an-event) · [Take RSVPs](#take-rsvps) · [Sell tickets](#sell-tickets) · [What visitors see](#what-visitors-see)
- [For staff](#for-staff) · [Privacy](#privacy) · [How the places are counted](#how-the-places-are-counted) · [Testing it](#testing-it) · [Known limits](#known-limits)

## Turn it on for a site

1. Open the site under **Sites**. On **General**, make sure **Events** is ticked under **Enabled Modules**. New sites have it on by default.
2. Open **Event settings** (under Administration, Site features):

   | Setting | What it does |
   | --- | --- |
   | **Label** | The heading of the list, like *Events* or *What's on* |
   | **Section address** | Where the section lives. `events` puts the list at `/events` and each event at `/events/<slug>` |
   | **Events per page** | 1 to 50, default 12 |
   | **Default time zone** | For an event that has none of its own, like `America/Toronto` |
   | **Sender name** | The name confirmation emails come from |
   | **Payment provider** and **Currency** | Only for tickets; see below |
   | **Send a reminder the day before** | One email to everyone confirmed, about 24 hours before the start |
   | **Keep RSVPs for (days)** | RSVPs are deleted this long after the event ends. Default 180 |

> **After installing on an existing install:** roles you created earlier don't have the **Events** module. A Super Admin adds it under **Roles → Modules**.

## Make an event

**Content → Events → Create new.** Title, address (slug), start (and end), time zone, place, an online link if it is online, a picture, a short summary, and a description. Like pages and posts, an event has **Save draft** and **Publish changes**, a version history, scheduled publishing and the *ready for review* marker.

Times are shown in the event's own time zone, so a visitor anywhere sees the time on the clock where the event is.

## Take RSVPs

Under **RSVP** on the event:

| Setting | What it does |
| --- | --- |
| **Taking RSVPs**, **Opens**, **Closes** | Switch RSVPs on or off, or limit when they are open. They always close when the event ends |
| **Capacity** | How many **people** can come in all. Empty means no limit |
| **People per RSVP** | 1 means one person per RSVP. More lets someone bring others (themselves included); capacity counts every person |
| **Waiting list when full** | People who RSVP after it is full wait in order and are moved up automatically when a place opens |
| **Ask for a phone number**, **consent checkbox** | Optional extras on the form. Say in the consent wording if details go to another system |
| **Button label**, **message**, **Send them to** | What happens after a successful RSVP: show the message, or go to a page on this site or an https address |

One person, one place: the same email address (however it is typed) can't register twice for an event. Someone who gives their place back can register again.

When a place opens up (a cancellation, a staff change, a larger capacity), the waiting list moves up in order, and each person who moves up gets an email.

## Sell tickets

Add **Tickets** to the event (a code, a label, a price in dollars) and the RSVP form is replaced by a ticket form. Each ticket can have:

- a **price**; 0 makes a free ticket;
- an amount **not eligible for a tax receipt** (the value of a meal, say), used for receipts;
- **sponsorship**: a contribution, not a seat. It adds to the total but doesn't take a place;
- a most-per-order.

**Money is worked out on the server.** The page only says which tickets and how many; prices, totals and the receipt split come from the event's own list. Someone editing the page in their browser can't change what they pay.

**Who takes the payment** is another plugin's job; no payment provider ships with this one, so tickets can't be sold until one is installed. Set **Payment provider** in Event settings to its name (empty uses the only one installed). The design expects the visitor to pay on the provider's own page, shown in a frame, so **a card number never reaches Polysite**. See [Writing a payment provider](#writing-a-payment-provider).

How an order goes:

1. The visitor chooses tickets and gives their details. The server prices the order and **holds the places** (20 minutes). A person already registered with the same email is told so; someone retrying simply replaces their earlier attempt.
2. The payment provider's page takes the payment.
3. The page says it went through, **and the server asks the provider whether it really did.** It must be a completed payment, for exactly the amount, tied to this order, and not already used for another. Only then are the places confirmed and the email sent. The browser is never believed on its own.
4. If the provider can't be asked, the payment is kept as *reported* and checked again every minute; the places stay held. If the provider says it is not a completed payment of this amount, the order shows *payment problem* for a person to look at.
5. Places held for orders nobody finishes are let go when the hold runs out, and the waiting list moves up.

A paid event doesn't use the waiting list (a ticket is sold only while a place is free), and paid tickets can't be given back with the email link (that would need a refund, which is a person's job).

## What visitors see

- **The list** (`/events`): upcoming events first, with date, place and places left; a link to past events; page links.
- **The event page**: when, where, the description, the form (RSVP or tickets), add-to-calendar links (a file and Google and Outlook), and structured data so search engines can show the date and place.
- **The confirmation email**: details, a calendar link, and a link to give the place back.
- **`/events/cancel?token=…`**: the page that link opens. It asks first, so an email scanner that opens links can't cancel anyone's place.

Pages carry `poly-event*` class names a theme can restyle.

## For staff

- **On the event's screen**: how many places are taken, the waiting list, a link to the RSVPs, a **spreadsheet download (CSV)**, and **Count again** if the numbers ever look wrong.
- **Content → RSVPs**: everyone who registered. Move someone between the waiting list and confirmed, add someone by hand, or cancel. Cancelling gives the places back and lets the next person in.
- **Content → Ticket orders**: what was bought, what it came to (in cents), and where each payment stands. For a payment that couldn't be confirmed: **Check again with the payment provider**, **Mark as paid** (once you have seen the payment in the provider's own records) or **Release the places**.

## Privacy

- RSVPs hold names and email addresses. They are **deleted a set number of days after the event ends** (Event settings, 180 by default); the events stay.
- Email addresses are never shown publicly. A "give your place back" link names only the event and the size of the party.
- The same protections as the core's forms apply to the public endpoints: a hidden trap field, a signed token that must be a moment old, and a rate limit per visitor address.
- Visitors can see that an email address "already has a place" only by registering with it; the answer is the same for a new and an existing address.
- **Not yet covered:** the core's privacy-request register (find, export and erase one person) looks at form submissions only. To erase someone from an event, delete their RSVP (and order) by hand. A core extension point for plugin data is the proper fix and is not built.

## How the places are counted

Two people pressing the button at the same instant for the last place must not both get it. The places left are kept in a small table of their own (`event-stats`), not on the event (an event has drafts and versions, and publishing an old draft would write an old count over the live one), and changed with **single atomic database statements**, so the database serialises them. The end-to-end check fires twenty RSVPs at once for five places and expects exactly five.

A place held for someone paying counts as taken. A staff edit, a cancellation or a deletion adjusts the count by exactly what changed.

## Testing it

```bash
# unit tests
docker run --rm -v "$PWD/events:/p" -w /p node:22 node --test test/*.test.js

# end to end (places, the waiting list, twenty at once), from the core folder
E2E_PLUGINS=events PLUGINS_DIR=../Polysite-plugins sh tests/e2e/run-with-plugins.sh
```

Ticket sales need a payment provider, which is a separate plugin and is tested with its own end-to-end check.

## Writing a payment provider

A payment plugin registers itself, in its `apply`, in the config's `custom.polysitePayments`:

```js
export default function myPayments(config) {
  return { ...config, custom: { ...config.custom, polysitePayments: { ...config.custom?.polysitePayments, mypay: provider } } };
}
```

where `provider` is `{ id, label, kind: "hosted-iframe", begin, verify }`:

- **`begin({ payload, order, event, site, settings })`** returns what the visitor's page needs to show the provider's checkout: `{ checkoutUrl, origin, amount, autofill, messages }`. `origin` is the only origin the page will accept messages from (and send to). `order` carries the server-priced `totalCents`, the buyer, the `reference` and `ticketCsv`. Throw if payments can't be started.
- **`verify({ payload, order, transaction, event, site, settings })`** is called when the visitor's page says the payment went through, with whatever the page reported (`transaction`). **It must ask the provider's own server**, never trust `transaction`. Return `{ status, providerRef, detail }` with `status`:
  - `"verified"`: a completed payment of exactly `order.totalCents`, tied to this order's `reference`, not already used for another order;
  - `"unverified"`: it couldn't be checked (provider unreachable, or an answer that doesn't say which order it was for). The order is kept for a person and checked again every minute;
  - `"mismatch"`: the provider says it is not a completed payment of this amount for this order.

The events plugin holds the places, prices the order, tracks its state and sends the emails; the provider only takes the money and says whether it was taken. Never put a card number in anything a provider returns.

## Known limits

- **Free RSVP and tickets are not mixed on one event.** An event with any priced ticket sells tickets; the free form refuses it.
- No recurring events, no door check-in or QR codes, no per-ticket stock (the event's capacity is the limit), no refunds from inside Polysite.
- Reminders and the clean-up run from the server itself every few minutes: right for one server, which is the reference deployment.
- The attendee list and the privacy register are described above.

## How it is put together

```text
plugins/events/
  polysite.plugin.json     "kind": ["content-type", "site-settings"]
  src/index.js             adds the collections, the public endpoints and the background sweeps
  src/collections.js       events, event-rsvps, event-orders, event-stats
  src/endpoints.js         RSVP form, calendar file, cancel link, staff tools (recount, CSV)
  src/orderEndpoints.js    start an order, complete it, check it, staff actions
  src/service.js           registering, the waiting list, giving a place back
  src/orders.js            holding places, asking the payment provider, expiring holds
  src/tickets.js           prices, receipt split, order totals (pure)
  src/rsvp.js              what can be accepted, what a form must contain (pure)
  src/db.js                the atomic place counting
  src/mail.js, ics.js      the emails and the calendar file (pure)
  src/spam.js              form token, rate limit, cancel link, duplicate key
  src/reminders.js         the day-before email and the clean-up of old RSVPs
  src/admin/               the event's summary, order buttons, front-end link
  migrations/              the plugin's own tables
  web/                     the Nuxt layer: list, event page, RSVP form, tickets, cancel page
  test/                    unit tests; test/e2e/events.e2e.mjs runs against a live stack
```
