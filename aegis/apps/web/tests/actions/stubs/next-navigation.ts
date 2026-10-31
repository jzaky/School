import { RedirectError } from "./request";

export function redirect(url: string): never {
  throw new RedirectError(url);
}
export function notFound(): never {
  throw new RedirectError("/404");
}
