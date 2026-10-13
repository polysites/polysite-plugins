// The shapes of what the posts plugin reads from the CMS's REST API. Deliberately minimal and local: this plugin's
// web part must not import from the core app (apps/web), which it ships separately from.

export interface PostImage {
  url?: string;
  alt?: string;
}

export interface PayloadPostCategory {
  id?: string | number;
  name?: string;
  slug?: string;
  description?: string;
}

export interface PayloadPost {
  id?: string | number;
  title?: string;
  slug?: string;
  excerpt?: string;
  byline?: string;
  publishedAt?: string;
  heroImage?: PostImage | null;
  categories?: Array<PayloadPostCategory | string | number>;
  /** Payload's rich-text (Lexical) state; drawn by components/RichText.vue. */
  body?: unknown;
  meta?: {
    title?: string;
    description?: string;
    image?: PostImage;
  };
}

export interface PayloadPostList {
  docs: PayloadPost[];
  page: number;
  totalPages: number;
  totalDocs: number;
}

/** The part of a site the posts plugin cares about. The plugin's News settings reach the site as `extensions.news` (the core attaches the settings row's public fields). */
export interface NewsSite {
  name?: string;
  enabledModules?: string[];
  extensions?: { news?: { label?: string | null; path?: string | null; perPage?: number | null } };
}
