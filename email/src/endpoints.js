// POST /api/email/test: sends a test message to the signed-in Super Admin and
// reports what the mail server answered. It exercises the whole path (settings,
// connection, login, hand-off) and leaves an entry in the Email Logs.

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export const testEndpoint = {
  path: "/email/test",
  method: "post",
  handler: async (req) => {
    if (!req.user?.isSuperAdmin) return json({ message: "Only a Super Admin can send a test email." }, 403);
    const settings = await req.payload.findGlobal({ slug: "email-settings", overrideAccess: true });
    if (!settings.smtpHost) return json({ ok: false, message: "No SMTP host is set, so nothing was sent." }, 400);

    const to = req.user.email;
    try {
      const info = await req.payload.sendEmail({
        to,
        subject: "Polysite test email",
        html: `<p>This is a test message from your Polysite install.</p><p>Sent from ${settings.fromAddress} through ${settings.smtpHost}. If you can read this, Polysite reached your mail provider and the provider accepted the message.</p>`,
        polysiteKind: "test",
        polysiteActor: req.user.id,
      });
      return json({ ok: true, to, response: info?.response ?? null });
    } catch (err) {
      return json({ ok: false, message: `${err.message}`.split("\n")[0], code: err.code ?? null, responseCode: err.responseCode ?? null }, 502);
    }
  },
};

export const emailEndpoints = [testEndpoint];
