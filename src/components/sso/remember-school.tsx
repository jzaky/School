"use client";

import { useEffect } from "react";
import { rememberSchoolAction } from "@/server/sso/actions";

/** Remembers the school whose sign-in page this is (a hint for the general page and Google or Microsoft sign-in). */
export function RememberSchool({ slug }: { slug: string }) {
  useEffect(() => {
    void rememberSchoolAction(slug).catch(() => undefined);
  }, [slug]);
  return null;
}
