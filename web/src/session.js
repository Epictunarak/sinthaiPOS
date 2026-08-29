const KEY = 'sinthaipos_staff';

export function getSession() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function setSession(staff) {
  localStorage.setItem(KEY, JSON.stringify(staff));
}

export function clearSession() {
  localStorage.removeItem(KEY);
}
