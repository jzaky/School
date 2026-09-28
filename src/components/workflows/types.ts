export type Option = { key: string; name: string };

/** Choices the inspector offers, loaded on the server and already localized. */
export type BuilderOptions = {
  roles: Option[];
  staff: Array<{ id: string; name: string; hint?: string }>;
  departments: Option[];
  messageTemplates: Option[];
  documentTemplates: Option[];
  appointmentTypes: Option[];
};

export type BuilderWorkflow = {
  id: string;
  name: string;
  description: string;
  status: string;
  publishedVersion: number | null;
  publishedAt: string | null;
  services: string[];
  safeguarding: boolean;
};

export type BuilderVersion = { version: number; publishedAt: string; by: string; activeRuns: number; current: boolean };
