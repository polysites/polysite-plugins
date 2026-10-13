"use client";
import { SelectInput, useField, useFormFields } from "@payloadcms/ui";
import { createElement as h } from "react";

// The language menu for the `site-languages` row. The values are plain text (never a database enum, since the catalog is the core's
// and grows with its releases), so the menu is this component rather than a Payload `select`. `single` is the default-language
// menu, which offers only the languages ticked above it. A code the catalog no longer has stays visible by its raw name, so it can
// be unticked. Plain React.createElement (no JSX), like every plugin admin component.
export function LanguageSelect({ field, path, options, single }) {
  const { errorMessage, setValue, showError, value } = useField({ path });
  const offered = useFormFields(([fields]) => fields.languages?.value);

  const chosen = single ? (typeof value === "string" && value ? [value] : []) : Array.isArray(value) ? value : [];
  const pool = single && Array.isArray(offered) && offered.length > 0 ? options.filter((o) => offered.includes(o.value)) : options;
  const known = new Set(pool.map((o) => o.value));
  const all = [...pool, ...chosen.filter((v) => !known.has(v)).map((v) => ({ label: v, value: v }))];

  return h(SelectInput, {
    hasMany: !single,
    isClearable: true,
    label: field?.label,
    name: field?.name,
    path,
    options: all,
    showError,
    value: single ? (chosen[0] ?? undefined) : chosen,
    onChange: (selected) => {
      const list = Array.isArray(selected) ? selected : selected ? [selected] : [];
      const codes = list.map((o) => o.value);
      setValue(single ? (codes[0] ?? null) : codes);
    },
    Error: showError ? h("span", { className: "field-error" }, errorMessage) : undefined,
  });
}
