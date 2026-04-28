import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LibrivoxAuthor = {
  first_name?: string;
  last_name?: string;
};

type LibrivoxGenre = {
  name?: string;
};

type LibrivoxSection = {
  id?: string | number;
  section_number?: string | number;
  title?: string;
  listen_url?: string;
  url_librivox?: string;
  playtime?: string;
  playtime_secs?: string | number;
  reader?: string;
};

type LibrivoxBook = {
  id?: string | number;
  title?: string;
  description?: string;
  language?: string;
  copyright_year?: string;
  num_sections?: string | number;
  url_zip_file?: string;
  url_librivox?: string;
  url_project?: string;
  url_iarchive?: string;
  totaltime?: string;
  totaltimesecs?: string | number;
  authors?: LibrivoxAuthor[];
  genres?: LibrivoxGenre[];
  sections?: LibrivoxSection[];
  coverart_jpg?: string;
  coverart_thumbnail?: string;
};

type AudioTrack = {
  id: string;
  title: string;
  listenUrl: string;
  duration?: string;
  durationSeconds?: number;
  reader?: string;
};

type AudioBook = {
  id: string;
  provider: "LibriVox";
  title: string;
  authors: string[];
  description?: string;
  language?: string;
  year?: string;
  genres: string[];
  cover?: string;
  sourceUrl?: string;
  archiveUrl?: string;
  zipUrl?: string;
  totalTime?: string;
  totalSeconds?: number;
  tracks: AudioTrack[];
};

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=900, stale-while-revalidate=86400"
};

function safeQuery(value: string): string {
  return value
    .replace(/[^\p{L}\p{N}\s'".:-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function compactText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function numberOrUndefined(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function normalizeAuthor(author: LibrivoxAuthor): string {
  return `${compactText(author.first_name)} ${compactText(author.last_name)}`.trim();
}

function normalizeTrack(section: LibrivoxSection, index: number): AudioTrack | null {
  const listenUrl = compactText(section.listen_url);
  if (!listenUrl) {
    return null;
  }

  const number = compactText(section.section_number) || String(index + 1);
  const playtime = compactText(section.playtime);
  const durationSeconds = numberOrUndefined(section.playtime_secs) ?? (/^\d+$/.test(playtime) ? numberOrUndefined(playtime) : undefined);

  return {
    id: String(section.id ?? `${listenUrl}-${index}`),
    title: compactText(section.title) || `Глава ${number}`,
    listenUrl,
    duration: durationSeconds && /^\d+$/.test(playtime) ? undefined : playtime || undefined,
    durationSeconds,
    reader: compactText(section.reader) || undefined
  };
}

function normalizeBook(book: LibrivoxBook): AudioBook | null {
  if (!book.id || !book.title) {
    return null;
  }

  const tracks = (book.sections ?? []).map(normalizeTrack).filter(Boolean) as AudioTrack[];
  const authors = (book.authors ?? []).map(normalizeAuthor).filter(Boolean);

  return {
    id: `librivox-${book.id}`,
    provider: "LibriVox",
    title: compactText(book.title),
    authors,
    description: compactText(book.description),
    language: compactText(book.language),
    year: compactText(book.copyright_year),
    genres: (book.genres ?? []).map((genre) => compactText(genre.name)).filter(Boolean).slice(0, 8),
    cover: compactText(book.coverart_jpg) || compactText(book.coverart_thumbnail) || undefined,
    sourceUrl: compactText(book.url_librivox) || compactText(book.url_project) || undefined,
    archiveUrl: compactText(book.url_iarchive) || undefined,
    zipUrl: compactText(book.url_zip_file) || undefined,
    totalTime: compactText(book.totaltime) || undefined,
    totalSeconds: numberOrUndefined(book.totaltimesecs),
    tracks
  };
}

async function fetchLibriVox(query: string, genre: string, page: number): Promise<AudioBook[]> {
  const limit = 18;
  const params = new URLSearchParams({
    format: "json",
    extended: "1",
    coverart: "1",
    limit: String(limit),
    offset: String((page - 1) * limit)
  });

  if (query) {
    params.set("title", query);
  }

  if (genre) {
    params.set("genre", genre);
  }

  if (!query && !genre) {
    params.set("genre", "Science fiction");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);

  try {
    const response = await fetch(`https://librivox.org/api/feed/audiobooks/?${params}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "VarenieBooks/0.1"
      },
      signal: controller.signal,
      next: { revalidate: 900 }
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as { books?: LibrivoxBook[] };
    return (payload.books ?? []).map(normalizeBook).filter(Boolean) as AudioBook[];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = safeQuery(url.searchParams.get("q") ?? "");
  const genre = safeQuery(url.searchParams.get("genre") ?? "");
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);

  const items = await fetchLibriVox(query, genre, page);

  return NextResponse.json(
    {
      items,
      query,
      genre,
      providers: ["LibriVox"]
    },
    { headers: CACHE_HEADERS }
  );
}
