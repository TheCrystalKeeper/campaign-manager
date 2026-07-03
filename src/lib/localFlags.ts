/// <summary>Tiny persisted boolean prefs ("1"/"0" in localStorage), shared app-wide.</summary>

export function readLocalFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === "1";
  } catch {
    return fallback;
  }
}

export function writeLocalFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    // preference just won't persist
  }
}
