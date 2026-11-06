const sourceParameter = "code";
const inputParameter = "input";

/** Reads shared source from the URL fragment without sending it to a server. */
export function readSharedSource(url: URL): string | undefined {
  const parameters = new URLSearchParams(url.hash.slice(1));
  return parameters.get(sourceParameter) ?? undefined;
}

/**
 * Reads the shared input box's text, for a link that shares source. Such a link
 * without input shares an empty box; a link that shares no source shares no
 * input either, and the box keeps what the browser stored.
 */
export function readSharedInput(url: URL): string | undefined {
  const parameters = new URLSearchParams(url.hash.slice(1));
  if (!parameters.has(sourceParameter)) return undefined;
  return parameters.get(inputParameter) ?? "";
}

/**
 * Produces a static-host-friendly URL whose fragment carries the complete
 * source, and the input box's text when there is any.
 */
export function shareUrl(url: URL, source: string, input = ""): URL {
  const shared = new URL(url);
  const parameters = new URLSearchParams({ [sourceParameter]: source });
  if (input !== "") parameters.set(inputParameter, input);
  shared.hash = parameters.toString();
  return shared;
}
