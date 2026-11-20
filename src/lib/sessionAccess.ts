export const GUEST_SESSION_STORAGE_KEY = 'ctg_guest_session_active';
export const LEGACY_WELCOME_STORAGE_KEY = 'ctg_welcome_accepted';

export function clearLegacyGuestPersistence(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_WELCOME_STORAGE_KEY);
  } catch {
    // Ignore storage access errors
  }
}

export function readGuestSessionActive(): boolean {
  if (typeof window === 'undefined') return false;
  clearLegacyGuestPersistence();
  try {
    return window.sessionStorage.getItem(GUEST_SESSION_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeGuestSessionActive(active: boolean): void {
  if (typeof window === 'undefined') return;
  clearLegacyGuestPersistence();
  try {
    if (active) {
      window.sessionStorage.setItem(GUEST_SESSION_STORAGE_KEY, '1');
    } else {
      window.sessionStorage.removeItem(GUEST_SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage access errors
  }
}
