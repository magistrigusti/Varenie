import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GutendexPerson = {
  name?: string;
  birth_year?: number | null;
  death_year?: number | null;
};

type GutendexBook = {
  id: number;
  title?: string;
  authors?: GutendexPerson[];
  subjects?: string[];
  bookshelves?: string[];
  languages?: string[];
  formats?: Record<string, string>;
  summaries?: string[];
  download_count?: number;
};

type OpenLibraryDoc = {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  cover_i?: number;
  edition_count?: number;
  subject?: string[];
  language?: string[];
  has_fulltext?: boolean;
  public_scan_b?: boolean;
  ia?: string[];
  ebook_access?: string;
};

type ArchiveDoc = {
  identifier?: string;
  title?: string;
  creator?: string | string[];
  date?: string;
  subject?: string | string[];
  downloads?: number;
};

type UnifiedBook = {
  id: string;
  provider: "Gutendex" | "Open Library" | "Internet Archive";
  title: string;
  authors: string[];
  year?: number | string;
  cover?: string;
  subjects: string[];
  summary?: string;
  languages: string[];
  downloads?: number;
  sourceUrl: string;
  readUrl?: string;
  readable: boolean;
};

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=900, stale-while-revalidate=86400"
};

const DEFAULT_QUERY = "classic literature";

function compactText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactList(values: unknown, limit = 8): string[] {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  return list.map(compactText).filter(Boolean).slice(0, limit);
}

function safeQuery(value: string): string {
  return value
    .replace(/[^\p{L}\p{N}\s'".:-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function archivePhrase(value: string): string {
  return `"${safeQuery(value).replace(/"/g, "").slice(0, 80)}"`;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "VarenieBooks/0.1"
      },
      signal: controller.signal,
      next: { revalidate: 900 }
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function pickTextUrl(formats: Record<string, string> | undefined): string | undefined {
  if (!formats) {
    return undefined;
  }

  const entries = Object.entries(formats);
  const plain = entries.find(([type, url]) => type.startsWith("text/plain") && !url.endsWith(".zip"));
  const html = entries.find(([type, url]) => type.startsWith("text/html") && !url.endsWith(".zip"));
  return plain?.[1] ?? html?.[1];
}

function pickCover(formats: Record<string, string> | undefined): string | undefined {
  if (!formats) {
    return undefined;
  }

  return formats["image/jpeg"] || formats["image/png"];
}

function normalizeGutendex(book: GutendexBook): UnifiedBook {
  const textUrl = pickTextUrl(book.formats);
  const readUrl = textUrl ? `/api/read?source=gutendex&url=${encodeURIComponent(textUrl)}` : undefined;

  return {
    id: `gutendex-${book.id}`,
    provider: "Gutendex",
    title: compactText(book.title) || "Untitled",
    authors: compactList(book.authors?.map((author) => author.name)),
    cover: pickCover(book.formats),
    subjects: compactList([...(book.subjects ?? []), ...(book.bookshelves ?? [])], 8),
    summary: compactText(book.summaries?.[0]),
    languages: compactList(book.languages, 4),
    downloads: book.download_count,
    sourceUrl: `https://www.gutenberg.org/ebooks/${book.id}`,
    readUrl,
    readable: Boolean(readUrl)
  };
}

function normalizeOpenLibrary(doc: OpenLibraryDoc): UnifiedBook | null {
  if (!doc.key || !doc.title) {
    return null;
  }

  const iaId = doc.ia?.find(Boolean);
  const textUrl = iaId ? `https://archive.org/download/${iaId}/${iaId}_djvu.txt` : undefined;
  const sourceUrl = `https://openlibrary.org${doc.key}`;
  const cover = doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : undefined;

  return {
    id: `openlibrary-${doc.key.replaceAll("/", "-")}`,
    provider: "Open Library",
    title: compactText(doc.title),
    authors: compactList(doc.author_name),
    year: doc.first_publish_year,
    cover,
    subjects: compactList(doc.subject, 8),
    summary: doc.edition_count ? `${doc.edition_count} editions in Open Library` : undefined,
    languages: compactList(doc.language, 4),
    sourceUrl,
    readUrl: textUrl ? `/api/read?source=archive&url=${encodeURIComponent(textUrl)}` : undefined,
    readable: Boolean(textUrl && (doc.public_scan_b || doc.has_fulltext || doc.ebook_access === "public"))
  };
}

function normalizeArchive(doc: ArchiveDoc): UnifiedBook | null {
  if (!doc.identifier || !doc.title) {
    return null;
  }

  const identifier = compactText(doc.identifier);
  const textUrl = `https://archive.org/download/${identifier}/${identifier}_djvu.txt`;
  const year = compactText(doc.date).match(/\d{4}/)?.[0];

  return {
    id: `archive-${identifier}`,
    provider: "Internet Archive",
    title: compactText(doc.title),
    authors: compactList(doc.creator, 4),
    year,
    cover: `https://archive.org/services/img/${identifier}`,
    subjects: compactList(doc.subject, 8),
    languages: [],
    downloads: doc.downloads,
    sourceUrl: `https://archive.org/details/${identifier}`,
    readUrl: `/api/read?source=archive&url=${encodeURIComponent(textUrl)}`,
    readable: true
  };
}

async function getGutendexBooks(query: string, genre: string, page: number): Promise<UnifiedBook[]> {
  const params = new URLSearchParams({
    languages: "en,ru",
    mime_type: "text/",
    sort: "popular",
    page: String(page)
  });

  if (query) {
    params.set("search", query);
  }

  if (genre) {
    params.set("topic", genre);
  }

  const payload = await fetchJson<{ results?: GutendexBook[] }>(`https://gutendex.com/books?${params}`);
  return (payload?.results ?? []).map(normalizeGutendex);
}

async function getOpenLibraryBooks(query: string, genre: string, page: number): Promise<UnifiedBook[]> {
  const params = new URLSearchParams({
    q: query || genre || DEFAULT_QUERY,
    limit: "16",
    page: String(page),
    fields:
      "key,title,author_name,first_publish_year,cover_i,edition_count,subject,language,has_fulltext,public_scan_b,ia,ebook_access"
  });

  if (genre) {
    params.set("subject", genre);
  }

  const payload = await fetchJson<{ docs?: OpenLibraryDoc[] }>(`https://openlibrary.org/search.json?${params}`);
  return (payload?.docs ?? []).map(normalizeOpenLibrary).filter(Boolean) as UnifiedBook[];
}

async function getArchiveBooks(query: string, genre: string, page: number): Promise<UnifiedBook[]> {
  const params = new URLSearchParams({
    output: "json",
    rows: "14",
    page: String(page),
    sort: "downloads desc"
  });

  const q = query
    ? `title:(${archivePhrase(query)}) AND mediatype:texts`
    : `subject:${archivePhrase(genre || "classic literature")} AND mediatype:texts`;

  params.set("q", q);
  ["identifier", "title", "creator", "date", "subject", "downloads"].forEach((field) => {
    params.append("fl[]", field);
  });

  const payload = await fetchJson<{ response?: { docs?: ArchiveDoc[] } }>(
    `https://archive.org/advancedsearch.php?${params}`
  );

  return (payload?.response?.docs ?? []).map(normalizeArchive).filter(Boolean) as UnifiedBook[];
}

function dedupeBooks(books: UnifiedBook[]): UnifiedBook[] {
  const seen = new Set<string>();
  const deduped: UnifiedBook[] = [];

  for (const book of books) {
    const key = `${book.title.toLowerCase()}-${book.authors[0]?.toLowerCase() ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(book);
  }

  return deduped.slice(0, 42);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = safeQuery(url.searchParams.get("q") ?? "");
  const genre = safeQuery(url.searchParams.get("genre") ?? "");
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);

  const responses = await Promise.allSettled([
    getGutendexBooks(query, genre, page),
    getOpenLibraryBooks(query, genre, page),
    getArchiveBooks(query, genre, page)
  ]);

  const books = responses.flatMap((response) => (response.status === "fulfilled" ? response.value : []));

  return NextResponse.json(
    {
      items: dedupeBooks(books),
      query,
      genre,
      providers: ["Gutendex", "Open Library", "Internet Archive"],
      partial: responses.some((response) => response.status === "rejected")
    },
    { headers: CACHE_HEADERS }
  );
}
