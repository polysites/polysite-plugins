import { secretKey } from "../crypto.js";
import { USERS, readUser } from "../twofactor.js";
import { PROVIDERS } from "./collection.js";
import { domainAllowed, emailFromClaims } from "./claims.js";
import { IDENTITIES } from "./identities.js";
import { authorizeUrl, identify, metadataOf } from "./providers.js";
import { COOKIE, cookieValue, newFlow, readFlow, safeNext, sameState, signFlow } from "./state.js";

// /api/auth-sso/providers        which buttons the sign-in page shows
// /api/auth-sso/:slug/start      sends the browser to the provider
// /api/auth-sso/:slug/callback   where the provider sends it back; signs the person in or says why not
//
// Rules, in the order they matter: the person must already have an account (nobody is created here); the provider must
// vouch for the email address; the address must be on the provider's allow-list when it has one; a locked account stays
// locked. Anything else is a refusal with a short code the sign-in page turns into a sentence.
const loginUrl = (base, code) => `${base}/admin/login?sso_error=${code}`;

function baseUrl(req) {
  const configured = req.payload.config.serverURL;
  return String(configured || new URL(req.url).origin).replace(/\/+$/, "");
}

const redirectUriFor = (req, slug) => `${baseUrl(req)}/api/auth-sso/${slug}/callback`;

function cookieHeader(name, value, { base, maxAge }) {
  const secure = base.startsWith("https://") ? "; Secure" : "";
  return `${name}=${value}; Path=/api/auth-sso; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function redirect(location, cookies = []) {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

// The linked identity for a provider and a subject (who it is at the provider), or for a provider and a user (what that account is
// already linked to). A row whose user is gone is removed here, so it can never block the identity from being linked again.
async function findIdentity(payload, where) {
  const found = await payload.find({
    collection: IDENTITIES,
    where: { and: Object.entries(where).map(([name, value]) => ({ [name]: { equals: value } })) },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    pagination: false,
  });
  const row = found.docs[0] ?? null;
  if (row && !row.user) {
    await payload.delete({ collection: IDENTITIES, id: row.id, overrideAccess: true });
    return null;
  }
  return row;
}

async function findProvider(payload, slug, { reveal = false } = {}) {
  const found = await payload.find({
    collection: PROVIDERS,
    where: { and: [{ slug: { equals: String(slug ?? "") } }, { enabled: { equals: true } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    context: reveal ? { revealSsoSecret: true } : {},
  });
  return found.docs[0] ?? null;
}

export function ssoEndpoints(kit) {
  return [
    {
      path: "/auth-sso/providers",
      method: "get",
      handler: async (req) => {
        const found = await req.payload.find({ collection: PROVIDERS, where: { enabled: { equals: true } }, limit: 20, depth: 0, overrideAccess: true, pagination: false });
        const list = found.docs.map((p) => ({ slug: p.slug, label: p.label, type: p.type }));
        return Response.json({ providers: list }, { headers: { "Cache-Control": "no-store" } });
      },
    },
    {
      path: "/auth-sso/:slug/start",
      method: "get",
      handler: async (req) => {
        const base = baseUrl(req);
        const slug = req.routeParams?.slug;
        try {
          const provider = await findProvider(req.payload, slug);
          if (!provider) return redirect(loginUrl(base, "sso_unavailable"));
          const flow = newFlow({ slug: provider.slug, next: new URL(req.url).searchParams.get("next") });
          const meta = await metadataOf(provider);
          const target = authorizeUrl({ meta, provider, redirectUri: redirectUriFor(req, provider.slug), flow });
          return redirect(target, [cookieHeader(COOKIE, signFlow(flow, secretKey()), { base, maxAge: 600 })]);
        } catch (err) {
          req.payload.logger.error({ err, msg: `[auth] could not start single sign-on for "${slug}"` });
          return redirect(loginUrl(base, "sso_failed"));
        }
      },
    },
    {
      path: "/auth-sso/:slug/callback",
      method: "get",
      handler: async (req) => {
        const base = baseUrl(req);
        const slug = req.routeParams?.slug;
        const clear = cookieHeader(COOKIE, "", { base, maxAge: 0 });
        const fail = (code) => redirect(loginUrl(base, code), [clear]);
        const params = new URL(req.url).searchParams;
        try {
          const flow = readFlow(cookieValue(req.headers.get("cookie"), COOKIE), secretKey());
          if (!flow || flow.slug !== slug) return fail("sso_expired");
          if (params.get("error")) return fail(params.get("error") === "access_denied" ? "sso_denied" : "sso_failed");
          if (!sameState(params.get("state") ?? "", flow.state)) return fail("sso_expired");
          const code = params.get("code");
          if (!code) return fail("sso_failed");

          const provider = await findProvider(req.payload, slug, { reveal: true });
          if (!provider) return fail("sso_unavailable");

          const meta = await metadataOf(provider);
          const who = await identify({ meta, provider, secret: provider.clientSecret, code, redirectUri: redirectUriFor(req, provider.slug), flow });

          const verdict = who.claims ? emailFromClaims(provider, who.claims) : { email: who.email, reason: who.email ? null : "sso_unverified" };
          if (!verdict.email) return fail(verdict.reason);
          const email = verdict.email;
          if (!domainAllowed(email, provider.allowedDomains)) return fail("sso_domain");

          // An account already linked to this identity wins; otherwise the account with this verified email.
          const linked = await findIdentity(req.payload, { provider: provider.slug, subject: who.subject });
          const byEmail = linked
            ? null
            : (await req.payload.find({ collection: USERS, where: { email: { equals: email } }, limit: 1, depth: 0, overrideAccess: true })).docs[0];
          const matchId = linked ? linked.user : byEmail?.id;
          if (!matchId) return fail("sso_no_account");

          const user = await readUser(req.payload, matchId);
          if (user.lockUntil && new Date(user.lockUntil).getTime() > Date.now()) return fail("sso_locked");

          if (!linked) {
            // The first time this account signs in with this provider: link the identity. A different identity already linked
            // to the account for this provider means someone else's login at the provider; that never takes the account over.
            const mine = await findIdentity(req.payload, { provider: provider.slug, user: user.id });
            if (mine && mine.subject !== who.subject) return fail("sso_conflict");
            if (!mine) {
              try {
                await req.payload.create({ collection: IDENTITIES, data: { user: user.id, provider: provider.slug, subject: who.subject }, overrideAccess: true, depth: 0 });
              } catch (err) {
                // Two sign-ins at the same moment both tried to link; the second one only carries on if it is the same identity.
                const now = await findIdentity(req.payload, { provider: provider.slug, user: user.id });
                if (!now || now.subject !== who.subject) throw err;
              }
            }
          }

          const session = await kit.createSession(req.payload, USERS, user.id);
          req.payload.logger.info(`[auth] ${user.email} signed in with ${provider.slug}`);
          return redirect(`${base}${safeNext(flow.next)}`, [session.cookie, clear]);
        } catch (err) {
          req.payload.logger.error({ err, msg: `[auth] single sign-on with "${slug}" failed` });
          return fail("sso_failed");
        }
      },
    },
  ];
}
