// Deciding who an identity provider says someone is, and whether to believe it. Pure functions, so every rule is tested.

export const TYPES = ["google", "microsoft", "github", "oidc"];
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isTenantId = (value) => GUID.test(String(value ?? ""));

export function issuerOf(provider) {
  if (provider.type === "google") return "https://accounts.google.com";
  if (provider.type === "microsoft") return `https://login.microsoftonline.com/${provider.tenant}/v2.0`;
  return String(provider.issuer ?? "").replace(/\/+$/, "");
}

// The email the provider vouches for, or { email: null, reason } when it can't be trusted. An address is trusted only
// when the provider itself says it has verified it: matching an account by an address anyone can claim would let them in.
export function emailFromClaims(provider, claims) {
  const email = String(claims?.email ?? "").trim().toLowerCase();
  if (provider.type === "microsoft") {
    // Entra ID doesn't send `email_verified`. A work or school directory only issues addresses it manages, so an address
    // from the tenant this provider is bound to (the `tid` claim) is trusted. Any other tenant, or a personal account, is not.
    const address = email || String(claims?.preferred_username ?? "").trim().toLowerCase();
    if (!address) return { email: null, reason: "sso_unverified" };
    if (!isTenantId(provider.tenant) || String(claims?.tid ?? "").toLowerCase() !== String(provider.tenant).toLowerCase()) {
      return { email: null, reason: "sso_unverified" };
    }
    return { email: address, reason: null };
  }
  if (!email) return { email: null, reason: "sso_unverified" };
  const verified = claims?.email_verified === true || claims?.email_verified === "true";
  return verified ? { email, reason: null } : { email: null, reason: "sso_unverified" };
}

// "example.org, sub.example.org"; empty means any domain.
export function domainAllowed(email, allowed) {
  const list = String(allowed ?? "")
    .toLowerCase()
    .split(/[\s,;]+/)
    .map((d) => d.replace(/^@/, ""))
    .filter(Boolean);
  if (!list.length) return true;
  const domain = String(email).toLowerCase().split("@").pop();
  return list.includes(domain);
}

// GitHub: pick the primary address, and only if GitHub has verified it.
export function githubEmail(emails) {
  const list = Array.isArray(emails) ? emails : [];
  const primary = list.find((e) => e?.primary === true && e?.verified === true);
  return primary ? String(primary.email).trim().toLowerCase() : null;
}

// What the sign-in page can say about a failed attempt. Only these codes are ever shown, never text from the address bar.
export const ERRORS = {
  sso_unavailable: "That sign-in method isn't available.",
  sso_failed: "Single sign-on didn't complete. Try again.",
  sso_expired: "That sign-in took too long or was opened in another browser. Try again.",
  sso_unverified: "Your provider didn't confirm your email address, so you can't sign in this way.",
  sso_domain: "Your email address isn't allowed to sign in this way.",
  sso_no_account: "No account matches that email address. Ask an administrator to add you, then try again.",
  sso_locked: "This account is locked for a few minutes after too many wrong passwords. Try again shortly.",
  sso_conflict: "This account is already linked to a different identity from that provider. Ask an administrator for help.",
  sso_denied: "You cancelled the sign-in.",
};
