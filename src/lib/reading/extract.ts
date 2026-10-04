// Fetch a URL and extract readable article text — works on-device, no server.
// Strategy: try r.jina.ai reader (free, no key, returns markdown), fall back
// to raw fetch + HTML tag strip. Never sends the doc anywhere else.

export async function fetchReadableText(rawUrl: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim().startsWith('http') ? rawUrl.trim() : `https://${rawUrl.trim()}`);
  } catch {
    throw new Error('That does not look like a valid URL.');
  }

  // Primary: Jina reader returns clean markdown of the page.
  try {
    const res = await fetch(`https://r.jina.ai/${url.toString()}`, {
      headers: { Accept: 'text/plain' },
    });
    if (res.ok) {
      const text = (await res.text()).trim();
      if (text.length > 80) return text;
    }
  } catch {
    // fall through to direct fetch
  }

  // Fallback: fetch the raw HTML and strip tags.
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Could not fetch that page (HTTP ${res.status}).`);
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < 40) throw new Error('That page did not return readable text.');
  return text;
}

export function titleFromUrl(url: string): string {
  try {
    const u = new URL(url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname.split('/').filter(Boolean).at(-1);
    const slug = path
      ?.replace(/\.[a-z0-9]+$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim();
    return slug ? slug.slice(0, 60) : host;
  } catch {
    return url.slice(0, 60);
  }
}
