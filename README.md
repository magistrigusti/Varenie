# Varenie Books

Первый раздел метавселенной Varenie: книги для чтения и аудиокниги.

## Что внутри

- Next App Router, готовый к деплою на Vercel.
- `/api/books` агрегирует Gutendex, Open Library и Internet Archive.
- `/api/read` безопасно проксирует публичные текстовые файлы Gutenberg / Internet Archive.
- `/api/audiobooks` подключает LibriVox и отдает главы для встроенного плеера.
- Три общие темы: `Солнце`, `Обычный`, `Тьма`.
- Режим чтения с переключением портретного/ландшафтного полотна.
- Telegram WebApp hooks: `ready`, `expand`, синхронизация цветов темы.

## Локально

```bash
npm install
npm run dev
```

## Vercel

Vercel сам определит Next-проект. Команда сборки:

```bash
npm run build
```

Переменные окружения не требуются: используются только публичные открытые API.
