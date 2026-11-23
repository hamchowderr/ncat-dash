/**
 * Better Auth answers a redirect as JSON ({ redirect, url }) when the request looks like
 * a script's fetch, and with a real redirect when a browser opens the page. It tells the
 * two apart by `sec-fetch-mode: cors`. Requests reach Convex through this app, and the
 * server's own fetch always sends `sec-fetch-mode: cors`, so a browser opening the
 * sign-in link for an AI agent (/oauth2/authorize) was shown the JSON instead of being
 * sent on. This turns that answer back into a redirect, using the same rule Better Auth
 * uses on the browser's own headers.
 */
export async function asBrowserRedirect(request: Request, response: Response): Promise<Response> {
  const fromScript = request.headers.get("sec-fetch-mode") === "cors";
  const wantsJson = request.headers.get("accept")?.includes("application/json") ?? false;
  if (request.method !== "GET" || fromScript || wantsJson) return response;
  if (response.status !== 200) return response;
  if (!response.headers.get("content-type")?.includes("application/json")) return response;
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (
    !body ||
    typeof body !== "object" ||
    (body as { redirect?: unknown }).redirect !== true ||
    typeof (body as { url?: unknown }).url !== "string"
  ) {
    return response;
  }
  const location = new URL((body as { url: string }).url, request.url).toString();
  const headers = new Headers({ location });
  // Keep any cookies Better Auth set with the answer.
  for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}
