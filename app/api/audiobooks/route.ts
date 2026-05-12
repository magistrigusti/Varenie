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

type LibrivoxReader = {
  display_name?: string;
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
  readers?: LibrivoxReader[];
};

type GutendexPerson = {
  name?: string;
};

type GutendexBook = {
  id: number;
  title?: string;
  authors?: GutendexPerson[];
  subjects?: string[];
  bookshelves?: string[];
  languages?: string[];
  media_type?: string;
  formats?: Record<string, string>;
  summaries?: string[];
  download_count?: number;
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
  provider: "LibriVox" | "Gutendex";
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

const LANGUAGE_CONFIG = {
  en: {
    gutendex: "en",
    librivox: "English"
  },
  ru: {
    gutendex: "ru",
    librivox: "Russian"
  }
} as const;

type LibraryLanguage = keyof typeof LANGUAGE_CONFIG;

function safeQuery(value: string): string {
  return value
    .replace(/[^\p{L}\p{N}\s'".:-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

function safeLanguage(value: string | null): LibraryLanguage {
  return value === "en" ? "en" : "ru";
}

function compactText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactList(values: unknown, limit = 8): string[] {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  return list.map(compactText).filter(Boolean).slice(0, limit);
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
    reader: compactText(section.reader) || compactList(section.readers?.map((reader) => reader.display_name), 2).join(", ") || undefined
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

function pickAudioUrl(formats: Record<string, string> | undefined): string | undefined {
  if (!formats) {
    return undefined;
  }

  const entries = Object.entries(formats).filter(([, url]) => !url.endsWith(".zip"));
  const preferredTypes = ["audio/mpeg", "audio/mp4", "audio/ogg"];

  for (const type of preferredTypes) {
    const match = entries.find(([format]) => format.startsWith(type));
    if (match?.[1]) {
      return match[1];
    }
  }

  return entries.find(([format]) => format.startsWith("audio/"))?.[1];
}

function pickAudioZip(formats: Record<string, string> | undefined): string | undefined {
  if (!formats) {
    return undefined;
  }

  return Object.entries(formats).find(([format, url]) => format === "application/octet-stream" && url.endsWith(".zip"))?.[1];
}

function normalizeGutendexAudio(book: GutendexBook, language: LibraryLanguage): AudioBook | null {
  if (!book.id || !book.title || compactText(book.media_type).toLowerCase() !== "sound") {
    return null;
  }

  const listenUrl = pickAudioUrl(book.formats);
  if (!listenUrl) {
    return null;
  }

  const title = compactText(book.title);
  return {
    id: `gutendex-audio-${book.id}`,
    provider: "Gutendex",
    title,
    authors: compactList(book.authors?.map((author) => author.name), 4),
    description: compactText(book.summaries?.[0]) || undefined,
    language: LANGUAGE_CONFIG[language].librivox,
    genres: compactList([...(book.subjects ?? []), ...(book.bookshelves ?? [])], 8),
    cover: compactText(book.formats?.["image/jpeg"]) || compactText(book.formats?.["image/png"]) || undefined,
    sourceUrl: `https://www.gutenberg.org/ebooks/${book.id}`,
    zipUrl: pickAudioZip(book.formats),
    tracks: [
      {
        id: `gutendex-audio-${book.id}-track`,
        title,
        listenUrl
      }
    ]
  };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);

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

async function fetchLibriVox(
  query: string,
  genre: string,
  page: number,
  language: LibraryLanguage
): Promise<AudioBook[]> {
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
    return (payload.books ?? [])
      .map(normalizeBook)
      .filter((book): book is AudioBook => Boolean(book))
      .filter((book) => book.language === LANGUAGE_CONFIG[language].librivox);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGutendexAudio(
  query: string,
  genre: string,
  page: number,
  language: LibraryLanguage
): Promise<AudioBook[]> {
  const load = async (topic: string): Promise<AudioBook[]> => {
    const params = new URLSearchParams({
      languages: LANGUAGE_CONFIG[language].gutendex,
      mime_type: "audio/",
      sort: "popular",
      page: String(page)
    });

    if (query) {
      params.set("search", query);
    }

    if (topic) {
      params.set("topic", topic);
    }

    const payload = await fetchJson<{ results?: GutendexBook[] }>(`https://gutendex.com/books?${params}`);
    return (payload?.results ?? [])
      .map((book) => normalizeGutendexAudio(book, language))
      .filter((book): book is AudioBook => Boolean(book));
  };

  const items = await load(genre);
  if (items.length || query || !genre || language !== "ru") {
    return items;
  }

  return load("");
}

function dedupeAudiobooks(books: AudioBook[]): AudioBook[] {
  const seen = new Set<string>();
  const deduped: AudioBook[] = [];

  for (const book of books) {
    const key = `${book.title.toLowerCase()}-${book.authors[0]?.toLowerCase() ?? ""}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(book);
  }

  return deduped.slice(0, 36);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = safeQuery(url.searchParams.get("q") ?? "");
  const genre = safeQuery(url.searchParams.get("genre") ?? "");
  const language = safeLanguage(url.searchParams.get("language"));
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);

  const responses = await Promise.allSettled([
    fetchLibriVox(query, genre, page, language),
    fetchGutendexAudio(query, genre, page, language)
  ]);
  const items = responses.flatMap((response) => (response.status === "fulfilled" ? response.value : []));

  return NextResponse.json(
    {
      items: dedupeAudiobooks(items),
      query,
      genre,
      language,
      providers: ["LibriVox", "Gutendex"],
      partial: responses.some((response) => response.status === "rejected")
    },
    { headers: CACHE_HEADERS }
  );
}
