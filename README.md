# 🧠 DeepSeek Junior

> **DeepSeek V4 как «джун» для Claude Desktop и Codex Desktop.**
> Вы пишете план — агент делегирует шаги — DeepSeek пишет код, а вы только проверяете.

<p align="center">
  <a href="https://github.com/netherguy4/deepseek-junior/releases"><img alt="Release" src="https://img.shields.io/github/v/release/netherguy4/deepseek-junior?style=flat-square"></a>
  <a href="https://github.com/netherguy4/deepseek-junior/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
  <img alt="Node" src="https://img.shields.io/badge/node-20%2B-brightgreen?style=flat-square">
  <img alt="MCP" src="https://img.shields.io/badge/protocol-MCP-orange?style=flat-square">
</p>

Распространяется двумя файлами:

- 📦 **`.mcpb`** — для Claude Desktop (один клик, встроенный конфиг секретов).
- 🗜️ **`.zip`** — для Codex Desktop (`plugin install` из папки или GitHub).

Внутри — самосодержащий MCP-сервер + skill-инструкция + конфиги для обоих клиентов. Стримит вывод в реальном времени через MCP progress notifications — видно, что агент в моменте делает.

---

## ✨ Что внутри

### 🔧 MCP-инструменты

| Tool                 | Модель                       | Когда звать                                                   |
| -------------------- | ---------------------------- | ------------------------------------------------------------- |
| `deepseek_explore`   | `deepseek-v4-flash`          | Найти файлы, понять структуру папки, быстрый обзор.           |
| `deepseek_implement` | `deepseek-v4-pro` + thinking | Реализовать шаг плана, рефакторинг, тесты, нетривиальный баг. |
| `deepseek_review`    | `deepseek-v4-pro` + thinking | Критическое ревью кода: баги, безопасность, edge cases.       |
| `deepseek_ask`       | любая (по выбору)            | Универсальный fallback.                                       |

### 🎯 Skill `deepseek-junior`

Короткая инструкция агенту-«голове» — **когда стоит делегировать, а когда не стоит**, и как готовить контекст так, чтобы DeepSeek не промахнулся. Codex подхватывает её автоматически из `skills/`. В Claude Desktop тот же текст доступен как slash-команда `/deepseek_junior` (через MCP prompt).

### 📡 Streaming

Сервер вызывает DeepSeek API в режиме `stream:true`, парсит SSE-чанки и каждые ~250 мс шлёт `notifications/progress` с последними сгенерированными словами:

```
💭 DeepSeek thinking (340 tok): …let me verify the auth flow first
✍️ DeepSeek writing  (612 tok): …app.use('/api', rateLimiter); next()
```

---

## 🚀 Установка

### Claude Desktop — один клик

1. Скачайте `deepseek-mcp.mcpb` со страницы [Releases](https://github.com/netherguy4/deepseek-junior/releases).
2. **Settings → Extensions → Advanced settings → Install Extension…** → выберите файл.
3. Claude спросит ваш ключ DeepSeek. Введите — он сохранится зашифрованным в Keychain (macOS) / Credential Manager (Windows).
4. Готово. Спросите Claude: _«какие deepseek-инструменты у тебя есть?»_ — он увидит четыре.

### Codex Desktop

**Способ A — установка из ZIP.** Скачайте `deepseek-mcp.zip` из релизов, распакуйте в стабильную папку (`~/tools/deepseek-mcp/`):

```bash
codex plugin install ~/tools/deepseek-mcp
```

Или через UI: **Plugins → Install from path → Select folder…**

Дальше пропишите ключ (плагины Codex пока не имеют single-click-конфига для секретов):

```toml
# ~/.codex/config.toml
[mcp_servers.deepseek.env]
DEEPSEEK_API_KEY = "ваш_ключ"
```

**Способ B — установка прямо из GitHub-репо:**

```bash
codex plugin install https://github.com/netherguy4/deepseek-junior
```

### TUI / IDE-клиенты

`.mcpb` для них не нужен — склонируйте репо и соберите `server/index.js` (см. [Сборка из исходников](#-сборка-из-исходников)).

<details>
<summary><b>Claude Code</b></summary>

```bash
claude mcp add --transport stdio --env DEEPSEEK_API_KEY=... \
  deepseek -- node /путь/к/deepseek-mcp/server/index.js
```

</details>

<details>
<summary><b>Codex CLI</b></summary>

```bash
codex mcp add deepseek --env DEEPSEEK_API_KEY=... \
  -- node /путь/к/deepseek-mcp/server/index.js
```

</details>

<details>
<summary><b>Cursor / Windsurf / любой MCP-клиент</b></summary>

Тот же JSON-конфиг, что у Claude Desktop — `mcpServers.deepseek` с `command: "node"` и `args: ["…/server/index.js"]`.

</details>

---

## 🛠️ Сборка из исходников

Нужен Node.js 20+.

```bash
git clone https://github.com/netherguy4/deepseek-junior
cd deepseek-junior
npm install
npm run release    # typecheck + bundle + validate manifest + pack
ls dist/           # → deepseek-mcp.mcpb + deepseek-mcp.zip
```

<details>
<summary>Команды по отдельности</summary>

| Команда             | Что делает                                                                   |
| ------------------- | ---------------------------------------------------------------------------- |
| `npm run typecheck` | проверка типов через `tsc --noEmit`                                          |
| `npm run build`     | esbuild собирает `src/index.ts` → `server/index.js` (~1.1 МБ self-contained) |
| `npm run validate`  | валидация `manifest.json` против MCPB schema                                 |
| `npm run pack:mcpb` | упаковка в `dist/deepseek-mcp.mcpb` (Claude Desktop)                         |
| `npm run pack:zip`  | копия в `dist/deepseek-mcp.zip` (Codex Desktop)                              |
| `npm run pack`      | обе упаковки разом                                                           |

`server/index.js` генерируется при сборке и **не** коммитится. Установка из GitHub работает через готовые артефакты в релизах.

</details>

---

## 📁 Структура репозитория

```
deepseek-junior/
├── manifest.json              # Claude .mcpb manifest (v0.2)
├── plugin.json                # Codex plugin manifest
├── SKILL.md                   # Skill-инструкция (для Codex и MCP-prompt)
├── src/
│   └── index.ts               # TypeScript исходник
├── server/
│   └── index.js               # esbuild-бандл (генерируется)
├── scripts/
│   ├── build.mjs              # esbuild-скрипт
│   ├── pack-zip.mjs           # упаковка zip
│   └── sync-version.mjs       # синхронизация версий
├── package.json
├── tsconfig.json
└── dist/
    ├── deepseek-mcp.mcpb      # релизный артефакт (Claude Desktop)
    └── deepseek-mcp.zip       # релизный артефакт (Codex Desktop)
```

В `.mcpb` попадают только нужные для рантайма файлы: `manifest.json`, `plugin.json`, `SKILL.md`, `server/index.js`, `package.json`. Исходники и dev-скрипты исключаются через `.mcpbignore`.

---

## ⚙️ Переменные окружения

| Переменная             | По умолчанию               | Назначение                                                |
| ---------------------- | -------------------------- | --------------------------------------------------------- |
| `DEEPSEEK_API_KEY`     | —                          | **Обязательно.** Ключ DeepSeek.                           |
| `DEEPSEEK_BASE_URL`    | `https://api.deepseek.com` | Прокси / совместимый endpoint (например, локальный vLLM). |
| `DEEPSEEK_FAST_MODEL`  | `deepseek-v4-flash`        | Модель для `deepseek_explore` и режима `flash`.           |
| `DEEPSEEK_PRO_MODEL`   | `deepseek-v4-pro`          | Модель для `deepseek_implement` / `deepseek_review`.      |
| `DEEPSEEK_TIMEOUT_MS`  | `300000` (5 мин)           | Таймаут одного запроса.                                   |
| `DEEPSEEK_PROGRESS_MS` | `250`                      | Интервал отправки прогресс-нотификаций (мс).              |
| `DEEPSEEK_LOG_FILE`    | `./deepseek_mcp.log`       | Куда писать лог.                                          |
| `DEEPSEEK_LOG_ENABLED` | `true`                     | `false` — выключить логирование.                          |

В Claude Desktop первые четыре подставляются из `user_config` (форма ввода появляется при установке `.mcpb`). В Codex/CLI — задаются вручную.

---

## 🧭 Как работает скилл

`SKILL.md` содержит правила для агента-«головы»:

- Когда делегировать (multi-step plan, scan, pre-commit review).
- Когда **не** делегировать (мелкие задачи, нужен контекст разговора).
- **Как формулировать инструкции** — DeepSeek не видит истории чата, поэтому всё нужное (включая project-specific конвенции и подключаемые скиллы) должно ехать в промпте.
- Cost shape (Flash дёшев и быстр, Pro+thinking дороже но качественнее).

Codex подхватывает SKILL.md автоматически. Claude Desktop не имеет нативного skill-механизма, поэтому тот же текст экспонируется как MCP-prompt: пользователь набирает `/deepseek_junior` в чате — текст инструкции инжектится в контекст разговора.

---

## 🔒 Безопасность

- Все четыре tool читают только те файлы, пути к которым агент передал явно. Никаких автономных обходов FS.
- `walkTree` пропускает `node_modules`, `.git`, `dist`, `__pycache__` и подобные шумные папки, плюс скрытые файлы.
- Ключ API хранится в env процесса MCP-сервера (в Claude Desktop — зашифрован в OS keychain через MCPB `sensitive: true`). В лог пишется только статус, время и количество токенов — не сам запрос и не ключ.
- Файлы из `deepseek_implement` уезжают на серверы DeepSeek — учитывайте это для NDA / закрытого кода. Полная локальность достигается через `DEEPSEEK_BASE_URL`, направленный на свой vLLM/sglang с открытыми весами DeepSeek.

---

## 💡 Типичный сценарий

1. **Вы:** «прокачай эту фичу: добавь rate-limiting на `/api/login`».
2. **Claude / Codex:** строит план, читает 1–2 ключевых файла сам.
3. **→ `deepseek_explore`** — _«найди все места, где обрабатывается `/api/login` и где middleware подключаются к роутеру»_.
   _В реальном времени видно: `💭 DeepSeek thinking (120 tok)…`_
4. **→ `deepseek_implement`** — _«реализуй middleware на 10 req/min, используя express-rate-limit»_, передаёт нужные файлы.
   _`✍️ DeepSeek writing (530 tok): …app.use('/api', rateLimiter)`_
5. DeepSeek возвращает код + список действий (поставить deps, запустить тесты).
6. **Claude / Codex** применяет изменения нативными edit-tool'ами, опционально **→ `deepseek_review`** перед коммитом.

> 🎯 Главное — **основной агент остаётся «головой», DeepSeek работает руками**.

---

## 📜 Лицензия

[MIT](LICENSE)
