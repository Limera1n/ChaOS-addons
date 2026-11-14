// New framing: never reuse the older full-loadout portraits.
const STORAGE_KEY = "chaos-pvp-avatars-v3";
export const validAvatarImage = (value) => typeof value === "string" && value.length <= 150000 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(value);

// One render per appearance, shared by all consumers. Keep only small PNGs,
// and serialize WebGL work so a roster never opens dozens of engines at once.
export function createAvatarCache({ generate, storage, maxEntries = 80 }) {
  const images = new Map();
  const pending = new Map();
  let queue = Promise.resolve();
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "[]");
    if (Array.isArray(saved)) for (const entry of saved.slice(-maxEntries)) {
      if (Array.isArray(entry) && typeof entry[0] === "string" && validAvatarImage(entry[1])) images.set(entry[0], entry[1]);
    }
  } catch { /* A disabled or full storage must not prevent avatars from working. */ }
  function persist() {
    try { storage?.setItem(STORAGE_KEY, JSON.stringify([...images])); } catch { /* Keep the memory cache. */ }
  }
  function remember(key, image) {
    if (!validAvatarImage(image)) throw new Error("Portrait invalide.");
    images.set(key, image);
    while (images.size > maxEntries) images.delete(images.keys().next().value);
    persist();
    return image;
  }
  return {
    remember,
    peek: (key) => images.get(key),
    get(key) {
      if (images.has(key)) return Promise.resolve(images.get(key));
      if (pending.has(key)) return pending.get(key);
      const request = queue.then(() => images.get(key) ?? generate(key))
        .then((image) => remember(key, image)).finally(() => pending.delete(key));
      pending.set(key, request);
      queue = request.catch(() => {});
      return request;
    },
  };
}
