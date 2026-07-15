export type ThemePreference = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

export const themeStorageKey = "hexagon.playground.theme";

/** Defaults missing or obsolete stored settings to the live system theme. */
export function parseThemePreference(value: string | null): ThemePreference {
  return value === "dark" || value === "light" || value === "system"
    ? value
    : "system";
}

/** Resolves the user preference without coupling storage to presentation. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  return preference === "system"
    ? systemPrefersDark
      ? "dark"
      : "light"
    : preference;
}
