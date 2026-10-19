// The shapes of what the events plugin reads from the CMS's REST API. Deliberately minimal and local: this plugin's web part must not
// import from the core app (apps/web), which it ships separately from.

export interface EventImage {
  url?: string;
  alt?: string;
}

export interface EventAvailability {
  state: "open" | "waitlist" | "full" | "closed" | "upcoming";
  capacity: number | null;
  confirmedGuests: number;
  spotsLeft: number | null;
  waitlist: boolean;
  waitlistedGuests: number;
  maxGuests: number;
}

export interface PayloadEvent {
  id: string | number;
  title?: string;
  slug?: string;
  summary?: string;
  startsAt?: string;
  endsAt?: string | null;
  timeZone?: string | null;
  venueName?: string | null;
  address?: string | null;
  onlineUrl?: string | null;
  heroImage?: EventImage | null;
  /** Payload's rich-text (Lexical) state; drawn by components/EventRichText.vue. */
  body?: unknown;
  tickets?: Array<{ code?: string; label?: string; price?: number | null }>;
  rsvp?: { open?: boolean; capacity?: number | null; waitlist?: boolean; maxGuests?: number | null; opensAt?: string | null; closesAt?: string | null };
  /** Computed by the CMS when the event is read: never stored. */
  availability?: EventAvailability | null;
  meta?: { title?: string; description?: string; image?: EventImage };
}

export interface PayloadEventList {
  docs: PayloadEvent[];
  page: number;
  totalPages: number;
  totalDocs: number;
}

/** The part of a site the events plugin cares about. The plugin's Event settings reach the site as `extensions.events`. */
export interface EventsSite {
  name?: string;
  enabledModules?: string[];
  extensions?: { events?: { label?: string | null; path?: string | null; perPage?: number | null; defaultTimeZone?: string | null } };
}

/** What GET /api/event-intake/:id answers. */
export interface RsvpDefinition {
  event: { id: number | string; title: string; startsAt: string; endsAt: string | null; timeZone: string | null; venueName: string | null; address: string | null; onlineUrl: string | null };
  availability: EventAvailability;
  form: { askPhone: boolean; phoneRequired: boolean; maxGuests: number; consentLabel: string | null; policyUrl: string; submitLabel: string };
  calendar: { google?: string; outlook?: string };
  icsUrl: string;
  honeypot: string;
  token: string;
}
