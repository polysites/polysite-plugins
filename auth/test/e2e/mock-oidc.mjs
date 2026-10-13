// A tiny OpenID Connect provider for testing single sign-on without a real Google or Microsoft account. It signs ID tokens
// with a key made at start-up, and a test steers it by POSTing to /control which person to sign in and how to misbehave.
//
//   cd plugins/auth && npm install && PORT=9000 ISSUER=http://mock-oidc:9000 node test/e2e/mock-oidc.mjs
//
// Test use only. It authenticates anyone the test tells it to.
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";

import { SignJWT, exportJWK, generateKeyPair } from "jose";

const PORT = Number(process.env.PORT ?? 9000);
const ISSUER = process.env.ISSUER ?? `http://localhost:${PORT}`;
const CLIENT_ID = "mock-client";
const CLIENT_SECRET = "mock-client-secret";

const good = await generateKeyPair("RS256");
const other = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(good.publicKey)), kid: "k1", alg: "RS256", use: "sig" };

let control = { sub: "mock-user-1", email: "person@example.test", email_verified: true };
const codes = new Map();

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, ISSUER);
  if (url.pathname === "/.well-known/openid-configuration") {
    return json(res, 200, { issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks` });
  }
  if (url.pathname === "/jwks") return json(res, 200, { keys: [jwk] });
  if (url.pathname === "/control" && req.method === "POST") {
    control = JSON.parse(await readBody(req));
    return json(res, 200, { ok: true });
  }
  if (url.pathname === "/authorize") {
    const redirect = url.searchParams.get("redirect_uri");
    if (!redirect || url.searchParams.get("client_id") !== CLIENT_ID) return json(res, 400, { error: "bad client or redirect" });
    if (control.deny) {
      res.writeHead(302, { Location: `${redirect}?error=access_denied&state=${encodeURIComponent(url.searchParams.get("state") ?? "")}` });
      return res.end();
    }
    const code = randomBytes(16).toString("hex");
    codes.set(code, { nonce: url.searchParams.get("nonce"), challenge: url.searchParams.get("code_challenge"), control: { ...control } });
    res.writeHead(302, { Location: `${redirect}?code=${code}&state=${encodeURIComponent(url.searchParams.get("state") ?? "")}` });
    return res.end();
  }
  if (url.pathname === "/token" && req.method === "POST") {
    const form = new URLSearchParams(await readBody(req));
    const entry = codes.get(form.get("code") ?? "");
    codes.delete(form.get("code") ?? "");
    if (!entry) return json(res, 400, { error: "invalid_grant" });
    if (form.get("client_id") !== CLIENT_ID || form.get("client_secret") !== CLIENT_SECRET) return json(res, 401, { error: "invalid_client" });
    const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
    if (challenge !== entry.challenge) return json(res, 400, { error: "invalid_grant", error_description: "PKCE check failed" });
    const c = entry.control;
    const now = Math.floor(Date.now() / 1000);
    const claims = { email: c.email, email_verified: c.email_verified, nonce: c.badNonce ? "not-the-nonce" : entry.nonce };
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(c.wrongIssuer ? "http://someone-else" : ISSUER)
      .setAudience(c.wrongAudience ? "another-client" : CLIENT_ID)
      .setSubject(c.sub)
      .setIssuedAt(now)
      .setExpirationTime(c.expired ? now - 120 : now + 300)
      .sign(c.badSignature ? other.privateKey : good.privateKey);
    return json(res, 200, { access_token: "unused", token_type: "Bearer", id_token: token });
  }
  json(res, 404, { error: "not found" });
});

server.listen(PORT, "0.0.0.0", () => console.log(`mock OIDC provider on ${ISSUER} (client ${CLIENT_ID} / ${CLIENT_SECRET})`));
