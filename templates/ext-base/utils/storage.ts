export async function getStored<T>(key: string, fallback: T): Promise<T> {
  const value = await browser.storage.local.get(key);
  return (value[key] as T | undefined) ?? fallback;
}

export async function setStored<T>(key: string, value: T): Promise<void> {
  await browser.storage.local.set({ [key]: value });
}
