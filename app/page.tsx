"use client";

import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Circle,
  ExternalLink,
  Headphones,
  Loader2,
  Moon,
  Pause,
  Play,
  RotateCw,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  Sun,
  Volume2
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Mode = "books" | "audio";
type ThemeMode = "sun" | "day" | "dark";
type ReaderOrientation = "portrait" | "landscape";
type LibraryLanguage = "ru" | "en";

type BookItem = {
  id: string;
  provider: string;
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
  provider: string;
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

type TelegramWebApp = {
  ready?: () => void;
  expand?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

const BOOK_GENRES = [
  { label: "Классика", apiQuery: "" },
  { label: "Фантастика", apiQuery: "science fiction" },
  { label: "Фэнтези", apiQuery: "fantasy" },
  { label: "Философия", apiQuery: "philosophy" },
  { label: "История", apiQuery: "history" },
  { label: "Наука", apiQuery: "science" },
  { label: "Мифы", apiQuery: "mythology" },
  { label: "Поэзия", apiQuery: "poetry" },
  { label: "Детектив", apiQuery: "detective" },
  { label: "Приключения", apiQuery: "adventure" }
];

const AUDIO_GENRES = [
  { label: "Все", apiQuery: "" },
  { label: "Фантастика", apiQuery: "Science fiction" },
  { label: "Приключения", apiQuery: "Adventure" },
  { label: "Детектив", apiQuery: "Detective fiction" },
  { label: "Фэнтези", apiQuery: "Fantasy fiction" },
  { label: "История", apiQuery: "Historical fiction" },
  { label: "Поэзия", apiQuery: "Poetry" },
  { label: "Философия", apiQuery: "Philosophy" },
  { label: "Драма", apiQuery: "Drama" },
  { label: "Дети", apiQuery: "Children's fiction" }
];

const THEMES: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: "sun", label: "Солнце", icon: Sun },
  { value: "day", label: "Обычный", icon: Circle },
  { value: "dark", label: "Тьма", icon: Moon }
];

const LIBRARY_LANGUAGES: Array<{ value: LibraryLanguage; label: string }> = [
  { value: "ru", label: "Русский" },
  { value: "en", label: "English" }
];

const themeChrome: Record<ThemeMode, { header: string; background: string }> = {
  sun: { header: "#fff0a8", background: "#fff7cf" },
  day: { header: "#f4efe5", background: "#f7f4ed" },
  dark: { header: "#111614", background: "#0d1110" }
};

function cleanAuthorList(authors: string[] | undefined): string {
  return authors?.length ? authors.join(", ") : "Unknown author";
}

function compact(value: string | undefined, fallback = ""): string {
  return value?.replace(/\s+/g, " ").trim() || fallback;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function Cover({
  src,
  title,
  className = ""
}: {
  src?: string;
  title: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div className={`cover-fallback ${className}`} aria-label={title}>
        <span>{title.slice(0, 1).toUpperCase()}</span>
      </div>
    );
  }

  return <img className={`cover-image ${className}`} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("books");
  const [theme, setTheme] = useState<ThemeMode>("day");
  const [language, setLanguage] = useState<LibraryLanguage>("ru");

  const [bookSearch, setBookSearch] = useState("");
  const [bookGenre, setBookGenre] = useState(BOOK_GENRES[0].apiQuery);
  const [books, setBooks] = useState<BookItem[]>([]);
  const [booksLoading, setBooksLoading] = useState(false);
  const [booksError, setBooksError] = useState("");
  const [selectedBook, setSelectedBook] = useState<BookItem | null>(null);
  const [readerOrientation, setReaderOrientation] = useState<ReaderOrientation>("portrait");
  const [reader, setReader] = useState({
    loading: false,
    text: "",
    error: "",
    truncated: false
  });

  const [audioSearch, setAudioSearch] = useState("");
  const [audioGenre, setAudioGenre] = useState(AUDIO_GENRES[0].apiQuery);
  const [audiobooks, setAudiobooks] = useState<AudioBook[]>([]);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState("");
  const [selectedAudio, setSelectedAudio] = useState<AudioBook | null>(null);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.82);
  const [shouldAutoPlay, setShouldAutoPlay] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const readerRef = useRef<HTMLDivElement | null>(null);

  const activeGenres = mode === "books" ? BOOK_GENRES : AUDIO_GENRES;
  const activeGenre = mode === "books" ? bookGenre : audioGenre;
  const activeSearch = mode === "books" ? bookSearch : audioSearch;
  const currentTrack = selectedAudio?.tracks[currentTrackIndex];

  const selectedBookSubjects = useMemo(() => selectedBook?.subjects.slice(0, 4) ?? [], [selectedBook]);
  const visibleAudioDescription = useMemo(() => {
    if (!selectedAudio?.description) {
      return "";
    }
    return selectedAudio.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }, [selectedAudio]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedMode = params.get("mode");
    const requestedTheme = params.get("theme") as ThemeMode | null;

    if (requestedMode === "books" || requestedMode === "audio") {
      setMode(requestedMode);
    }

    if (requestedTheme === "sun" || requestedTheme === "day" || requestedTheme === "dark") {
      setTheme(requestedTheme);
      return;
    }

    const stored = localStorage.getItem("varenie-theme") as ThemeMode | null;
    if (stored === "sun" || stored === "day" || stored === "dark") {
      setTheme(stored);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("varenie-theme", theme);

    const webApp = window.Telegram?.WebApp;
    webApp?.setHeaderColor?.(themeChrome[theme].header);
    webApp?.setBackgroundColor?.(themeChrome[theme].background);
  }, [theme]);

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    webApp?.ready?.();
    webApp?.expand?.();
  }, []);

  const loadBooks = useCallback(
    async (signal: AbortSignal) => {
      setBooksLoading(true);
      setBooksError("");

      const params = new URLSearchParams();
      if (bookSearch.trim()) {
        params.set("q", bookSearch.trim());
      }
    if (bookGenre) {
      params.set("genre", bookGenre);
    }
      params.set("language", language);

      try {
        const response = await fetch(`/api/books?${params}`, { signal });
        if (!response.ok) {
          throw new Error("books failed");
        }

        const payload = (await response.json()) as { items?: BookItem[] };
        const items = payload.items ?? [];
        setBooks(items);
        setSelectedBook((current) => (current && items.some((item) => item.id === current.id) ? current : items[0] ?? null));
        setReader({ loading: false, text: "", error: "", truncated: false });
      } catch (error) {
        if (!signal.aborted) {
          setBooksError("Книги сейчас не ответили.");
        }
      } finally {
        if (!signal.aborted) {
          setBooksLoading(false);
        }
      }
    },
    [bookGenre, bookSearch, language]
  );

  const loadAudio = useCallback(
    async (signal: AbortSignal) => {
      setAudioLoading(true);
      setAudioError("");

      const params = new URLSearchParams();
      if (audioSearch.trim()) {
        params.set("q", audioSearch.trim());
      }
    if (audioGenre) {
      params.set("genre", audioGenre);
    }
      params.set("language", language);

      try {
        const response = await fetch(`/api/audiobooks?${params}`, { signal });
        if (!response.ok) {
          throw new Error("audio failed");
        }

        const payload = (await response.json()) as { items?: AudioBook[] };
        const items = payload.items ?? [];
        setAudiobooks(items);
        setSelectedAudio((current) => (current && items.some((item) => item.id === current.id) ? current : items[0] ?? null));
      } catch (error) {
        if (!signal.aborted) {
          setAudioError("Аудиокниги сейчас не ответили.");
        }
      } finally {
        if (!signal.aborted) {
          setAudioLoading(false);
        }
      }
    },
    [audioGenre, audioSearch, language]
  );

  useEffect(() => {
    if (mode !== "books") {
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      void loadBooks(controller.signal);
    }, 260);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [loadBooks, mode]);

  useEffect(() => {
    if (mode !== "audio") {
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      void loadAudio(controller.signal);
    }, 260);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [loadAudio, mode]);

  useEffect(() => {
    setCurrentTrackIndex(0);
    setProgress(0);
    setDuration(0);
    setIsPlaying(false);
  }, [selectedAudio?.id]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) {
      return;
    }

    audio.load();
    setProgress(0);
    setDuration(currentTrack.durationSeconds ?? 0);

    if (shouldAutoPlay) {
      const play = async () => {
        try {
          await audio.play();
          setIsPlaying(true);
        } catch {
          setIsPlaying(false);
        } finally {
          setShouldAutoPlay(false);
        }
      };

      void play();
    }
  }, [currentTrack, shouldAutoPlay]);

  async function openReader(book: BookItem) {
    setSelectedBook(book);
    setReader({ loading: true, text: "", error: "", truncated: false });

    if (!book.readUrl) {
      setReader({ loading: false, text: "", error: "У этой записи доступен только каталог.", truncated: false });
      return;
    }

    try {
      const response = await fetch(book.readUrl);
      const payload = (await response.json()) as { text?: string; error?: string; truncated?: boolean };
      if (!response.ok || !payload.text) {
        throw new Error(payload.error ?? "reader failed");
      }

      setReader({
        loading: false,
        text: payload.text,
        error: "",
        truncated: Boolean(payload.truncated)
      });

      requestAnimationFrame(() => {
        readerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      });
    } catch {
      setReader({ loading: false, text: "", error: "Текст не открылся из этого источника.", truncated: false });
    }
  }

  async function toggleOrientation() {
    const next: ReaderOrientation = readerOrientation === "portrait" ? "landscape" : "portrait";
    setReaderOrientation(next);

    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }

      const lockMode: OrientationLockType = next === "landscape" ? "landscape" : "portrait";
      await screen.orientation?.lock?.(lockMode);
    } catch {
      // Browsers and Telegram shells may deny orientation lock; the reader layout still rotates in-app.
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "books") {
      const controller = new AbortController();
      void loadBooks(controller.signal);
    } else {
      const controller = new AbortController();
      void loadAudio(controller.signal);
    }
  }

  function selectGenre(apiQuery: string) {
    if (mode === "books") {
      setBookGenre(apiQuery);
    } else {
      setAudioGenre(apiQuery);
    }
  }

  function chooseAudio(book: AudioBook, autoplay = false) {
    setSelectedAudio(book);
    setCurrentTrackIndex(0);
    setShouldAutoPlay(autoplay);
  }

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !currentTrack) {
      return;
    }

    if (audio.paused) {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }

  function changeTrack(nextIndex: number) {
    if (!selectedAudio?.tracks.length) {
      return;
    }

    const bounded = Math.min(Math.max(nextIndex, 0), selectedAudio.tracks.length - 1);
    setCurrentTrackIndex(bounded);
    setShouldAutoPlay(true);
  }

  function seekTo(value: number) {
    if (!audioRef.current) {
      return;
    }

    audioRef.current.currentTime = value;
    setProgress(value);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">V</div>
          <div>
            <span>Varenie</span>
            <strong>Книги</strong>
          </div>
        </div>

        <div className="library-controls">
          <nav className="mode-tabs" aria-label="Раздел">
            <button className={mode === "books" ? "active" : ""} type="button" onClick={() => setMode("books")}>
              <BookOpen size={17} />
              Книги
            </button>
            <button className={mode === "audio" ? "active" : ""} type="button" onClick={() => setMode("audio")}>
              <Headphones size={17} />
              Аудио
            </button>
          </nav>

          <div className="language-tabs" aria-label="Язык каталога">
            {LIBRARY_LANGUAGES.map((item) => (
              <button
                key={item.value}
                className={language === item.value ? "active" : ""}
                type="button"
                onClick={() => setLanguage(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="theme-segment" aria-label="Настройки темы">
          {THEMES.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.value}
                className={theme === item.value ? "active" : ""}
                type="button"
                title={item.label}
                onClick={() => setTheme(item.value)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      <section className="workspace">
        <aside className="side-rail">
          <form className="search-card" onSubmit={submitSearch}>
            <label htmlFor="library-search">{mode === "books" ? "Поиск книг" : "Поиск аудио"}</label>
            <div className="search-input">
              <Search size={18} />
              <input
                id="library-search"
                value={activeSearch}
                placeholder={mode === "books" ? "Автор, книга, тема" : "Название или автор"}
                onChange={(event) => (mode === "books" ? setBookSearch(event.target.value) : setAudioSearch(event.target.value))}
              />
              <button type="submit" aria-label="Найти" title="Найти">
                <ChevronRight size={18} />
              </button>
            </div>
          </form>

          <div className="genre-list" aria-label="Жанры">
            {activeGenres.map((genre) => (
              <button
                key={genre.apiQuery}
                className={activeGenre === genre.apiQuery ? "active" : ""}
                type="button"
                onClick={() => selectGenre(genre.apiQuery)}
              >
                {genre.label}
              </button>
            ))}
          </div>

          <div className="settings-card">
            <div className="rail-title">
              <Settings size={16} />
              Настройки
            </div>
            <div className="settings-row">
              {THEMES.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.value}
                    className={theme === item.value ? "active" : ""}
                    type="button"
                    onClick={() => setTheme(item.value)}
                    title={item.label}
                  >
                    <Icon size={16} />
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {mode === "books" ? (
          <section className="main-grid books-view">
            <section className="results-pane">
              <div className="section-head">
                <div>
                  <h1>Книги</h1>
                  <p>{books.length ? `${books.length} найдено` : "Открытые каталоги"}</p>
                </div>
                {booksLoading ? <Loader2 className="spin" size={21} /> : null}
              </div>

              {booksError ? <div className="state-line">{booksError}</div> : null}

              <div className="book-grid" aria-busy={booksLoading}>
                {books.map((book) => (
                  <article
                    key={book.id}
                    className={`book-card ${selectedBook?.id === book.id ? "selected" : ""}`}
                    onClick={() => setSelectedBook(book)}
                  >
                    <Cover src={book.cover} title={book.title} />
                    <div className="book-copy">
                      <div className="book-source">{book.provider}</div>
                      <h2>{book.title}</h2>
                      <p>{cleanAuthorList(book.authors)}</p>
                      <div className="book-tags">
                        {book.year ? <span>{book.year}</span> : null}
                        {book.languages.slice(0, 2).map((language) => (
                          <span key={language}>{language.toUpperCase()}</span>
                        ))}
                      </div>
                    </div>
                    <div className="card-actions">
                      <button
                        className="primary-action"
                        type="button"
                        disabled={!book.readable}
                        onClick={(event) => {
                          event.stopPropagation();
                          void openReader(book);
                        }}
                      >
                        <BookOpen size={16} />
                        Читать
                      </button>
                      <a href={book.sourceUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                        <ExternalLink size={15} />
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <aside className={`reader-panel ${readerOrientation}`}>
              {selectedBook ? (
                <>
                  <div className="reader-toolbar">
                    <div>
                      <span>{selectedBook.provider}</span>
                      <h2>{selectedBook.title}</h2>
                      <p>{cleanAuthorList(selectedBook.authors)}</p>
                    </div>
                    <button type="button" onClick={toggleOrientation} title="Повернуть" aria-label="Повернуть экран чтения">
                      <RotateCw size={18} />
                    </button>
                  </div>

                  <div className="reader-meta">
                    {selectedBookSubjects.map((subject) => (
                      <span key={subject}>{subject}</span>
                    ))}
                  </div>

                  <div ref={readerRef} className="reader-surface">
                    {reader.loading ? (
                      <div className="reader-state">
                        <Loader2 className="spin" size={22} />
                        Загрузка текста
                      </div>
                    ) : reader.text ? (
                      <>
                        <pre>{reader.text}</pre>
                        {reader.truncated ? <p className="reader-note">Продолжение доступно в источнике.</p> : null}
                      </>
                    ) : (
                      <div className="reader-empty">
                        <Cover src={selectedBook.cover} title={selectedBook.title} className="reader-cover" />
                        <p>{reader.error || compact(selectedBook.summary, "Выбери книгу и открой текст.")}</p>
                        <button
                          className="primary-action"
                          type="button"
                          disabled={!selectedBook.readable}
                          onClick={() => void openReader(selectedBook)}
                        >
                          <BookOpen size={16} />
                          Открыть текст
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="reader-empty standalone">Книги появятся здесь.</div>
              )}
            </aside>
          </section>
        ) : (
          <section className="main-grid audio-view">
            <section className="audio-browser">
              <div className="section-head">
                <div>
                  <h1>Аудио</h1>
                  <p>{audiobooks.length ? `${audiobooks.length} найдено` : "LibriVox каталог"}</p>
                </div>
                {audioLoading ? <Loader2 className="spin" size={21} /> : null}
              </div>

              {audioError ? <div className="state-line">{audioError}</div> : null}

              <div className="audio-list" aria-busy={audioLoading}>
                {audiobooks.map((book) => (
                  <article
                    key={book.id}
                    className={`audio-card ${selectedAudio?.id === book.id ? "selected" : ""}`}
                    onClick={() => chooseAudio(book)}
                  >
                    <Cover src={book.cover} title={book.title} className="audio-cover" />
                    <div>
                      <span>{book.provider}</span>
                      <h2>{book.title}</h2>
                      <p>{cleanAuthorList(book.authors)}</p>
                      <small>{book.totalTime || `${book.tracks.length} глав`}</small>
                    </div>
                    <button
                      type="button"
                      title="Слушать"
                      aria-label="Слушать"
                      onClick={(event) => {
                        event.stopPropagation();
                        chooseAudio(book, true);
                      }}
                    >
                      <Play size={16} />
                    </button>
                  </article>
                ))}
              </div>
            </section>

            <section className="player-panel">
              {selectedAudio ? (
                <>
                  <div className="player-hero">
                    <Cover src={selectedAudio.cover} title={selectedAudio.title} className="player-cover" />
                    <div>
                      <span>{selectedAudio.provider}</span>
                      <h2>{selectedAudio.title}</h2>
                      <p>{cleanAuthorList(selectedAudio.authors)}</p>
                    </div>
                  </div>

                  <audio
                    ref={audioRef}
                    src={currentTrack?.listenUrl}
                    preload="metadata"
                    onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || currentTrack?.durationSeconds || 0)}
                    onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)}
                    onPause={() => setIsPlaying(false)}
                    onPlay={() => setIsPlaying(true)}
                    onEnded={() => {
                      if (selectedAudio.tracks[currentTrackIndex + 1]) {
                        changeTrack(currentTrackIndex + 1);
                      } else {
                        setIsPlaying(false);
                      }
                    }}
                  />

                  <div className="now-playing">
                    <span>Сейчас</span>
                    <strong>{currentTrack?.title ?? "Нет главы"}</strong>
                    {currentTrack?.reader ? <p>{currentTrack.reader}</p> : null}
                  </div>

                  <div className="player-controls">
                    <button type="button" title="Назад" aria-label="Назад" onClick={() => changeTrack(currentTrackIndex - 1)}>
                      <SkipBack size={18} />
                    </button>
                    <button className="play-button" type="button" title="Play" aria-label="Play" onClick={togglePlay}>
                      {isPlaying ? <Pause size={24} /> : <Play size={24} />}
                    </button>
                    <button type="button" title="Вперед" aria-label="Вперед" onClick={() => changeTrack(currentTrackIndex + 1)}>
                      <SkipForward size={18} />
                    </button>
                  </div>

                  <div className="seek-row">
                    <span>{formatTime(progress)}</span>
                    <input
                      type="range"
                      min={0}
                      max={duration || currentTrack?.durationSeconds || 0}
                      step={1}
                      value={Math.min(progress, duration || currentTrack?.durationSeconds || 0)}
                      onChange={(event) => seekTo(Number(event.target.value))}
                    />
                    <span>{formatTime(duration || currentTrack?.durationSeconds || 0)}</span>
                  </div>

                  <div className="volume-row">
                    <Volume2 size={17} />
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume}
                      aria-label="Громкость"
                      onChange={(event) => setVolume(Number(event.target.value))}
                    />
                  </div>

                  <div className="audio-description">
                    <p>{visibleAudioDescription || selectedAudio.genres.join(", ") || "LibriVox"}</p>
                  </div>

                  <div className="track-list">
                    <div className="track-head">
                      <span>Главы</span>
                      <span>{selectedAudio.tracks.length}</span>
                    </div>
                    {selectedAudio.tracks.map((track, index) => (
                      <button
                        key={track.id}
                        className={index === currentTrackIndex ? "active" : ""}
                        type="button"
                        onClick={() => changeTrack(index)}
                      >
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <strong>{track.title}</strong>
                        <em>{track.duration || formatTime(track.durationSeconds ?? 0)}</em>
                      </button>
                    ))}
                  </div>

                  <div className="player-links">
                    {selectedAudio.sourceUrl ? (
                      <a href={selectedAudio.sourceUrl} target="_blank" rel="noreferrer">
                        LibriVox
                        <ExternalLink size={14} />
                      </a>
                    ) : null}
                    {selectedAudio.archiveUrl ? (
                      <a href={selectedAudio.archiveUrl} target="_blank" rel="noreferrer">
                        Archive
                        <ExternalLink size={14} />
                      </a>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="player-empty">
                  <Headphones size={34} />
                  Аудиокниги появятся здесь.
                </div>
              )}
            </section>
          </section>
        )}
      </section>

      <button className="mobile-switch left" type="button" aria-label="Книги" onClick={() => setMode("books")}>
        <ChevronLeft size={18} />
      </button>
    </main>
  );
}
