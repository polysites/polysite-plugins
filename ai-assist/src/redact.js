// A guard on what leaves the server: email addresses and phone-like numbers are masked before text goes to the provider.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?<![\w.])(?:\+?\d[\d\s().-]{7,}\d)(?![\w])/g;

export function maskPersonalData(text) {
  return String(text ?? "").replace(EMAIL, "[email]").replace(PHONE, (m) => (m.replace(/\D/g, "").length >= 8 ? "[phone]" : m));
}
