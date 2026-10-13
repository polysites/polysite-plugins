/** What the plugin's Share settings store for a site (the core attaches them as `site.extensions.share`). Everything is checked again by readSettings() before use. */
export interface ShareSetting {
  enabled?: boolean | null;
  networks?: string[] | null;
  style?: string | null;
  placement?: string | null;
  contentTypes?: string[] | null;
  text?: string | null;
  via?: string | null;
}

/** The part of a Site the share buttons read. */
export interface ShareSite {
  enabledModules?: string[] | null;
  name?: string | null;
  extensions?: { share?: ShareSetting | null } | null;
}

/** The page being shared: its canonical address, its own title, and what kind of address it is. */
export interface SharePage {
  url: string;
  title: string;
  kind: string;
}
