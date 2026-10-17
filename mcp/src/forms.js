import { markdownToLexical } from "./markdown.js";

export const FIELD_TYPES = ["text", "email", "textarea", "number", "checkbox", "select", "date"];
const slugName = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field";

// Turns a plain description of a form into the shape the form builder stores. `allowedTypes` is what the installed form builder offers.
export function buildFormData({ title, fields, submitLabel, confirmation, purpose, consentRequired }, allowedTypes = FIELD_TYPES) {
  if (!title) throw new Error("A form needs a title.");
  if (!Array.isArray(fields) || fields.length === 0) throw new Error("A form needs at least one field.");
  const seen = new Set();
  const built = fields.map((f, i) => {
    const type = f.type ?? "text";
    if (!FIELD_TYPES.includes(type) || !allowedTypes.includes(type)) {
      throw new Error(`Field ${i + 1}: type "${type}" is not available. Use one of: ${FIELD_TYPES.filter((t) => allowedTypes.includes(t)).join(", ")}.`);
    }
    if (!f.label) throw new Error(`Field ${i + 1}: a label is required.`);
    let name = f.name ? slugName(f.name) : slugName(f.label);
    while (seen.has(name)) name += "_2";
    seen.add(name);
    const out = { blockType: type, name, label: f.label, required: Boolean(f.required), width: 100 };
    if (type === "select") {
      if (!Array.isArray(f.options) || f.options.length === 0) throw new Error(`Field ${i + 1} (select): options are required.`);
      out.options = f.options.map((o) => (typeof o === "string" ? { label: o, value: slugName(o) } : { label: o.label, value: o.value ?? slugName(o.label) }));
    }
    return out;
  });
  const data = {
    title,
    fields: built,
    submitButtonLabel: submitLabel ?? "Send",
    confirmationType: "message",
    confirmationMessage: markdownToLexical(confirmation ?? "Thank you. We have received your message."),
  };
  if (purpose || consentRequired) data.privacy = { ...(purpose ? { purpose } : {}), ...(consentRequired ? { consentRequired: true } : {}) };
  return data;
}
