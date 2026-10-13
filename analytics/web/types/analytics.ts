import type { RawTool } from "../utils/tracking";

// The public part of a site's tracking settings, which the core attaches as `site.extensions.analytics` (the plugin's own
// `analytics-settings` collection; see apps/cms/src/plugins/siteSettings.ts). Absent when the plugin isn't installed or the
// site has no settings row yet.
export interface AnalyticsSetting {
  tools?: RawTool[] | null;
  respectPrivacySignals?: boolean | null;
  consentNotice?: string | null;
}

/** The parts of a site this plugin reads. The core's site type doesn't know about the plugin's settings. */
export interface AnalyticsSite {
  extensions?: { analytics?: AnalyticsSetting | null } | null;
  privacyPolicyUrl?: string | null;
}
