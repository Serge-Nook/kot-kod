# Документация разработчика

## Стек

- Electron + electron-vite, React 18, TypeScript, zustand.
- Git — системный `git` CLI (≥ 2.35), запускается в дочерних процессах (`src/main/git/runner.ts`) с `GIT_TERMINAL_PROMPT=0` и собственным askpass-скриптом для передачи токенов.
- Сборка установщиков — electron-builder (AppImage, deb).

## Структура

```
src/shared/      общие типы, контракт API (api.ts), парсеры вывода git, частичные патчи, раскладка графа
src/main/        процесс Electron: окно, IPC, настройки, журналы, хранилище токенов, аккаунты, обновления
src/main/git/    обёртка над git CLI и все Git-операции
src/main/hosting провайдеры хостинга: общий REST-клиент, GitHubProvider, GitVerseProvider (IHostingProvider)
src/preload/     мост window.kotkod (call/on) с contextIsolation
src/renderer/    интерфейс на React: views/, components/, i18n/
resources/       справка, шаблоны .gitignore и лицензий (распаковываются из asar)
tests/           vitest: парсеры, Git-операции на временных репозиториях, полнота локализации
```

## IPC

Рендерер вызывает `api.<ns>.<method>(...)` (`src/renderer/src/lib/api.ts`), что превращается в `ipcRenderer.invoke('api', 'ns.method', args)`. Главный процесс возвращает `{ ok: true, value }` или `{ ok: false, error: { code, message, details } }`. Коды ошибок (`AppError`) переводятся в рендерере через ключи `err.<CODE>`.

## Новый хостинг

Реализуйте `IHostingProvider` (`src/main/hosting/provider.ts`) — проще всего унаследовать `RestProvider` из `rest.ts` и переопределить маппинг ответов. Добавьте провайдера в `providers` и хост в `providerForHost` (`src/shared/remote.ts`). Поддерживаемые функции описываются в `capabilities` — интерфейс скрывает недоступные действия.

## Локализация

Строки лежат в `src/renderer/src/i18n/{ru,en,zh}.json`. Русский — эталон, обязателен на 100 %; при отсутствии перевода используется английский, затем русский. Тест `tests/i18n.test.ts` проверяет, что все ключи из кода и все коды ошибок главного процесса переведены на русский, а плейсхолдеры `{name}` совпадают во всех языках. Новый язык: добавьте `xx.json`, значение в `Language` (`src/shared/types.ts`) и пункт в настройках.

## Команды

```bash
npm ci
npm run dev           # разработка с горячей перезагрузкой
npm run lint
npm run typecheck
npm test
npm run build:linux   # dist/*.AppImage, dist/*.deb
```

## Релиз

1. Обновите версию в `package.json` и `build/ru.nookbat.kotkod.appdata.xml`.
2. Создайте тег `vX.Y.Z` и отправьте его — workflow `release.yml` соберёт AppImage и deb, посчитает SHA-256 и опубликует релиз.
