"use client";
import { useForm } from "@payloadcms/ui";
import { createElement as h, useState } from "react";

import { DEFAULT_EVENTS_LABEL, DEFAULT_EVENTS_PATH, DEFAULT_PER_PAGE } from "../urls.js";

// "Reset to defaults" for the Event settings. It only puts the three settings back to their starting values in the form
// (the editor then saves, or leaves the page to cancel). It never touches events: resetting settings
// and deleting content are separate things, and nothing in this plugin deletes what editors have written.
export function ResetEventSettings() {
  const { dispatchFields, setModified } = useForm();
  const [done, setDone] = useState(false);

  const reset = () => {
    dispatchFields({ type: "UPDATE", path: "label", value: DEFAULT_EVENTS_LABEL });
    dispatchFields({ type: "UPDATE", path: "path", value: DEFAULT_EVENTS_PATH });
    dispatchFields({ type: "UPDATE", path: "perPage", value: DEFAULT_PER_PAGE });
    setModified(true);
    setDone(true);
  };

  return h(
    "div",
    { className: "field-type", style: { marginBottom: "var(--base)" } },
    h("button", { type: "button", className: "btn btn--style-secondary btn--size-small", onClick: reset }, "Reset event settings to defaults"),
    h(
      "div",
      { style: { marginTop: "calc(var(--base) / 2)", opacity: 0.7, fontSize: "0.85em" } },
      done ? "Defaults filled in. Save to keep them." : "Puts the label, section address and page size back to their starting values. Your events and RSVPs are not touched.",
    ),
  );
}
