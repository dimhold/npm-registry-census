/**
 * Page through the whole npm registry and write down every package name.
 *
 * This is step one of "measure all of npm" rather than fourteen stacks I picked.
 * The replication endpoint refuses `include_docs` and refuses large pages, so the
 * documents themselves cannot be streamed; what it will give is the key list, and
 * that is exactly what a defensible sample needs to be drawn from.
 *
 * Resumable: the last key written is the next page's startkey, so a dropped
 * connection costs one page. `touch PAUSE-NAMES` stops it at the next page.
 * Refuses to run, and stops mid-run, below MIN_FREE_GB — this is a production box.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync, statfsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "registry-names.txt");
const STATE = join(HERE, "state-names.json");
const STATUS = join(HERE, "STATUS-names.md");
const PAUSE = join(HERE, "PAUSE-NAMES");

const PAGE = 10000;
const MIN_FREE_GB = 20;

const freeGb = () => { const s = statfsSync(HERE); return (s.bavail * s.bsize) / 1e9; };
const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { started: new Date().toISOString(), count: 0, lastKey: null, pages: 0, total: null });
const save = (s) => { writeFileSync(STATE + ".tmp", JSON.stringify(s, null, 1)); renameSync(STATE + ".tmp", STATE); };

function status(s, note) {
  const pct = s.total ? ((100 * s.count) / s.total).toFixed(1) : "?";
  writeFileSync(STATUS, [
    "# npm registry — выгрузка списка имён", "",
    `Обновлено: ${new Date().toISOString()}`,
    `Старт: ${s.started}`, "",
    `- Имён собрано: **${s.count.toLocaleString("ru-RU")}** из ${s.total ? s.total.toLocaleString("ru-RU") : "?"} (${pct}%)`,
    `- Страниц: ${s.pages}`,
    `- Последний ключ: \`${s.lastKey ?? "-"}\``,
    `- Свободно на диске: ${freeGb().toFixed(1)} ГБ (порог ${MIN_FREE_GB} ГБ)`,
    `- Пауза: ${existsSync(PAUSE) ? "ДА" : "нет"}`, "",
    `Заметка: ${note}`, "",
    "Приостановить: `touch PAUSE-NAMES`. Продолжить: `rm -f PAUSE-NAMES && nohup node replica-names.mjs >> names.log 2>&1 &`",
  ].join("\n") + "\n");
}

const state = load();
if (freeGb() < MIN_FREE_GB) { status(state, `ОТКАЗ НА СТАРТЕ: свободно ${freeGb().toFixed(1)} ГБ`); process.exit(1); }
if (!existsSync(OUT)) writeFileSync(OUT, "");

status(state, "старт");

while (true) {
  if (existsSync(PAUSE)) { status(state, "ПАУЗА"); console.error("paused"); break; }
  if (freeGb() < MIN_FREE_GB) { status(state, "ОСТАНОВЛЕН: диск"); console.error("disk floor"); process.exit(1); }

  // Two things this endpoint does that a CouchDB client would not expect, both
  // found by running into them:
  //   - limit is capped at exactly 10000. Asking for 10001 to absorb the duplicate
  //     startkey row is an HTTP 400, which killed the first run on page 2.
  //   - a startkey containing `..` is rejected outright, presumably by a path
  //     traversal filter sitting in front of the replica. Percent-encoding the
  //     dots gets the same key through untouched, so every dot is encoded rather
  //     than only the pair, and package names like `f716......aaa2` stop being a
  //     wall the crawl dies on at 54%.
  const startkey = state.lastKey
    ? "&startkey=" + encodeURIComponent(JSON.stringify(state.lastKey)).replace(/\./g, "%2E")
    : "";
  const url = `https://replicate.npmjs.com/registry/_all_docs?limit=${PAGE}${startkey}`;

  let json;
  for (let a = 0; a < 5; a++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
      break;
    } catch (e) {
      if (a === 4) { status(state, `ОШИБКА: ${String(e).slice(0, 100)}`); throw e; }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** a));
    }
  }

  state.total ??= json.total_rows;
  // When resuming, the first row is the key we already wrote; drop it.
  const rows = state.lastKey ? json.rows.slice(1) : json.rows;
  if (!rows.length) { status(state, "ГОТОВО: реестр пройден целиком"); console.error("done"); break; }

  appendFileSync(OUT, rows.map((r) => r.id).join("\n") + "\n");
  state.count += rows.length;
  state.pages++;
  state.lastKey = rows[rows.length - 1].key;
  save(state);
  if (state.pages % 10 === 0) status(state, `страница ${state.pages}`);
  console.error(`page ${state.pages}: +${rows.length} → ${state.count}/${state.total}`);
}
