import type { PlaygroundFormatOptions, PlaygroundInlayHint } from "./protocol";

/**
 * The playground's settings, the ones its `Settings…` window lists: which inlay
 * hints the editor shows, whether the run's input box is on the page, and the
 * four formatting options. Each starts off and stays off until the dev turns it
 * on, as the extension's own settings do.
 */
export interface PlaygroundSettings {
  /** `hexagon.inlayHints.types` in the extension. */
  readonly typeHints: boolean;
  /** `hexagon.inlayHints.colours` in the extension. */
  readonly colourHints: boolean;
  /** `hexagon.inlayHints.regexGroups` in the extension. */
  readonly regexGroupHints: boolean;
  /** The input box under the editor, the run's standard input (`spec/program-io.md` §6). */
  readonly inputBox: boolean;
  /** `hexagon.format.maximumLineLength` in the extension: a number, or `undefined` for Unlimited. */
  readonly maximumLineLength: number | undefined;
  /** `hexagon.format.collapseExtraSpaces` in the extension. */
  readonly collapseExtraSpaces: boolean;
  /** `hexagon.format.leaveTrailingCommasAsWritten` in the extension. */
  readonly leaveTrailingCommasAsWritten: boolean;
  /** `hexagon.format.applyWidthLimits` in the extension. */
  readonly applyWidthLimits: boolean;
}

/** The settings that are on or off, each a checkbox in the window. */
export type ToggleKey = Exclude<keyof PlaygroundSettings, "maximumLineLength">;

export const defaultPlaygroundSettings: PlaygroundSettings = {
  typeHints: false,
  colourHints: false,
  regexGroupHints: false,
  inputBox: false,
  maximumLineLength: undefined,
  collapseExtraSpaces: false,
  leaveTrailingCommasAsWritten: false,
  applyWidthLimits: false,
};

export const settingsStorageKey = "hexagon.playground.settings";

/** One row of the `Settings…` window: a checkbox, or, for the line length, a number box. */
export interface SettingRow {
  readonly key: keyof PlaygroundSettings;
  /** The heading the row sits under. */
  readonly group: "Inlay hints" | "Running" | "Formatting";
  readonly label: string;
  readonly description: string;
}

/** The window's rows, in order; the hints' words are the extension's own. */
export const settingRows: readonly SettingRow[] = [
  {
    key: "typeHints",
    group: "Inlay hints",
    label: "Types",
    description:
      "Show the types inference gives the places a type could be written: a parameter, a function's result, a `let` with no written type. Shown only: a hint is never written into the file.",
  },
  {
    key: "colourHints",
    group: "Inlay hints",
    label: "Colours",
    description:
      "Show a function's colour in words, such as \"impure; may fail\", at the end of its header's line. A header has no place to write it.",
  },
  {
    key: "regexGroupHints",
    group: "Inlay hints",
    label: "Regex group numbers",
    description:
      "Show each capturing group's number, the one `Regex.group` reads it by, at its `(` in a pattern handed to `Regex.compile` as a literal.",
  },
  {
    key: "inputBox",
    group: "Running",
    label: "Input box",
    description:
      "Show a box under the editor whose text a run reads as its standard input, with `Stdio.readText` or `Stdio.readTextLossy`. While it is hidden, a run reads no input.",
  },
  {
    key: "maximumLineLength",
    group: "Formatting",
    label: "Maximum line length",
    description:
      "The longest a line of code may be before Format Document and Format Selection break it, in characters (Unicode code points). Leave it empty for Unlimited, under which no line is ever broken. A string or a comment is never broken, and a trailing comment does not count.",
  },
  {
    key: "collapseExtraSpaces",
    group: "Formatting",
    label: "Collapse extra spaces",
    description:
      "Make every gap where Hexagon's layout calls for one space exactly one space when formatting. Off, a wider gap the author wrote is kept, so code aligned in columns keeps its alignment.",
  },
  {
    key: "leaveTrailingCommasAsWritten",
    group: "Formatting",
    label: "Leave trailing commas as written",
    description:
      "Add no trailing commas when formatting. Off, Format Document and Format Selection add a comma after the last item of every list whose closing bracket begins its line. Either way, a comma already written is kept.",
  },
  {
    key: "applyWidthLimits",
    group: "Formatting",
    label: "Apply width limits",
    description:
      "Also spread a construct written on one line that is wider than its width limit when formatting, though its line fits: a conditional, a loop, a chain, a call's arguments, a record, a record or union declaration or a lambda over 60, a match arm or an `and`/`or` over 80, and an `else if` chain or a nested conditional however short. Formatting never joins lines, so a construct already spread stays spread.",
  },
];

/** A line length as the window or storage gives it: a whole number of at least one, else Unlimited. */
export function lineLengthOf(value: unknown): number | undefined {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number >= 1 ? number : undefined;
}

/**
 * Reads stored settings. A missing or unreadable value, and any entry that is
 * not a boolean, keeps its default, so a setting added later starts off too.
 */
export function parseSettings(stored: string | null | undefined): PlaygroundSettings {
  let read: unknown;
  try {
    read = stored === null || stored === undefined ? undefined : JSON.parse(stored);
  } catch {
    read = undefined;
  }
  const entry = (key: keyof PlaygroundSettings): unknown =>
    typeof read === "object" && read !== null ? (read as Record<string, unknown>)[key] : undefined;
  const flag = (key: ToggleKey): boolean => {
    const value = entry(key);
    return typeof value === "boolean" ? value : defaultPlaygroundSettings[key];
  };
  return {
    typeHints: flag("typeHints"),
    colourHints: flag("colourHints"),
    regexGroupHints: flag("regexGroupHints"),
    inputBox: flag("inputBox"),
    maximumLineLength: lineLengthOf(entry("maximumLineLength")),
    collapseExtraSpaces: flag("collapseExtraSpaces"),
    leaveTrailingCommasAsWritten: flag("leaveTrailingCommasAsWritten"),
    applyWidthLimits: flag("applyWidthLimits"),
  };
}

export function serializeSettings(settings: PlaygroundSettings): string {
  return JSON.stringify(settings);
}

/** Whether the settings show a hint of this kind. */
export function hintShown(kind: PlaygroundInlayHint["kind"], settings: PlaygroundSettings): boolean {
  switch (kind) {
    case "type":
      return settings.typeHints;
    case "colour":
      return settings.colourHints;
    case "regexGroup":
      return settings.regexGroupHints;
  }
}

/** Whether the settings show a hint of any kind, so that hints are worth asking for. */
export function anyHintShown(settings: PlaygroundSettings): boolean {
  return settings.typeHints || settings.colourHints || settings.regexGroupHints;
}

/**
 * Whether the input box is on the page: where the settings show it, and on a
 * page opened from a shared link that carries input, so that the run reads
 * what its author's did.
 */
export function inputBoxShown(settings: PlaygroundSettings, sharedInput: string | undefined): boolean {
  return settings.inputBox || (sharedInput !== undefined && sharedInput !== "");
}

/**
 * Where the page's settings stand: the stored ones, and a shared link's input
 * for as long as it keeps the box on the page.
 */
export interface SettingsState {
  readonly settings: PlaygroundSettings;
  /** The input the page's link carries, until the dev turns the box on or off. */
  readonly sharedInput: string | undefined;
}

/** Whether a setting's row is ticked: the input box's says whether the box is on the page. */
export function settingOn(state: SettingsState, key: ToggleKey): boolean {
  return key === "inputBox" ? inputBoxShown(state.settings, state.sharedInput) : state.settings[key];
}

/**
 * The state after the dev turns a setting on or off. Turning the box on or off
 * ends a shared link's hold on it, so the dev's choice is the one that stands.
 */
export function withSetting(state: SettingsState, key: ToggleKey, on: boolean): SettingsState {
  return {
    settings: { ...state.settings, [key]: on },
    sharedInput: key === "inputBox" ? undefined : state.sharedInput,
  };
}

/** The formatting options the settings give (Canonical Layout §3). */
export function formatOptions(settings: PlaygroundSettings): PlaygroundFormatOptions {
  return {
    maximumLineLength: settings.maximumLineLength,
    collapseExtraSpaces: settings.collapseExtraSpaces,
    leaveTrailingCommasAsWritten: settings.leaveTrailingCommasAsWritten,
    applyWidthLimits: settings.applyWidthLimits,
  };
}

/** A run's standard input: the box's text while the box is on the page, else none. */
export function runInput(state: SettingsState, boxText: string): string {
  return settingOn(state, "inputBox") ? boxText : "";
}

/**
 * The inlay hints the settings show, of those `ask` gives. While they show none,
 * `ask` is never called, so the compiler is not asked for hints no one sees.
 */
export async function shownHints<Hint extends { readonly kind: PlaygroundInlayHint["kind"] }>(
  settings: PlaygroundSettings,
  ask: () => Promise<readonly Hint[]>,
): Promise<Hint[]> {
  if (!anyHintShown(settings)) return [];
  return (await ask()).filter(({ kind }) => hintShown(kind, settings));
}

/** Whether a point lies within a box, edges included, as a click on a window's border is a click on the window. */
export function pointWithin(
  x: number,
  y: number,
  box: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number },
): boolean {
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}
