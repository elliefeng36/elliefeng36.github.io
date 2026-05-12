/** After leaving a team, we block URL-based auto-join so `/chat/:id` cannot re-add you. Cleared when you join again from the home form. */
const STORAGE_KEY = "chapstick-skip-autojoin-chats";

function readIds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function isAutojoinDenied(channelId) {
  if (!channelId) return false;
  return readIds().includes(channelId);
}

export function addAutojoinDeny(channelId) {
  if (!channelId) return;
  const s = new Set(readIds());
  s.add(channelId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...s]));
}

export function removeAutojoinDeny(channelId) {
  if (!channelId) return;
  const ids = readIds().filter((id) => id !== channelId);
  if (ids.length === 0) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}
