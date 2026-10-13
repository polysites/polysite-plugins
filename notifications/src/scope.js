// A deleted document can't be re-read to check that the subscriber could open it, so the only thing left to check is whose
// it was. A person hears about the deletion of a document of a site they are assigned to (a Super Admin, of any site), never
// of another site's: the title of a deleted page, and the email address of whoever deleted it, are that site's business.
const idOf = (ref) => (ref && typeof ref === "object" ? ref.id : ref);

export function mayHearOfDeletion(user, event) {
  if (user?.isSuperAdmin === true) return true;
  if (event?.site === null || event?.site === undefined) return false;
  const mine = (user?.assignedSites ?? []).map((row) => String(idOf(row?.site)));
  return mine.includes(String(event.site));
}
