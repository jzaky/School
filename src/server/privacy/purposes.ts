// Choices for processing purposes. Keys match the adminCompliance.basis and .category messages;
// values are what is stored (the compliance page turns stored values back into message keys).

export const BASIS_VALUES = {
  consent: "Consent",
  contract_with_the_family: "Contract with the family",
  legal_obligation: "Legal obligation",
  vital_interests: "Vital interests",
  vital_interests_and_legal_obligation: "Vital interests and legal obligation",
  legitimate_interest_with_opt_out: "Legitimate interest with opt-out",
  public_interest: "Public interest",
} as const;

export const CATEGORY_VALUES = {
  identity: "identity",
  contact: "contact",
  academic: "academic",
  attendance: "attendance",
  wellbeing: "wellbeing",
  safeguarding: "safeguarding",
  medical: "medical",
  images: "images",
  career: "career",
  special_category: "special category",
} as const;

export const basisKey = (stored: string) => stored.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
export const categoryKey = (stored: string) => stored.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
