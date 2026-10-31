import { request } from "./request";

export async function cookies() {
  return {
    get: (name: string) => (request.cookies.has(name) ? { name, value: request.cookies.get(name)! } : undefined),
    getAll: () => [...request.cookies].map(([name, value]) => ({ name, value })),
    has: (name: string) => request.cookies.has(name),
    set: (name: string, value: string) => void request.cookies.set(name, value),
    delete: (name: string) => void request.cookies.delete(name),
  };
}

export async function headers() {
  return { get: (name: string) => request.headers.get(name.toLowerCase()) ?? null, has: (name: string) => request.headers.has(name.toLowerCase()) };
}
