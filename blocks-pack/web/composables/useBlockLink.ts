import { safeHref } from "../utils/blocks.js";

// An address an editor typed, ready for a link: "" when it is not safe (only http, https, mailto, tel and relative addresses are),
// and a page of this site gets the visitor's language in front (/fr/contact) like every other internal link.
export function useBlockLink() {
  const localePath = useLocalePath();
  return (value: unknown): string => {
    const href = safeHref(value);
    return href ? localePath(href) : "";
  };
}
