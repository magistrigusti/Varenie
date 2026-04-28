import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800"
};

const MAX_CHARS = 700_000;

function isAllowedBookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const isGutenberg = host === "gutenberg.org" || host.endsWith(".gutenberg.org");
    const isArchive = host === "archive.org" || host.endsWith(".archive.org");
    return url.protocol === "https:" && (isGutenberg || isArchive);
  } catch {
    return false;
  }
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const named: Record<string, string> = {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: "\"",
      apos: "'",
      nbsp: " "
    };

    const lower = entity.toLowerCase();
    if (lower in named) {
      return named[lower];
    }

    if (lower.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    }

    if (lower.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    }

    return match;
  });
}

function stripHtml(value: string): string {
  return decodeEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function trimGutenberg(value: string): string {
  const startMatch = value.match(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[\s\S]*?\*\*\*/i);
  const endMatch = value.match(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i);

  let text = value;
  if (startMatch?.index !== undefined) {
    const afterMarker = value.indexOf("\n", startMatch.index + startMatch[0].length);
    text = value.slice(afterMarker > -1 ? afterMarker : startMatch.index + startMatch[0].length);
  }

  if (endMatch?.index !== undefined && endMatch.index > 0) {
    text = text.slice(0, endMatch.index);
  }

  return text;
}

function normalizeText(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

async function fetchText(url: string): Promise<{ text: string; contentType: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/plain,text/html,*/*",
        "User-Agent": "VarenieBooks/0.1"
      },
      signal: controller.signal,
      next: { revalidate: 86400 }
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    return { text, contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const target = url.searchParams.get("url") ?? "";

  if (!target || !isAllowedBookUrl(target)) {
    return NextResponse.json({ error: "Unsupported reading source." }, { status: 400 });
  }

  const payload = await fetchText(target);
  if (!payload) {
    return NextResponse.json({ error: "Text is not available from this source." }, { status: 404 });
  }

  const looksHtml = payload.contentType.includes("text/html") || /<(html|body|p|br)\b/i.test(payload.text.slice(0, 500));
  const stripped = looksHtml ? stripHtml(payload.text) : payload.text;
  const normalized = normalizeText(trimGutenberg(stripped));
  const truncated = normalized.length > MAX_CHARS;

  return NextResponse.json(
    {
      text: truncated ? normalized.slice(0, MAX_CHARS) : normalized,
      sourceUrl: target,
      truncated,
      length: normalized.length
    },
    { headers: CACHE_HEADERS }
  );
}
