import { createRemoteJWKSet, jwtVerify } from "jose";

import { challengeOf } from "./state.js";
import { githubEmail, issuerOf } from "./claims.js";

// Talking to the identity provider: finding its endpoints, sending the person there, trading the code for proof of who they
// are, and checking that proof. The provider's address is something only a Super Admin can set, but the server still treats
// it with care: https only (unless AUTH_SSO_ALLOW_HTTP=1, for a local test provider), no redirects followed, a short timeout.
const GITHUB = {
  authorization_endpoint: "https://github.com/login/oauth/authorize",
  token_endpoint: "https://github.com/login/oauth/access_token",
  user: "https://api.github.com/user",
  emails: "https://api.github.com/user/emails",
};
const TIMEOUT_MS = 10_000;
const META_TTL_MS = 60 * 60 * 1000;
const metaCache = new Map();
const jwksCache = new Map();

export function requireHttps(url) {
  if (url.startsWith("https://")) return url;
  if (process.env.AUTH_SSO_ALLOW_HTTP === "1" && url.startsWith("http://")) return url;
  throw new Error(`refusing a non-https address: ${url}`);
}

async function getJson(url, init = {}) {
  const res = await fetch(requireHttps(url), { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

export async function metadataOf(provider, now = Date.now()) {
  if (provider.type === "github") return GITHUB;
  const issuer = issuerOf(provider);
  const hit = metaCache.get(issuer);
  if (hit && hit.until > now) return hit.meta;
  const meta = await getJson(`${issuer}/.well-known/openid-configuration`);
  // The document must be about the issuer that was asked for, or a mis-set address could point at someone else's keys.
  if (String(meta.issuer ?? "").replace(/\/+$/, "") !== issuer) throw new Error("the provider's issuer does not match the address it was fetched from");
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) requireHttps(String(meta[key] ?? ""));
  metaCache.set(issuer, { meta, until: now + META_TTL_MS });
  return meta;
}

export const clearCaches = () => {
  metaCache.clear();
  jwksCache.clear();
};

export function authorizeUrl({ meta, provider, redirectUri, flow }) {
  const url = new URL(requireHttps(meta.authorization_endpoint));
  const params = {
    response_type: "code",
    client_id: provider.clientId,
    redirect_uri: redirectUri,
    state: flow.state,
    code_challenge: challengeOf(flow.verifier),
    code_challenge_method: "S256",
  };
  if (provider.type === "github") params.scope = "read:user user:email";
  else Object.assign(params, { scope: "openid email profile", nonce: flow.nonce });
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function exchange({ meta, provider, secret, code, redirectUri, verifier }) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: provider.clientId,
    client_secret: secret,
    code_verifier: verifier,
  });
  return getJson(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
}

function keysFor(uri) {
  if (!jwksCache.has(uri)) jwksCache.set(uri, createRemoteJWKSet(new URL(requireHttps(uri)), { timeoutDuration: TIMEOUT_MS }));
  return jwksCache.get(uri);
}

// Returns { subject, claims } for an OpenID Connect provider, or { subject, email } for GitHub. Throws when the proof
// doesn't check out (bad signature, wrong issuer or audience, expired, wrong nonce).
export async function identify({ meta, provider, secret, code, redirectUri, flow }) {
  const tokens = await exchange({ meta, provider, secret, code, redirectUri, verifier: flow.verifier });

  if (provider.type === "github") {
    if (!tokens.access_token) throw new Error("GitHub gave no access token");
    const headers = { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "polysite" };
    const profile = await getJson(GITHUB.user, { headers });
    const emails = await getJson(GITHUB.emails, { headers });
    return { subject: String(profile.id), claims: null, email: githubEmail(emails) };
  }

  if (!tokens.id_token) throw new Error("the provider returned no ID token");
  const { payload } = await jwtVerify(tokens.id_token, keysFor(meta.jwks_uri), {
    issuer: issuerOf(provider),
    audience: provider.clientId,
    algorithms: ["RS256", "RS384", "RS512", "ES256", "ES384", "PS256"],
  });
  if (payload.nonce !== flow.nonce) throw new Error("the ID token was not issued for this sign-in");
  if (!payload.sub) throw new Error("the ID token has no subject");
  return { subject: String(payload.sub), claims: payload, email: undefined };
}
