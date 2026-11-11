// Household-facing wording in one place, ready for a Kannada catalogue. Only English exists
// today: Kannada needs a translation reviewed by a fluent speaker before it ships, so this
// file deliberately has no machine-made "kn" entries.

const en = {
  nav: { home: "Home", book: "Book", visits: "Visits", help: "Help" },
  walkInPromise:
    "Booking is optional. You can always walk in during shop hours and you will be served. Your entitlement does not depend on this app.",
  demoCard:
    "Demo card linking matches fictional records only. It is not government verification and real ration-card numbers are not accepted.",
  checkInNote:
    "Checking in records that you arrived. It is not e-POS authentication; the shop still verifies you as usual.",
} as const;

export type BeneficiaryMessages = typeof en;
export const beneficiaryText: { en: BeneficiaryMessages } = { en };
