const sourceParameter = "code";

/** Reads shared source from the URL fragment without sending it to a server. */
export function readSharedSource(url: URL): string | undefined {
  const parameters = new URLSearchParams(url.hash.slice(1));
  return parameters.get(sourceParameter) ?? undefined;
}

/** Produces a static-host-friendly URL whose fragment carries the complete source. */
export function shareUrl(url: URL, source: string): URL {
  const shared = new URL(url);
  shared.hash = new URLSearchParams({ [sourceParameter]: source }).toString();
  return shared;
}
