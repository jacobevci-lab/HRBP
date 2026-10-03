/** Shared by sign-in, OIDC and the browser. Never allow navigation to another origin. */
export function sanitizeReturnTo(value: unknown, fallback = "/"): string {
  function safe(input: unknown): string | null {
    if (typeof input !== "string" || !input.startsWith("/") || input.startsWith("//") || input.length > 2048) return null;
    if (/[\\\u0000-\u0020\u007f]/.test(input)) return null;
    // Reject encoded path separators/control characters, including double encoding.
    // The query/fragment may legitimately contain an encoded return path.
    let path = input.split(/[?#]/, 1)[0];
    for (let i = 0; i < 5; i += 1) {
      if (path.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(path)) return null;
      let decoded: string;
      try { decoded = decodeURIComponent(path); } catch { return null; }
      if (decoded === path) break;
      path = decoded;
      if (i === 4) return null;
    }
    try {
      const url = new URL(input, "https://hrbp.invalid");
      if (url.origin !== "https://hrbp.invalid" || url.username || url.password) return null;
      return `${url.pathname}${url.search}${url.hash}`;
    } catch { return null; }
  }
  return safe(value) ?? safe(fallback) ?? "/";
}
