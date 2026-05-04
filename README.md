# deepseek-mcp

DeepSeek V4 как «джун» для Claude Desktop и Codex Desktop. Пишете план →
делегируете шаги → DeepSeek пишет код, а вы только проверяете.

Распространяется одним файлом `.mcpb` (222 КБ), внутри которого
самосодержащий MCP-сервер + skill-инструкция + конфиги для обоих
клиентов. Стримит вывод в реальном времени через MCP progress
notifications — видно, что агент в моменте делает.

## Что внутри

**MCP-инструменты:**

| Tool                  | Модель                       | Когда звать                                                                |
|-----------------------|------------------------------|----------------------------------------------------------------------------|
| `deepseek_explore`    | `deepseek-v4-flash`          | Найти файлы, понять структуру папки, быстрый обзор.                        |
| `deepseek_implement`  | `deepseek-v4-pro` + thinking | Реализовать шаг плана, рефакторинг, тесты, нетривиальный баг.              |
| `deepseek_review`     | `deepseek-v4-pro` + thinking | Критическое ревью кода: баги, безопасность, edge cases.                    |
| `deepseek_ask`        | любая (по выбору)            | Универсальный fallback.                                                    |

**Skill (`deepseek-junior`):** короткая инструкция агенту — когда стоит
делегировать, а когда не стоит. Codex подхватывает её автоматически из
`skills/`. Для Claude Desktop тот же текст доступен как slash-команда
`/deepseek_junior` (через MCP prompt).

**Streaming:** сервер вызывает DeepSeek API в режиме `stream:true`,
парсит SSE-чанки и каждые ~250 мс шлёт `notifications/progress` с
последними сгенерированными словами. В Claude Desktop / Codex Desktop
видно строки вида:

```
💭 DeepSeek thinking (340 tok): …let me verify the auth flow first
✍️ DeepSeek writing (612 tok): …app.use('/api', rateLimiter); next()
```

---

## Установка для пользователей

### Claude Desktop — один клик

1. Скачайте `deepseek-mcp.mcpb` из релизов (или соберите сами — см. ниже).
2. В Claude Desktop: **Settings → Extensions → Advanced settings →
   Install Extension…** → выберите файл.
3. Claude спросит ваш ключ DeepSeek. Введите — он сохранится зашифрованным
   в Keychain (macOS) / Credential Manager (Windows).
4. Готово. Спросите Claude «какие deepseek-инструменты у тебя есть?» — он
   увидит четыре.

### Codex Desktop

У Codex нет однофайловой установки, но всё ставится из той же папки,
которая лежит внутри `.mcpb`. Два пути:

**Способ A — установка из распакованной папки.** Переименуйте
`deepseek-mcp.mcpb` → `deepseek-mcp.zip`, распакуйте в любую стабильную
папку (`~/tools/deepseek-mcp/`), затем:

```bash
codex plugin install ~/tools/deepseek-mcp
```

Или через UI: **Plugins → Install from path → Select folder…**

После установки откройте **Settings → MCP**, найдите `deepseek` и впишите
свой `DEEPSEEK_API_KEY` в env (плагины Codex пока не имеют
single-click-конфига для секретов — придётся положить в config.toml
вручную):

```toml
# ~/.codex/config.toml
[mcp_servers.deepseek.env]
DEEPSEEK_API_KEY = "ваш_ключ"
```

**Способ B — установка прямо из GitHub-репо** (если выложили туда):

```bash
codex plugin install https://github.com/<user>/deepseek-mcp
```

Codex потянет репозиторий и поставит как plugin. Дальше так же — ключ в
`config.toml`.

### TUI / IDE-клиенты (для тех кто на ты с терминалом)

`.mcpb` для них не нужен — достаточно собранного `server/index.js` из
репозитория.

**Claude Code:**
```bash
claude mcp add --transport stdio --env DEEPSEEK_API_KEY=... \
  deepseek -- node /путь/к/deepseek-mcp/server/index.js
```

**Codex CLI:**
```bash
codex mcp add deepseek --env DEEPSEEK_API_KEY=... \
  -- node /путь/к/deepseek-mcp/server/index.js
```

**Cursor / Windsurf / любой MCP-клиент:** тот же JSON-конфиг что у Claude
Desktop — `mcpServers.deepseek` с command `node` и args `["…/server/index.js"]`.

---

## Сборка из исходников (для разработчиков)

Нужен Node.js 20+.

```bash
git clone <repo>
cd deepseek-mcp
npm install
npm run release    # = typecheck + bundle + validate manifest + pack
ls dist/           # → deepseek-mcp.mcpb готов к раздаче
```

Команды по отдельности:
- `npm run typecheck` — проверка типов через `tsc --noEmit`
- `npm run build` — esbuild собирает `src/index.ts` → `server/index.js`
  (один self-contained файл, ~1.1 МБ)
- `npm run validate` — валидация `manifest.json` против MCPB schema
- `npm run pack` — упаковка в `dist/deepseek-mcp.mcpb`

`server/index.js` коммитится в репо — чтобы Codex-пользователи могли
установить плагин из GitHub без ручной сборки.

---

## Структура репозитория

```
deepseek-mcp/
├── manifest.json              # Claude .mcpb manifest (v0.2)
├── .codex-plugin/
│   └── plugin.json            # Codex plugin manifest
├── .mcp.json                  # Codex MCP server config
├── skills/
│   └── deepseek-junior/
│       └── SKILL.md           # Skill инструкция (для Codex и MCP-prompt)
├── src/
│   └── index.ts               # TypeScript исходник
├── server/
│   └── index.js               # esbuild-бандл (committed)
├── scripts/
│   └── build.mjs              # esbuild-скрипт
├── package.json
├── tsconfig.json
├── .mcpbignore                # что не класть в .mcpb (node_modules, src, …)
└── dist/
    └── deepseek-mcp.mcpb      # релизный артефакт
```

В `.mcpb`-архив попадают только нужные для рантайма файлы: `manifest.json`,
`.codex-plugin/`, `.mcp.json`, `skills/`, `server/index.js`,
`package.json`. Исходники и dev-скрипты исключаются через `.mcpbignore`.

---

## Переменные окружения

| Переменная                | По умолчанию                | Назначение                                              |
|---------------------------|-----------------------------|---------------------------------------------------------|
| `DEEPSEEK_API_KEY`        | —                           | **Обязательно.** Ключ DeepSeek.                         |
| `DEEPSEEK_BASE_URL`       | `https://api.deepseek.com`  | Прокси / совместимый endpoint (например, локальный vLLM). |
| `DEEPSEEK_FAST_MODEL`     | `deepseek-v4-flash`         | Модель для `deepseek_explore` и режима `flash`.         |
| `DEEPSEEK_PRO_MODEL`      | `deepseek-v4-pro`           | Модель для `deepseek_implement` / `deepseek_review`.    |
| `DEEPSEEK_TIMEOUT_MS`     | `300000` (5 мин)            | Таймаут одного запроса.                                 |
| `DEEPSEEK_PROGRESS_MS`    | `250`                       | Интервал отправки прогресс-нотификаций (мс).            |
| `DEEPSEEK_LOG_FILE`       | `./deepseek_mcp.log`        | Куда писать лог.                                        |
| `DEEPSEEK_LOG_ENABLED`    | `true`                      | `false` чтобы выключить логирование.                    |

В Claude Desktop первые четыре подставляются из `user_config` (форма
ввода появляется при установке `.mcpb`). В Codex/CLI — задаются в
`env` MCP-конфига вручную.

---

## Скилл — что внутри

`skills/deepseek-junior/SKILL.md` содержит правила поведения для
агента-«головы»:

- Когда делегировать (multi-step plan, scan, pre-commit review).
- Когда **не** делегировать (мелкие задачи, нужна история разговора).
- Как формулировать инструкции (DeepSeek не видит контекст разговора).
- Cost shape (Flash дешёвый и быстрый, Pro+thinking дороже но качественнее).

Codex подхватывает SKILL.md автоматически — описание попадает в
prompt при старте сессии, агент решает использовать ли скилл по контексту
задачи. Claude Desktop не имеет нативного skill-механизма, поэтому тот
же текст экспонируется как MCP-prompt: пользователь набирает
`/deepseek_junior` в чате — текст инструкции инжектится в контекст
разговора, после чего Claude знает как пользоваться сервером.

---

## Безопасность

- Все четыре tool читают только те файлы, пути к которым агент
  передал явно. Никаких автономных обходов FS.
- `walkTree` пропускает `node_modules`, `.git`, `dist`, `__pycache__`
  и подобные шумные папки, плюс скрытые файлы.
- Ключ API хранится в env процесса MCP-сервера (в Claude Desktop —
  зашифрован в OS keychain через MCPB `sensitive: true`). В лог
  пишется только статус, время и количество токенов — не сам запрос
  и не ключ.
- Файлы из `deepseek_implement` уезжают на серверa DeepSeek — учитывайте
  для NDA / закрытого кода. Полная локальность достигается через
  `DEEPSEEK_BASE_URL`, направленный на свой vLLM/sglang с открытыми
  весами DeepSeek.

---

## Как агент это будет использовать (типичный сценарий)

1. **Вы:** «прокачай эту фичу: добавь rate-limiting на /api/login».
2. **Claude/Codex:** строит план, читает 1–2 ключевых файла сам.
3. **→ `deepseek_explore`** — «найди все места, где обрабатывается
   /api/login и где middleware подключаются к роутеру».
   *Видите в реальном времени: «💭 DeepSeek thinking (120 tok)…»*
4. **→ `deepseek_implement`** — «реализуй middleware на 10 req/min,
   используя express-rate-limit», передаёт нужные файлы.
   *«✍️ DeepSeek writing (530 tok): …app.use('/api', rateLimiter)»*
5. DeepSeek возвращает код + список действий (поставить deps,
   запустить тесты).
6. **Claude/Codex** применяет изменения нативными edit-tool'ами,
   опционально **→ `deepseek_review`** перед коммитом.

Главное — основной агент остаётся «головой», DeepSeek работает руками.
