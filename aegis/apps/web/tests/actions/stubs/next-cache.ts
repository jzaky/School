export function revalidatePath(): void {}
export function revalidateTag(): void {}
export function unstable_cache<T>(fn: T): T {
  return fn;
}
