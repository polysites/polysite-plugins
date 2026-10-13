"use client";
import { useForm } from "@payloadcms/ui";
import { createElement as h, useState } from "react";

import { DEFAULT_NEWS_LABEL, DEFAULT_NEWS_PATH, DEFAULT_PER_PAGE } from "../urls.js";

// "Reset to defaults" for the News settings. It only puts the three settings back to their starting values in the form
// (the editor then saves, or leaves the page to cancel). It never touches posts or categories: resetting settings
// and deleting content are separate things, and nothing in this plugin deletes what editors have written.
export function ResetNewsSettings() {
  const { dispatchFields, setModified } = useForm();
  const [done, setDone] = useState(false);

  const reset = () => {
    dispatchFields({ type: "UPDATE", path: "label", value: DEFAULT_NEWS_LABEL });
    dispatchFields({ type: "UPDATE", path: "path", value: DEFAULT_NEWS_PATH });
    dispatchFields({ type: "UPDATE", path: "perPage", value: DEFAULT_PER_PAGE });
    setModified(true);
    setDone(true);
  };

  return h(
    "div",
    { className: "field-type", style: { marginBottom: "var(--base)" } },
    h("button", { type: "button", className: "btn btn--style-secondary btn--size-small", onClick: reset }, "Reset news settings to defaults"),
    h(
      "div",
      { style: { marginTop: "calc(var(--base) / 2)", opacity: 0.7, fontSize: "0.85em" } },
      done ? "Defaults filled in. Save to keep them." : "Puts the label, section address and page size back to their starting values. Your posts and categories are not touched.",
    ),
  );
}
