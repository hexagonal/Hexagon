/** The part of VS Code's configuration API this decision needs. */
export interface InspectableConfiguration {
  inspect(section: string): { readonly globalValue?: unknown } | undefined;
}

/**
 * Project roots the user explicitly trusts for standard-library development.
 *
 * Read the installation-wide value directly. `get` would merge in workspace,
 * folder, and language values, allowing a checkout to grant privilege to
 * itself even though the setting's schema declares machine scope.
 */
export function trustedStandardLibraryProjects(
  configuration: InspectableConfiguration,
): readonly string[] {
  const value = configuration.inspect(
    "languageServer.trustedStandardLibraryProjects",
  )?.globalValue;
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}
