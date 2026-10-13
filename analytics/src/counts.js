// How many people have sent each form. These are the submissions Polysite
// holds, so a form with automatic deletion counts only what hasn't expired yet.
// It is a count of stored submissions, not of visitors or page views: those come
// from whichever analytics tools the site uses.

const MAX_FORMS = 100;

export const daysAgo = (days, now = new Date()) => new Date(now.getTime() - days * 86_400_000).toISOString();

// Reads through the caller's own access (overrideAccess: false), so a user only
// sees the forms and sites their role already lets them open. Pass `formId` for one form.
export async function formSubmissionCounts(payload, user, now = new Date(), formId = null) {
  const forms = formId
    ? await payload
        .findByID({ collection: "forms", id: formId, depth: 1, overrideAccess: false, user })
        .then((doc) => ({ docs: [doc], totalDocs: 1 }))
        .catch(() => ({ docs: [], totalDocs: 0 }))
    : await payload.find({ collection: "forms", depth: 1, limit: MAX_FORMS, pagination: false, sort: "title", overrideAccess: false, user });

  const rows = [];
  for (const form of forms.docs) {
    const countSince = (since) =>
      payload.count({
        collection: "form-submissions",
        where: since
          ? { and: [{ form: { equals: form.id } }, { createdAt: { greater_than_equal: since } }] }
          : { form: { equals: form.id } },
        overrideAccess: false,
        user,
      });
    const [last7, last30, total] = await Promise.all([countSince(daysAgo(7, now)), countSince(daysAgo(30, now)), countSince(null)]);
    rows.push({
      id: form.id,
      title: form.title,
      site: typeof form.site === "object" && form.site ? form.site.name : null,
      last7: last7.totalDocs,
      last30: last30.totalDocs,
      total: total.totalDocs,
    });
  }
  return { rows, truncated: forms.totalDocs > forms.docs.length };
}
