var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/atomic-file.ts
var atomic_file_exports = {};
__export(atomic_file_exports, {
  writeTextAtomic: () => writeTextAtomic
});
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
async function writeTextAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true, mode: 448 });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text, { encoding: "utf8", mode: 384 });
  await rename(tmp, path);
}
var init_atomic_file = __esm({
  "src/atomic-file.ts"() {
    "use strict";
  }
});

// src/home.ts
import { chmod, cp, readdir, readFile, rm, stat, writeFile as writeFile2 } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
function resolveHome() {
  const fromEnv = process.env.LIFEOS_HOME?.trim();
  return fromEnv === void 0 || fromEnv === "" ? join(homedir(), ".lifeos") : fromEnv;
}
async function pathExists(path) {
  return stat(path).then(() => true, () => false);
}
var init_home = __esm({
  "src/home.ts"() {
    "use strict";
  }
});

// src/logging.ts
var logging_exports = {};
__export(logging_exports, {
  appendFrontendRows: () => appendFrontendRows,
  initLogs: () => initLogs,
  log: () => log,
  logsDir: () => logsDir
});
import { appendFile, mkdir as mkdir3, readdir as readdir3, rm as rm2, writeFile as writeFile5 } from "node:fs/promises";
import { join as join4 } from "node:path";
function logsDir() {
  return join4(resolveHome(), "logs");
}
function localDate(d = /* @__PURE__ */ new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function backendFile() {
  return join4(logsDir(), `backend-${localDate()}.jsonl`);
}
function frontendFile() {
  return join4(logsDir(), `frontend-${localDate()}.jsonl`);
}
async function ensureLogsDir() {
  await mkdir3(logsDir(), { recursive: true, mode: 448 });
  await writeFile5(join4(logsDir(), "AGENTS.md"), LOGS_NOTE, { flag: "wx", mode: 384 }).catch(() => void 0);
  return logsDir();
}
async function initLogs() {
  await ensureLogsDir();
  const cutoffMs = Date.now() - 14 * 24 * 60 * 60 * 1e3;
  for (const entry of await readdir3(logsDir())) {
    const match = /(?:backend|frontend)-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(entry);
    if (match === null) continue;
    const at = (/* @__PURE__ */ new Date(`${match[1]}T23:59:59`)).getTime();
    if (!Number.isNaN(at) && at < cutoffMs) await rm2(join4(logsDir(), entry), { force: true });
  }
}
function sanitize(details) {
  if (details === void 0) return void 0;
  const out = {};
  for (const [key, value] of Object.entries(details)) {
    if (SECRET.test(key)) continue;
    if (typeof value === "string" && value.length > 200) continue;
    out[key] = value;
  }
  return out;
}
async function appendLine(file, row) {
  const previous = chain;
  const work = previous.then(async () => {
    try {
      await mkdir3(logsDir(), { recursive: true, mode: 448 });
    } catch {
      return;
    }
    await appendFile(file, JSON.stringify(row) + "\n", { encoding: "utf8", flag: "a" });
  });
  chain = work;
  return work.catch((err) => {
    console.error("[logs] \u5199\u5931\u8D25\uFF1A", err instanceof Error ? err.message : String(err));
  });
}
async function write(level, module, fn, msg, fields) {
  if (level === "debug" && process.env.LIFEOS_LOG_DEBUG !== "1") return;
  const { sessionId, turnId, agentId, projectId, details, ...rest } = fields ?? {};
  void rest;
  const row = {
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    level,
    module,
    ...fn !== void 0 && fn !== "" ? { fn } : {},
    ...sessionId !== void 0 ? { sessionId } : {},
    ...turnId !== void 0 ? { turnId } : {},
    ...agentId !== void 0 ? { agentId } : {},
    ...projectId !== void 0 ? { projectId } : {},
    msg,
    ...sanitize(details) !== void 0 ? { details: sanitize(details) } : {}
  };
  await ensureLogsDir();
  await appendLine(backendFile(), row);
}
async function appendFrontendRows(rows) {
  let written = 0;
  for (const raw of rows) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = { ts: (/* @__PURE__ */ new Date()).toISOString(), ...raw };
    await appendLine(frontendFile(), row);
    written += 1;
  }
  return written;
}
var LOGS_NOTE, SECRET, chain, log;
var init_logging = __esm({
  "src/logging.ts"() {
    "use strict";
    init_home();
    LOGS_NOTE = `# logs \xB7 \u8FD0\u884C\u65E5\u5FD7

- \u80CC\u666F\uFF1A\u540E\u7AEF\u4E0E\u524D\u7AEF\u7684\u7ED3\u6784\u5316\u8FD0\u884C\u65E5\u5FD7\uFF0C\u7A0B\u5E8F\u6309\u5929\u5199\u5165\uFF0C\u8D85\u8FC7 14 \u5929\u81EA\u52A8\u6EDA\u52A8\u5220\u9664\u3002
- \u5185\u5BB9\uFF1Abackend-<\u65E5\u671F>.jsonl\u3001frontend-<\u65E5\u671F>.jsonl\uFF1B\u53EA\u542B\u4E8B\u5B9E\u4E0E ID\uFF0C\u4E0D\u542B\u6B63\u6587\u4E0E\u51ED\u636E\u3002
- \u4F55\u65F6\u8BFB\uFF1A\u6392\u969C\uFF08\u6309 sessionId / turnId \u67E5\u4E00\u8F6E\u7684\u5B8C\u6574\u8FC7\u7A0B\uFF09\u65F6\u3002
- \u600E\u4E48\u7528\uFF1A\u4E0D\u8981\u624B\u6539\uFF1B\u4E0D\u5165\u5E93\uFF08~/.lifeos/.gitignore \u5DF2\u6392\u9664\uFF09\u3002
`;
    SECRET = /(api[-_]?key|token|password|cookie|authorization|secret)/i;
    chain = Promise.resolve();
    log = {
      error: (module, fn, msg, fields) => write("error", module, fn, msg, fields),
      warn: (module, fn, msg, fields) => write("warn", module, fn, msg, fields),
      info: (module, fn, msg, fields) => write("info", module, fn, msg, fields),
      debug: (module, fn, msg, fields) => write("debug", module, fn, msg, fields)
    };
  }
});

// src/main.ts
import { createAdaptorServer } from "@hono/node-server";

// src/event-socket.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { WebSocketServer } from "ws";

// src/bounded-sink.ts
function createBoundedSink(options) {
  let pending2 = 0;
  let closed = false;
  return {
    offer(event) {
      if (closed) return false;
      const size = JSON.stringify(event).length;
      if (pending2 + size > options.limitBytes) return false;
      pending2 += size;
      options.write(event).then(
        () => {
          pending2 -= size;
        },
        () => {
          closed = true;
          pending2 -= size;
        }
      );
      return true;
    },
    pendingBytes: () => pending2,
    closed: () => closed,
    close() {
      closed = true;
    }
  };
}

// src/events.ts
var TURN_LEVEL = /* @__PURE__ */ new Set(["turn", "done", "error", "agents_changed", "row", "review_open"]);
var isDetailEvent = (type) => !TURN_LEVEL.has(type);
var MAX_WATCHING = 3;
var PRE_READY_LIMIT = 1e4;
var registry = /* @__PURE__ */ new Map();
var seq = 0;
function matchesFocus(focus, event) {
  if (focus === void 0) return false;
  const sessionId = event.sessionId;
  if (focus.agentId === event.agentId && focus.sessionId === sessionId) return true;
  return (focus.watching ?? []).some((entry) => entry.agentId === event.agentId && entry.sessionId === sessionId);
}
function deliver(reg, event) {
  if (isDetailEvent(event.type) && !matchesFocus(reg.sub.focus, event)) return;
  if (reg.sub.offer(event)) return;
  registry.delete(reg.sub.id);
  reg.sub.overflowed();
}
function dispatch(event) {
  for (const reg of Array.from(registry.values())) {
    if (registry.get(reg.sub.id) !== reg) continue;
    if (!reg.ready) {
      reg.buffer.push(event);
      if (reg.buffer.length > PRE_READY_LIMIT) {
        registry.delete(reg.sub.id);
        reg.sub.overflowed();
      }
      continue;
    }
    deliver(reg, event);
  }
}
function subscribeBus(sub) {
  const reg = { sub, ready: false, buffer: [] };
  registry.set(sub.id, reg);
  const baseline = seq;
  return {
    seq: baseline,
    ready() {
      if (registry.get(sub.id) !== reg || reg.ready) return;
      reg.ready = true;
      const pending2 = reg.buffer.splice(0);
      for (const event of pending2) {
        if (registry.get(sub.id) !== reg) break;
        deliver(reg, event);
      }
    },
    close() {
      if (registry.get(sub.id) === reg) registry.delete(sub.id);
    }
  };
}
function setFocusOf(connectionId, focus) {
  const reg = registry.get(connectionId);
  if (reg === void 0) return false;
  reg.sub.focus = focus;
  return true;
}
function isOnSession(agentId, sessionId) {
  for (const reg of registry.values()) {
    const f = reg.sub.focus;
    if (f !== void 0 && f.agentId === agentId && f.sessionId === sessionId) return true;
  }
  return false;
}
function publish(agentId, event) {
  const full = { ...event, agentId, seq: ++seq };
  dispatch(full);
  return full;
}
function broadcast(event) {
  const full = { ...event, seq: ++seq };
  dispatch(full);
  return full;
}
function eventsSeq() {
  return seq;
}

// src/agent-host.ts
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

// src/image-note.ts
var PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
function decodeBase64(value) {
  try {
    return Uint8Array.from(Buffer.from(value, "base64"));
  } catch {
    return void 0;
  }
}
function pngSizeOf(bytes) {
  if (bytes === void 0 || bytes.length < 24) return void 0;
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return void 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : void 0;
}
function encodedBytesOf(base64) {
  return base64.length;
}
function humanBytes(bytes) {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)}MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)}KB`;
  return `${bytes}B`;
}
function formatImageNote(input) {
  const bytes = encodedBytesOf(input.base64);
  const size = pngSizeOf(decodeBase64(input.base64));
  const dimension = size === void 0 ? "" : ` ${size.width}x${size.height}`;
  return `screenshot ${input.path}${dimension} ${humanBytes(bytes)}`;
}
function isImageNoteText(text) {
  return text.startsWith("screenshot ") || text.startsWith("Read image file");
}
function parseImageRefs(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("\u56FE\u7247 ") && !trimmed.startsWith("screenshot ")) continue;
    const rest = trimmed.slice(trimmed.indexOf(" ") + 1).trim();
    if (rest === "") continue;
    const path = rest.split(/\s+/)[0];
    if (path !== void 0 && path !== "" && !out.includes(path)) out.push(path);
  }
  return out;
}
function imageNoteSuffix(base64) {
  const bytes = encodedBytesOf(base64);
  const size = pngSizeOf(decodeBase64(base64));
  return size === void 0 ? humanBytes(bytes) : `${size.width}x${size.height} ${humanBytes(bytes)}`;
}
function stripRefLines(text) {
  const kept = text.split("\n").filter((line) => {
    const trimmed = line.trim();
    return !trimmed.startsWith("\u56FE\u7247 ") && !trimmed.startsWith("screenshot ");
  });
  return kept.join("\n").replace(/\n+$/, "");
}

// src/payload-limit.ts
var RESERVE_BYTES = 5e5;
var SLACK_BYTES = 5e5;
var BAND_BYTES = 13e5;
var KEEP_RECENT_IMAGES = 2;
var emptyConfig = () => ({ schemaVersion: 1, providers: {} });
var emptyState = () => ({ schemaVersion: 1, observed: {} });
function positiveInt(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : void 0;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseConfig(raw) {
  if (!isRecord(raw) || !isRecord(raw.providers)) return emptyConfig();
  const providers = {};
  for (const [id, entry] of Object.entries(raw.providers)) {
    if (id === "" || !isRecord(entry)) continue;
    const limit = positiveInt(entry.maxRequestBytes);
    if (limit !== void 0) providers[id] = { maxRequestBytes: limit };
  }
  return { schemaVersion: 1, providers };
}
function parseState(raw) {
  if (!isRecord(raw) || !isRecord(raw.observed)) return emptyState();
  const observed = {};
  for (const [id, entry] of Object.entries(raw.observed)) {
    if (id === "" || !isRecord(entry)) continue;
    const maxBodyBytes = positiveInt(entry.maxBodyBytes);
    const minRejectedBytes = positiveInt(entry.minRejectedBytes);
    if (maxBodyBytes === void 0 && minRejectedBytes === void 0) continue;
    observed[id] = {
      ...maxBodyBytes !== void 0 ? { maxBodyBytes } : {},
      ...minRejectedBytes !== void 0 ? { minRejectedBytes } : {},
      ...typeof entry.updatedAt === "string" ? { updatedAt: entry.updatedAt } : {}
    };
  }
  return { schemaVersion: 1, observed };
}
function observedLimit(entry) {
  const rejected = entry?.minRejectedBytes;
  if (rejected === void 0) return void 0;
  return Math.floor(rejected * 0.8);
}
var OBSERVATION_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
function hasFreshRejection(entry, now = Date.now()) {
  if (entry?.minRejectedBytes === void 0) return false;
  const at = entry.updatedAt === void 0 ? Number.NaN : Date.parse(entry.updatedAt);
  return !Number.isFinite(at) || now - at <= OBSERVATION_TTL_MS;
}
function resolveLimit(input) {
  const config = input.config ?? emptyConfig();
  const state = input.state ?? emptyState();
  const entry = state.observed[input.providerId];
  const fromObserved = hasFreshRejection(entry, input.now) ? observedLimit(entry) : void 0;
  const fromModel = positiveInt(input.modelLimit);
  if (fromModel !== void 0) {
    return fromObserved !== void 0 && fromObserved < fromModel ? { maxRequestBytes: fromObserved, source: "observed" } : { maxRequestBytes: fromModel, source: "model" };
  }
  const fromProvider = positiveInt(config.providers[input.providerId]?.maxRequestBytes);
  if (fromProvider !== void 0) {
    return fromObserved !== void 0 && fromObserved < fromProvider ? { maxRequestBytes: fromObserved, source: "observed" } : { maxRequestBytes: fromProvider, source: "provider" };
  }
  if (fromObserved !== void 0) return { maxRequestBytes: fromObserved, source: "observed" };
  return void 0;
}
function deriveBudget(limit) {
  const triggerBytes = Math.max(0, limit.maxRequestBytes - RESERVE_BYTES - SLACK_BYTES);
  const targetBytes = Math.max(0, triggerBytes - BAND_BYTES);
  return {
    limit: limit.maxRequestBytes,
    source: limit.source,
    triggerBytes,
    targetBytes,
    hardBytes: Math.max(0, limit.maxRequestBytes - RESERVE_BYTES),
    keepRecent: KEEP_RECENT_IMAGES,
    undersized: targetBytes === 0 && triggerBytes < BAND_BYTES
  };
}
function resolveBudget(input) {
  const limit = resolveLimit(input);
  return limit === void 0 ? void 0 : deriveBudget(limit);
}
function recordObservation(state, event) {
  const bytes = positiveInt(event.bodyBytes);
  if (bytes === void 0 || event.providerId === "") return state;
  const prev = state.observed[event.providerId] ?? {};
  const next = event.outcome === "ok" ? {
    ...prev.minRejectedBytes !== void 0 && bytes >= prev.minRejectedBytes ? {} : { minRejectedBytes: prev.minRejectedBytes },
    maxBodyBytes: Math.max(prev.maxBodyBytes ?? 0, bytes)
  } : { ...prev, minRejectedBytes: Math.min(prev.minRejectedBytes ?? Number.MAX_SAFE_INTEGER, bytes) };
  return {
    schemaVersion: 1,
    observed: { ...state.observed, [event.providerId]: { ...next, updatedAt: event.at ?? (/* @__PURE__ */ new Date()).toISOString() } }
  };
}
var CONFIG_RELATIVE_PATH = "config/payload-limits.json";
var STATE_RELATIVE_PATH = "state/payload-limits.json";
async function readJsonFile(path) {
  const { readFile: readFile27 } = await import("node:fs/promises");
  const text = await readFile27(path, "utf8").catch(() => void 0);
  if (text === void 0) return void 0;
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}
async function readLimits(home2) {
  const { join: join33 } = await import("node:path");
  const [config, state] = await Promise.all([
    readJsonFile(join33(home2, CONFIG_RELATIVE_PATH)),
    readJsonFile(join33(home2, STATE_RELATIVE_PATH))
  ]);
  return { config: parseConfig(config), state: parseState(state) };
}
async function recordObservedToFile(home2, event) {
  if (event.providerId === "") return "skipped";
  const { state } = await readLimits(home2);
  const next = recordObservation(state, event);
  if (JSON.stringify(next) === JSON.stringify(state)) return "unchanged";
  const { writeTextAtomic: writeTextAtomic2 } = await Promise.resolve().then(() => (init_atomic_file(), atomic_file_exports));
  const { join: join33 } = await import("node:path");
  await writeTextAtomic2(join33(home2, STATE_RELATIVE_PATH), `${JSON.stringify(next, null, 2)}
`);
  return "written";
}

// src/image-budget.ts
var IMAGE_NOTE_PREFIXES = ["Read image file", "screenshot ", "Screenshot "];
var PATH_PATTERN = /((?:\/|~\/)[\w./@+-]*\.(?:png|jpe?g|webp|gif|bmp|avif))/i;
function imageWireBytes(data) {
  return data.length;
}
function humanBytes2(bytes) {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)}MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)}KB`;
  return `${bytes}B`;
}
function textOfContent(content) {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const part of content) {
    const block = part;
    if (block.type === "text" && typeof block.text === "string") out.push(block.text);
  }
  return out;
}
function isImageNote(text) {
  return IMAGE_NOTE_PREFIXES.some((prefix) => text.startsWith(prefix));
}
function imagePlaceholder(input) {
  const size = humanBytes2(input.bytes);
  const where = input.path === void 0 ? "" : ` ${input.path} \xB7`;
  const how = input.path === void 0 ? "\u8FD9\u5F20\u6765\u81EA\u4F60\u53D1\u9001\u7684\u9644\u4EF6\uFF0C\u4F1A\u8BDD\u91CC\u6CA1\u6709\u5BF9\u5E94\u6587\u4EF6\u53EF\u8BFB\uFF1B\u9700\u8981\u65F6\u8BF7\u91CD\u65B0\u53D1\u9001\u5B83" : "\u9700\u8981\u65F6\u7528 read \u91CD\u65B0\u67E5\u770B\u5B83";
  return `[\u56FE\u7247\u5DF2\u79FB\u9664${where} ${input.mimeType} ${size} \u2014\u2014 \u4E3A\u63A7\u5236\u8BF7\u6C42\u4F53\u79EF\u5DF2\u4ECE\u4E0A\u4E0B\u6587\u7701\u7565\uFF1B\u4E0D\u8981\u51ED\u8BB0\u5FC6\u63CF\u8FF0\u5B83\u7684\u5185\u5BB9\uFF0C${how}]`;
}
function collectImages(messages) {
  const refs = [];
  const paths = /* @__PURE__ */ new Map();
  messages.forEach((message, messageIndex) => {
    const content = message.content;
    const texts = textOfContent(content);
    const path = texts.map((text) => PATH_PATTERN.exec(text)?.[1]).find((hit) => hit !== void 0);
    if (path !== void 0) paths.set(messageIndex, path);
    if (!Array.isArray(content)) return;
    content.forEach((part, partIndex) => {
      const block = part;
      if (block.type !== "image" || typeof block.data !== "string") return;
      refs.push({
        messageIndex,
        partIndex,
        bytes: imageWireBytes(block.data),
        mimeType: typeof block.mimeType === "string" ? block.mimeType : "image/unknown",
        ...path !== void 0 ? { path } : {}
      });
    });
  });
  return { refs, paths };
}
function boundImages(messages, budget) {
  const { refs } = collectImages(messages);
  const bytesBefore = refs.reduce((sum, ref) => sum + ref.bytes, 0);
  const unchanged = {
    messages,
    droppedCount: 0,
    bytesBefore,
    bytesAfter: bytesBefore,
    keptImages: refs.length
  };
  if (refs.length === 0 || bytesBefore <= budget.triggerBytes) return unchanged;
  const { dropCount, kept: bytesAfter } = planElision(refs.map((ref) => ref.bytes), budget);
  if (dropCount === 0) return unchanged;
  const dropped = refs.slice(0, dropCount);
  const droppedByMessage = /* @__PURE__ */ new Map();
  const totalByMessage = /* @__PURE__ */ new Map();
  for (const ref of refs) totalByMessage.set(ref.messageIndex, (totalByMessage.get(ref.messageIndex) ?? 0) + 1);
  for (const ref of dropped) {
    const set = droppedByMessage.get(ref.messageIndex) ?? /* @__PURE__ */ new Set();
    set.add(ref.partIndex);
    droppedByMessage.set(ref.messageIndex, set);
  }
  const fullyDropped = (messageIndex) => (droppedByMessage.get(messageIndex)?.size ?? 0) === (totalByMessage.get(messageIndex) ?? 0);
  const next = messages.map((message, messageIndex) => {
    const positions = droppedByMessage.get(messageIndex);
    if (positions === void 0) return message;
    const content = message.content;
    if (!Array.isArray(content)) return message;
    const rebuilt = [];
    content.forEach((part, partIndex) => {
      const block = part;
      if (positions.has(partIndex)) {
        const ref = dropped.find((item) => item.messageIndex === messageIndex && item.partIndex === partIndex);
        rebuilt.push({ type: "text", text: imagePlaceholder({ mimeType: ref.mimeType, bytes: ref.bytes, path: ref.path }) });
        return;
      }
      if (block.type === "text" && typeof block.text === "string" && fullyDropped(messageIndex)) {
        if (isImageNote(block.text)) return;
        const stripped = stripRefLines(block.text);
        if (stripped !== block.text) {
          rebuilt.push({ type: "text", text: stripped === "" ? "[\u5185\u5BB9\u5DF2\u7701\u7565]" : stripped });
          return;
        }
      }
      rebuilt.push(part);
    });
    return { ...message, content: rebuilt };
  });
  return {
    messages: next,
    droppedCount: dropCount,
    bytesBefore,
    bytesAfter,
    keptImages: refs.length - dropCount
  };
}
function planElision(sizes, budget) {
  const keepRecent = Math.max(0, Math.floor(budget.keepRecent));
  const protectedFrom = Math.max(0, sizes.length - keepRecent);
  const hard = budget.hardBytes ?? budget.triggerBytes;
  let kept = 0;
  let dropCount = 0;
  for (const size of sizes) {
    kept += size;
    if (kept <= budget.triggerBytes) continue;
    while (kept > budget.targetBytes) {
      if (dropCount >= protectedFrom && kept <= hard) break;
      if (dropCount >= sizes.length) break;
      kept -= sizes[dropCount] ?? 0;
      dropCount += 1;
    }
  }
  return { dropCount, kept };
}
function applyImageBudget(messages, model, limits) {
  const budget = resolveBudget({
    providerId: model?.provider ?? "",
    modelLimit: model?.inputLimits?.maxRequestBytes,
    config: limits.config,
    state: limits.state
  });
  if (budget === void 0) return void 0;
  return { budget, result: boundImages(messages, budget) };
}
function imageBytesOf(messages) {
  return collectImages(messages).refs.reduce((sum, ref) => sum + ref.bytes, 0);
}

// src/attachments.ts
import { createHash } from "node:crypto";
import { mkdir as mkdir2, readFile as readFile4, rename as rename2, stat as stat4, writeFile as writeFile4 } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import { join as join3 } from "node:path";

// src/attachment-serve.ts
import { stat as stat3 } from "node:fs/promises";
import { extname, resolve as resolve3, sep as sep2 } from "node:path";
import { readFile as readFile3 } from "node:fs/promises";

// src/fs.ts
init_home();
import { readdir as readdir2, readFile as readFile2, stat as stat2, writeFile as writeFile3 } from "node:fs/promises";
import { dirname as dirname2, join as join2, resolve as resolve2, sep } from "node:path";
var MAX_CONTENT_BYTES = 2 * 1024 * 1024;
function rootsFilePath() {
  return join2(resolveHome(), "config", "file-roots.json");
}
async function readRoots() {
  const roots = /* @__PURE__ */ new Set([resolve2(resolveHome())]);
  try {
    const data = JSON.parse(await readFile2(rootsFilePath(), "utf8"));
    if (Array.isArray(data.roots)) {
      for (const item of data.roots) if (typeof item === "string" && item.trim() !== "") roots.add(resolve2(item));
    }
  } catch {
  }
  return [...roots];
}
async function registerRoot(path) {
  const target = resolve2(path.trim());
  const info = await stat2(target).catch(() => void 0);
  if (info === void 0) return { code: "not_found", message: "\u76EE\u5F55\u4E0D\u5B58\u5728", status: 404 };
  if (!info.isDirectory()) return { code: "not_a_directory", message: "\u4E0D\u662F\u76EE\u5F55", status: 400 };
  const home2 = resolve2(resolveHome());
  const extra = (await readRoots()).filter((root) => root !== home2 && root !== target);
  extra.unshift(target);
  await writeFile3(rootsFilePath(), JSON.stringify({ schemaVersion: 1, roots: extra }, null, 2) + "\n", { encoding: "utf8", mode: 384 });
  return { roots: await readRoots() };
}
function guardWithinRoots(path, roots) {
  const target = resolve2(path);
  for (const root of roots) {
    if (target === root || target.startsWith(root.endsWith(sep) ? root : root + sep)) return target;
  }
  return { code: "path_not_allowed", message: "\u8DEF\u5F84\u4E0D\u5728\u5DF2\u6CE8\u518C\u7684\u6839\u5185", status: 403 };
}
async function listTree(path) {
  const roots = await readRoots();
  const target = guardWithinRoots(path, roots);
  if (typeof target !== "string") return target;
  const info = await stat2(target).catch(() => void 0);
  if (info === void 0) return { code: "not_found", message: "\u8DEF\u5F84\u4E0D\u5B58\u5728", status: 404 };
  if (!info.isDirectory()) return { code: "not_a_directory", message: "\u4E0D\u662F\u76EE\u5F55", status: 400 };
  const names = await readdir2(target).catch(() => []);
  const entries = [];
  for (const name of names) {
    const isDir3 = await stat2(join2(target, name)).then((s) => s.isDirectory(), () => false);
    entries.push({ name, isDir: isDir3 });
  }
  entries.sort((a, b) => a.isDir !== b.isDir ? a.isDir ? -1 : 1 : a.name.localeCompare(b.name));
  return { path: target, entries };
}
async function readContent(path) {
  const roots = await readRoots();
  const target = guardWithinRoots(path, roots);
  if (typeof target !== "string") return target;
  const info = await stat2(target).catch(() => void 0);
  if (info === void 0) return { code: "not_found", message: "\u6587\u4EF6\u4E0D\u5B58\u5728", status: 404 };
  if (info.isDirectory()) return { code: "not_a_directory", message: "\u662F\u76EE\u5F55\uFF0C\u4E0D\u662F\u6587\u4EF6", status: 400 };
  const buffer = await readFile2(target);
  const probe = buffer.subarray(0, 8192);
  const isBinary = probe.includes(0);
  const truncated = info.size > MAX_CONTENT_BYTES;
  const body = buffer.subarray(0, MAX_CONTENT_BYTES);
  return {
    path: target,
    fileName: target.slice(target.lastIndexOf(sep) + 1),
    content: isBinary ? "" : body.toString("utf8"),
    size: info.size,
    truncated,
    isBinary
  };
}
async function browse(path) {
  const target = resolve2((path ?? "").trim() === "" ? resolveHome() : path);
  const info = await stat2(target).catch(() => void 0);
  if (info === void 0) return { code: "not_found", message: "\u8DEF\u5F84\u4E0D\u5B58\u5728", status: 404 };
  if (!info.isDirectory()) return { code: "not_a_directory", message: "\u4E0D\u662F\u76EE\u5F55", status: 400 };
  const names = await readdir2(target, { withFileTypes: true }).catch(() => []);
  const dirs = [];
  for (const entry of names) if (entry.isDirectory()) dirs.push(entry.name);
  dirs.sort((a, b) => a.localeCompare(b));
  const parent = dirname2(target) === target ? null : dirname2(target);
  return { path: target, parent, dirs };
}

// src/stream-events.ts
var MAX_RESULT_CHARS = 8e3;
var MAX_TOOL_IMAGE_BYTES = 10 * 1024 * 1024;
var MAX_TOOL_IMAGES = 4;
function toolResultImages(result) {
  const content = result?.content;
  if (!Array.isArray(content)) return [];
  const images = [];
  for (const block of content) {
    if (images.length >= MAX_TOOL_IMAGES) break;
    const part = block;
    if (part === null || part.type !== "image") continue;
    if (typeof part.data !== "string" || typeof part.mimeType !== "string") continue;
    if (!part.mimeType.startsWith("image/")) continue;
    if (part.data.length * 3 / 4 > MAX_TOOL_IMAGE_BYTES) continue;
    images.push({ data: part.data, mimeType: part.mimeType });
  }
  return images;
}
function toolResultText(result) {
  const content = result?.content;
  let text;
  if (typeof result === "string") text = result;
  else if (Array.isArray(content)) {
    text = content.filter((block) => {
      const part = block;
      return part !== null && part.type === "text" && typeof part.text === "string";
    }).map((block) => block.text).join("\n");
  } else if (content === void 0 && result !== void 0) text = JSON.stringify(result, null, 2) ?? String(result);
  else text = "";
  if (text.length <= MAX_RESULT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_RESULT_CHARS), truncated: true };
}
function segmentOf(message) {
  return typeof message?.timestamp === "number" ? `msg-${message.timestamp}` : void 0;
}
function toStreamEvent(event) {
  if (typeof event !== "object" || event === null) return void 0;
  const input = event;
  if (input.type === "message_start") {
    if (input.message?.role !== "assistant") return void 0;
    return { type: "message_start", segment: segmentOf(input.message) ?? "assistant" };
  }
  if (input.type === "message_end") {
    if (input.message?.role !== "assistant") return void 0;
    return { type: "message_end", segment: segmentOf(input.message) ?? "assistant" };
  }
  if (input.type === "message_update") {
    const update = input.assistantMessageEvent;
    if (update === void 0) return void 0;
    const index = typeof update.contentIndex === "number" ? update.contentIndex : 0;
    const segment = segmentOf(input.message);
    const segmentPart = segment === void 0 ? {} : { segment };
    if (update.type === "thinking_start") return { type: "thinking", index, text: "", ...segmentPart };
    if (update.type === "thinking_delta") return { type: "thinking", index, text: update.delta ?? "", ...segmentPart };
    if (update.type === "thinking_end") return { type: "thinking_end", index, ...segmentPart };
    if (update.type === "text_delta") return { type: "delta", index, text: update.delta ?? "", ...segmentPart };
    if (update.type === "toolcall_end") {
      const call = update.toolCall;
      if (typeof call?.id !== "string" || typeof call.name !== "string") return void 0;
      return { type: "tool_call", index, id: call.id, name: call.name, arguments: call.arguments ?? {}, ...segmentPart };
    }
    return void 0;
  }
  if (input.type === "auto_retry_start") {
    return {
      type: "retrying",
      attempt: typeof input.attempt === "number" ? input.attempt : 0,
      maxAttempts: typeof input.maxAttempts === "number" ? input.maxAttempts : 0,
      delayMs: typeof input.delayMs === "number" ? input.delayMs : 0,
      message: typeof input.errorMessage === "string" ? input.errorMessage : ""
    };
  }
  if (input.type === "auto_retry_end") {
    return {
      type: "retry_end",
      success: input.success === true,
      ...typeof input.attempt === "number" ? { attempt: input.attempt } : {},
      ...typeof input.finalError === "string" && input.finalError !== "" ? { finalError: input.finalError } : {}
    };
  }
  if (input.type === "tool_execution_start") {
    if (typeof input.toolCallId !== "string" || typeof input.toolName !== "string") return void 0;
    return { type: "tool_start", id: input.toolCallId, name: input.toolName, arguments: input.args ?? {} };
  }
  if (input.type === "tool_execution_update") {
    return typeof input.toolCallId === "string" ? { type: "tool_update", id: input.toolCallId } : void 0;
  }
  if (input.type === "tool_execution_end") {
    if (typeof input.toolCallId !== "string") return void 0;
    const { text, truncated } = toolResultText(input.result);
    const images = toolResultImages(input.result);
    return {
      type: "tool_result",
      id: input.toolCallId,
      isError: input.isError === true,
      text,
      truncated,
      ...images.length > 0 ? { images } : {},
      ...typeof input.durationMs === "number" ? { durationMs: input.durationMs } : {}
    };
  }
  return void 0;
}

// src/attachment-serve.ts
var MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".avif": "image/avif"
};
function mimeTypeOfImagePath(path) {
  return MIME_BY_EXT[extname(path).toLowerCase()];
}
function isReferenced(path, referenced) {
  return referenced.has(resolve3(path));
}
function withinRoots(target, roots) {
  const absolute = resolve3(target);
  for (const root of roots) {
    const normalized = resolve3(root);
    if (absolute === normalized) return true;
    if (absolute.startsWith(normalized.endsWith(sep2) ? normalized : normalized + sep2)) return true;
  }
  return false;
}
async function resolveServeTarget(rawPath, roots, referenced) {
  if (rawPath === void 0 || rawPath.trim() === "") {
    return { code: "invalid_request", message: "\u9700\u8981 path \u53C2\u6570", status: 400 };
  }
  if (/[\u0000\r\n]/.test(rawPath)) {
    return { code: "invalid_attachment_path", message: "\u8DEF\u5F84\u5305\u542B\u975E\u6CD5\u5B57\u7B26", status: 400 };
  }
  const mimeType = mimeTypeOfImagePath(rawPath);
  if (mimeType === void 0) {
    return { code: "not_an_image", message: "\u53EA\u652F\u6301\u56FE\u7247\uFF08png/jpg/webp/gif/bmp/avif\uFF09", status: 400 };
  }
  if (!withinRoots(rawPath, roots) && (referenced === void 0 || !isReferenced(rawPath, referenced))) {
    return { code: "path_not_allowed", message: "\u8DEF\u5F84\u4E0D\u5728\u5DF2\u6CE8\u518C\u7684\u6839\u5185\uFF0C\u4E5F\u4E0D\u5728\u4EFB\u4F55\u4F1A\u8BDD\u7684\u5F15\u7528\u884C\u91CC", status: 403 };
  }
  const info = await stat3(rawPath).catch(() => void 0);
  if (info === void 0 || !info.isFile()) {
    return { code: "attachment_not_found", message: "\u56FE\u7247\u4E0D\u5728\u4E86\uFF08\u53EF\u80FD\u88AB\u6E05\u7406\u6216\u5DF2\u79FB\u52A8\uFF09", status: 404 };
  }
  if (info.size > MAX_TOOL_IMAGE_BYTES) {
    return { code: "attachment_too_large", message: `\u56FE\u7247\u8D85\u8FC7 ${MAX_TOOL_IMAGE_BYTES / (1024 * 1024)}MB`, status: 413 };
  }
  return { path: rawPath, mimeType };
}
async function readServeBytes(path) {
  return await readFile3(path).catch(() => void 0);
}
async function loadAttachmentForServe(rawPath, referenced) {
  const roots = await readRoots();
  const target = await resolveServeTarget(rawPath, roots, referenced);
  if ("code" in target) return target;
  const bytes = await readServeBytes(target.path);
  if (bytes === void 0) return { code: "attachment_not_found", message: "\u56FE\u7247\u8BFB\u53D6\u5931\u8D25", status: 404 };
  const info = await stat3(target.path).catch(() => void 0);
  return { bytes, mimeType: target.mimeType, path: target.path, mtimeMs: info?.mtimeMs ?? 0 };
}

// src/attachment-ref.ts
function imageRefOfPath(absolutePath) {
  const mimeType = mimeTypeOfImagePath(absolutePath);
  if (mimeType === void 0) return void 0;
  return { url: `/api/attachment?path=${encodeURIComponent(absolutePath)}`, mimeType };
}

// src/attachments.ts
var ATTACHMENTS_DIR = "attachments";
var MIME_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/avif": "avif"
};
function extensionOf(mimeType) {
  return MIME_EXT[mimeType.toLowerCase()] ?? "bin";
}
function contentHashOf(base64) {
  return createHash("sha256").update(Buffer.from(base64, "base64")).digest("hex").slice(0, 32);
}
function attachmentRelativePath(input) {
  const hash = contentHashOf(input.base64);
  const ext = extensionOf(input.mimeType ?? "image/png");
  return `${ATTACHMENTS_DIR}/${hash.slice(0, 2)}/${hash}.${ext}`;
}
async function storeAttachment(home2, input) {
  const relative3 = attachmentRelativePath(input);
  const path = join3(home2, relative3);
  if (await stat4(path).then(() => true, () => false)) return { path, created: false };
  const buffer = Buffer.from(input.base64, "base64");
  await mkdir2(join3(home2, ATTACHMENTS_DIR, relative3.split("/")[1] ?? ""), { recursive: true, mode: 448 });
  const tmp = `${path}.tmp`;
  await writeFile4(tmp, buffer, { mode: 384 });
  await rename2(tmp, path);
  return { path, created: true };
}
async function readAttachment(absolutePath) {
  try {
    const buffer = await readFile4(absolutePath);
    return buffer.toString("base64");
  } catch {
    return void 0;
  }
}
function formatAttachmentRef(input) {
  return input.note === void 0 ? `\u56FE\u7247 ${input.path}` : `\u56FE\u7247 ${input.path} ${input.note}`;
}
var attachmentCache = /* @__PURE__ */ new Map();
function profileKey(profile) {
  return `${profile.maxWidth ?? 2e3}x${profile.maxHeight ?? 2e3}/${profile.maxBytes ?? 4718592}/${profile.jpegQuality ?? 80}`;
}
function resizeOptionsOf(profile) {
  const options = {};
  if (profile.maxWidth !== void 0) options.maxWidth = profile.maxWidth;
  if (profile.maxHeight !== void 0) options.maxHeight = profile.maxHeight;
  if (profile.maxBytes !== void 0) options.maxBytes = profile.maxBytes;
  if (profile.jpegQuality !== void 0) options.jpegQuality = profile.jpegQuality;
  return options;
}
var attachmentResizeCache = /* @__PURE__ */ new Map();
var imageResizer;
function mimeTypeOfPath(absolutePath) {
  const lower = absolutePath.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".avif")) return "image/avif";
  return "image/png";
}
async function defaultResizer(bytes, mimeType, profile) {
  const { resizeImage } = await import("@earendil-works/pi-coding-agent");
  const resized = await resizeImage(bytes, mimeType, resizeOptionsOf(profile));
  if (resized === null) return null;
  return { data: resized.data, mimeType: resized.mimeType, wasResized: resized.wasResized };
}
async function readAttachmentForRequest(absolutePath, profile) {
  const key = profile === void 0 ? `${absolutePath}\0raw` : `${absolutePath}\0${profileKey(profile)}`;
  if (attachmentResizeCache.has(key)) return attachmentResizeCache.get(key);
  const data = await readAttachment(absolutePath);
  if (data === void 0) {
    attachmentResizeCache.set(key, void 0);
    return void 0;
  }
  const mimeType = mimeTypeOfPath(absolutePath);
  let out = { data, mimeType, wasResized: false };
  if (profile !== void 0) {
    try {
      const bytes = new Uint8Array(Buffer.from(data, "base64"));
      const resized = await (imageResizer ?? defaultResizer)(bytes, mimeType, profile);
      if (resized !== null) out = resized;
    } catch {
    }
  }
  attachmentResizeCache.set(key, out);
  return out;
}
var MISSING_MARK = "\uFF08\u8BE5\u56FE\u7247\u6587\u4EF6\u5DF2\u4E22\u5931\uFF1A\u9644\u4EF6\u53EF\u80FD\u88AB\u6E05\u7406\uFF0C\u8BF7\u91CD\u65B0\u53D1\u9001\u6216\u91CD\u65B0\u622A\u56FE\uFF09";
async function reinjectRecentImages(messages, keepRecent, options) {
  if (keepRecent < 0 || options?.allowImages === false) return { messages, injected: 0, missing: 0, changed: false };
  let injected = 0;
  let missing = 0;
  let changed = false;
  const isUser = (message) => message.role === "user";
  let anchor = messages.length;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message !== void 0 && isUser(message)) {
      anchor = i;
      break;
    }
  }
  const next = new Array(messages.length);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message === void 0) continue;
    const content = message.content;
    if (!Array.isArray(content)) {
      next[i] = message;
      continue;
    }
    if (content.some((block) => block.type === "image")) {
      next[i] = message;
      continue;
    }
    const inCurrentTurn = i >= anchor;
    if (!inCurrentTurn && injected >= keepRecent) {
      next[i] = message;
      continue;
    }
    const rebuilt = [];
    let messageChanged = false;
    for (const block of content) {
      const part = block;
      const refs = part.type === "text" && typeof part.text === "string" ? parseImageRefs(part.text) : [];
      if (refs.length === 0) {
        rebuilt.push(block);
        continue;
      }
      if (!inCurrentTurn && injected >= keepRecent) {
        rebuilt.push(block);
        continue;
      }
      let text = part.text;
      const images = [];
      for (const ref of refs) {
        if (!inCurrentTurn && injected >= keepRecent) break;
        const read = await readAttachmentForRequest(ref, options?.resize);
        if (read === void 0) {
          missing += 1;
          if (!text.includes("\u5DF2\u4E22\u5931")) text = `${text.replace(/\s*$/, "")}${MISSING_MARK}`;
          continue;
        }
        images.push({ type: "image", data: read.data, mimeType: read.mimeType });
        injected += 1;
      }
      rebuilt.push(text === part.text ? block : { type: "text", text });
      for (const image of images) rebuilt.push(image);
      if (text !== part.text || images.length > 0) messageChanged = true;
    }
    if (messageChanged) {
      next[i] = { ...message, content: rebuilt };
      changed = true;
    } else next[i] = message;
  }
  for (let i = 0; i < next.length; i += 1) {
    const original = messages[i];
    if (next[i] === void 0 && original !== void 0) next[i] = original;
  }
  return { messages: changed ? next : messages, injected, missing, changed };
}
function imageRefBlocksOf(message) {
  const content = message.content;
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const block of content) {
    const part = block;
    if (part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") {
      out.push({ type: "image", data: part.data, mimeType: part.mimeType });
      continue;
    }
    if (part.type !== "text" || typeof part.text !== "string") continue;
    for (const ref of parseImageRefs(part.text)) {
      if (out.length >= 4) break;
      const ref0 = imageRefOfPath(ref);
      if (ref0 === void 0 || ref0.url === void 0) continue;
      if (out.some((item) => item.url === ref0.url)) continue;
      out.push({ type: "image", url: ref0.url, mimeType: ref0.mimeType });
    }
  }
  return out;
}
function toolResultImageRefs(message, resultText) {
  const out = [];
  for (const inline of toolResultImagesOfMessage(message)) {
    out.push({ data: inline.data, mimeType: inline.mimeType });
  }
  const text = resultText ?? "";
  for (const ref of parseImageRefs(text)) {
    if (out.length >= 4) break;
    const ref0 = imageRefOfPath(ref);
    if (ref0 === void 0 || ref0.url === void 0) continue;
    if (out.some((item) => item.url === ref0.url)) continue;
    out.push({ url: ref0.url, mimeType: ref0.mimeType });
  }
  return out;
}
function toolResultImagesOfMessage(message) {
  const content = message.content;
  if (!Array.isArray(content)) return [];
  const images = [];
  for (const block of content) {
    const part = block;
    if (part === null || part.type !== "image") continue;
    if (typeof part.data !== "string" || typeof part.mimeType !== "string") continue;
    images.push({ data: part.data, mimeType: part.mimeType });
  }
  return images;
}
var attachmentSizeCache = /* @__PURE__ */ new Map();
function attachmentFileSizeCached(absolutePath) {
  const cached = attachmentSizeCache.get(absolutePath);
  if (cached !== void 0) return cached;
  try {
    const size = statSync(absolutePath).size;
    attachmentSizeCache.set(absolutePath, size);
    return size;
  } catch {
    return 0;
  }
}
async function appendAttachmentRefs(home2, text, images) {
  const lines = [];
  const stored = [];
  const failed = [];
  for (const image of images) {
    const result = await storeAttachment(home2, { base64: image.data, mimeType: image.mimeType }).catch(() => void 0);
    if (result === void 0) {
      failed.push({ type: "image", data: image.data, mimeType: image.mimeType });
      continue;
    }
    stored.push(result.path);
    lines.push(formatAttachmentRef({ path: result.path, note: imageNoteSuffix(image.data) }));
  }
  if (lines.length === 0) return { text, lines, stored, failed };
  const base = text.replace(/\s+$/, "");
  return { text: `${base}

${lines.join("\n")}`, lines, stored, failed };
}
var ATTACHMENT_REF = /attachments\/[0-9a-f]{2}\/[0-9a-f]{32}\.[a-z0-9]+/g;
var ORPHAN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
async function listJsonlFiles(dir) {
  const { readdir: readdir20 } = await import("node:fs/promises");
  const entries = await readdir20(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const path = join3(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listJsonlFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(path);
  }
  return out;
}
async function collectReferencedAttachments(home2) {
  try {
    const { stat: stat19 } = await import("node:fs/promises");
    const agentsDir = join3(home2, "agents");
    if (!await stat19(agentsDir).then((info) => info.isDirectory(), () => false)) return void 0;
    const files = await listJsonlFiles(agentsDir);
    const refs = /* @__PURE__ */ new Set();
    for (const file of files) {
      const text = await readFile4(file, "utf8");
      for (const match of text.matchAll(ATTACHMENT_REF)) refs.add(match[0]);
    }
    return refs;
  } catch {
    return void 0;
  }
}
async function gcAttachments(home2, options) {
  const maxAgeMs = options?.maxAgeMs ?? ORPHAN_MAX_AGE_MS;
  const now = options?.now ?? Date.now();
  const refs = await collectReferencedAttachments(home2);
  if (refs === void 0) return { removed: 0, kept: 0, removedBytes: 0, scannedRefs: 0 };
  const { readdir: readdir20, unlink, stat: stat19 } = await import("node:fs/promises");
  const root = join3(home2, ATTACHMENTS_DIR);
  const result = { removed: 0, kept: 0, removedBytes: 0, scannedRefs: refs.size };
  let subdirs;
  try {
    subdirs = await readdir20(root, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const sub of subdirs) {
    if (!sub.isDirectory()) continue;
    const files = await readdir20(join3(root, sub.name), { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile() || file.name.endsWith(".tmp")) continue;
      const relative3 = `${ATTACHMENTS_DIR}/${sub.name}/${file.name}`;
      const path = join3(root, sub.name, file.name);
      if (refs.has(relative3)) {
        result.kept += 1;
        continue;
      }
      const info = await stat19(path).catch(() => void 0);
      if (info === void 0) continue;
      if (now - info.mtimeMs < maxAgeMs) {
        result.kept += 1;
        continue;
      }
      await unlink(path).catch(() => void 0);
      attachmentCache.delete(path);
      attachmentSizeCache.delete(path);
      result.removed += 1;
      result.removedBytes += info.size;
    }
  }
  return result;
}

// src/assembly.ts
import { readdir as readdir9, readFile as readFile10 } from "node:fs/promises";
import { basename as basename3, isAbsolute, join as join12, relative, resolve as resolve6 } from "node:path";
init_logging();

// src/failure.ts
var AUTH = /(401|403|unauthorized|forbidden|invalid api key|no api key|authentication|permission denied)/i;
var NOT_CONFIGURED = /(failed to resolve (api key|config value)|no api key (found )?for|no api key for provider|provider is not configured|missing required environment variable)/i;
var QUOTA = /(insufficient_quota|quota.?exceed|out of budget|billing|GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|subscription_sharing_usage_limit_exceeded)/i;
var RATE_LIMIT = /(429|rate.?limit|too many requests)/i;
var PAYLOAD_TOO_LARGE = /(\b413\b|payload.?too.?large|maximum request body|request body.{0,24}(too large|exceed))/i;
var NETWORK = /(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|fetch failed|getaddrinfo|socket hang up|connection (refused|reset|closed|lost|error|timed out)|network.?error|upstream.?connect|other side closed|reset before headers|stream ended before|ended without|http2 request did not get a response|pending stream has been canceled|websocket.?(closed|error))/i;
var TIMEOUT = /(timed?\s?out|timeout|ETIMEDOUT|deadline exceeded)/i;
var SERVER = /(\b5\d\d\b|internal server error|bad gateway|service unavailable|overloaded|provider returned (an )?error|unable to forward upstream)/i;
function classifyFailure(input) {
  if (input.stopReason === "aborted") return "aborted";
  if (input.stopReason === "length") return "truncated";
  const message = (input.errorMessage ?? "").trim();
  if (message !== "") {
    if (NOT_CONFIGURED.test(message)) return "model_not_configured";
    if (AUTH.test(message)) return "auth";
    if (QUOTA.test(message)) return "quota";
    if (RATE_LIMIT.test(message)) return "rate_limit";
    if (PAYLOAD_TOO_LARGE.test(message)) return "payload_too_large";
    if (NETWORK.test(message)) return "network";
    if (TIMEOUT.test(message)) return "timeout";
    if (SERVER.test(message)) return "server";
    return "unknown";
  }
  if (input.stopReason === "error") return "unknown";
  if (!input.hasContent) return "empty";
  return void 0;
}

// src/assembly.ts
init_home();

// src/projects.ts
init_home();
import { readdir as readdir8, rename as rename5, rm as rm4, stat as stat9 } from "node:fs/promises";
import { basename as basename2, join as join11, resolve as resolve5 } from "node:path";

// src/segments.ts
function sanitizeSegment(name) {
  const cleaned = name.replace(/[\/\:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, "-").replace(/^[.\-]+|[.\-]+$/g, "").slice(0, 60);
  return cleaned === "" ? "unnamed" : cleaned;
}
var URL_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
function entityId(name, kind) {
  const trimmed = (name ?? "").trim();
  if (kind === "fs") return { ok: true, id: sanitizeSegment(trimmed), derived: true };
  if (trimmed === "") {
    return { ok: false, reason: "needs_ascii_name", message: "\u540D\u5B57\u4E3A\u7A7A\uFF0C\u65E0\u6CD5\u751F\u6210 id" };
  }
  const hasNonAscii = /[^\x00-\x7F]/.test(trimmed);
  if (hasNonAscii) {
    return {
      ok: false,
      reason: "needs_ascii_name",
      message: `"${trimmed}" \u542B\u975E ASCII \u5B57\u7B26\uFF08\u5982\u4E2D\u6587\uFF09\uFF0C\u65E0\u6CD5\u751F\u6210 URL \u5B89\u5168\u7684 id\u3002\u8BF7\u7ED9\u4E00\u4E2A\u82F1\u6587\u6216\u62FC\u97F3\u540D\u5B57\uFF08id \u4E00\u65E6\u751F\u6210\u5C31\u7A33\u5B9A\uFF0C\u6539\u540D\u4E0D\u53D8\uFF09\u3002`
    };
  }
  const base = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  if (base === "" || !URL_ID.test(base)) {
    return {
      ok: false,
      reason: "needs_ascii_name",
      message: `"${trimmed}" \u8F6C\u4E0D\u51FA\u5408\u6CD5 id\uFF08\u9700\u8981\u4EE5\u5B57\u6BCD\u6570\u5B57\u5F00\u5934\u3001\u53EA\u542B\u5B57\u6BCD\u6570\u5B57\u4E0E\u8FDE\u5B57\u7B26\uFF09\u3002\u8BF7\u7ED9\u4E00\u4E2A\u82F1\u6587\u6216\u62FC\u97F3\u540D\u5B57\u3002`
    };
  }
  return { ok: true, id: base, derived: true };
}
function uniqueId(base, taken) {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base.slice(0, 58)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// src/project-registry.ts
init_home();
import { createHash as createHash2 } from "node:crypto";
import { readFile as readFile6, readdir as readdir4, realpath } from "node:fs/promises";
import { basename, join as join6, resolve as resolve4 } from "node:path";

// src/project-skeleton.ts
init_home();
import { mkdir as mkdir4, readFile as readFile5, writeFile as writeFile6 } from "node:fs/promises";
import { join as join5 } from "node:path";
async function skeletonText(name) {
  const path = join5(resolveHome(), "interaction-harness", "skeleton", `${name}.md`);
  const text = await readFile5(path, "utf8").catch(() => void 0);
  if (text === void 0) throw new Error(`\u7F3A\u5C11\u9AA8\u67B6\u6A21\u677F\uFF1A${path}\uFF08\u5BB6\u76EE\u5F55\u662F\u5426\u5B89\u88C5\u5B8C\u6574\uFF1F\uFF09`);
  return text;
}
async function writeIfMissing(path, content) {
  await writeFile6(path, content, { encoding: "utf8", mode: 384, flag: "wx" }).catch(() => {
  });
}
async function dirWithNote(dir, name) {
  await mkdir4(dir, { recursive: true, mode: 448 });
  await writeIfMissing(join5(dir, "AGENTS.md"), await skeletonText(name));
}
async function commonLayer(dir, withMemory) {
  await writeIfMissing(join5(dir, "concept-space.md"), await skeletonText("concept-space"));
  await writeIfMissing(join5(dir, "flywheel.md"), await skeletonText("flywheel"));
  await dirWithNote(join5(dir, "specs"), "specs");
  await writeIfMissing(join5(dir, "specs", "index.json"), JSON.stringify({ schemaVersion: 1, specs: [] }, null, 2) + "\n");
  await dirWithNote(join5(dir, "cases"), "cases");
  await dirWithNote(join5(dir, "knowledge"), "knowledge");
  await dirWithNote(join5(dir, "tools"), "tools");
  await dirWithNote(join5(dir, "todo"), "todo");
  await dirWithNote(join5(dir, "task-types"), "task-types");
  if (withMemory) await dirWithNote(join5(dir, "memory"), "memory");
}
async function ensureSharedLayer(dir, project) {
  await mkdir4(dir, { recursive: true, mode: 448 });
  const manifest = {
    schemaVersion: 1,
    id: project.id,
    name: project.name,
    ...project.path !== void 0 ? { path: project.path } : {},
    ...project.icon !== void 0 ? { icon: project.icon } : {}
  };
  await writeIfMissing(join5(dir, "project.json"), JSON.stringify(manifest, null, 2) + "\n");
  await writeIfMissing(join5(dir, "AGENTS.md"), await skeletonText("layer-shared"));
  await commonLayer(dir, true);
}
async function ensureAgentProjectLayer(dir) {
  await mkdir4(dir, { recursive: true, mode: 448 });
  await writeIfMissing(join5(dir, "AGENTS.md"), await skeletonText("layer-project"));
  await commonLayer(dir, true);
  await dirWithNote(join5(dir, "sessions"), "sessions");
  await dirWithNote(join5(dir, "tasks"), "tasks");
}
async function ensureAgentLayer(dir) {
  await mkdir4(dir, { recursive: true, mode: 448 });
  await writeIfMissing(join5(dir, "AGENTS.md"), await skeletonText("layer-agent"));
  await dirWithNote(join5(dir, "tools"), "tools");
  await dirWithNote(join5(dir, "memory"), "memory");
}
async function ensureTaskSkeleton(dir) {
  await mkdir4(dir, { recursive: true, mode: 448 });
  await writeIfMissing(join5(dir, "AGENTS.md"), await skeletonText("task"));
  await writeIfMissing(join5(dir, "concept-space.md"), await skeletonText("concept-space"));
  await writeIfMissing(join5(dir, "flywheel.md"), await skeletonText("flywheel"));
  await dirWithNote(join5(dir, "specs"), "specs");
  await writeIfMissing(join5(dir, "specs", "index.json"), JSON.stringify({ schemaVersion: 1, specs: [] }, null, 2) + "\n");
  await dirWithNote(join5(dir, "cases"), "cases");
  await dirWithNote(join5(dir, "knowledge"), "knowledge");
  await dirWithNote(join5(dir, "tools"), "tools");
  await dirWithNote(join5(dir, "todo"), "todo");
}

// src/project-registry.ts
var ICON_MAX_CHARS = 32;
function normalizeIcon(value) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim();
  if (trimmed === "") return void 0;
  if ([...trimmed].length > ICON_MAX_CHARS) return void 0;
  if (/[\r\n\t]/.test(trimmed)) return void 0;
  return trimmed;
}
var registryRoot = () => join6(resolveHome(), "projects");
function opaqueProjectId(canonicalPath) {
  const digest = createHash2("sha1").update(canonicalPath).digest("hex").slice(0, 6);
  return `project-${digest}`;
}
var manifestPath = (id) => join6(registryRoot(), id, "project.json");
var parse = (raw) => {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.id !== "string" || typeof parsed.name !== "string") return void 0;
    const icon = normalizeIcon(parsed.icon);
    return {
      schemaVersion: 1,
      id: parsed.id,
      name: parsed.name,
      ...typeof parsed.path === "string" && parsed.path !== "" ? { path: parsed.path } : {},
      ...icon !== void 0 ? { icon } : {}
    };
  } catch {
    return void 0;
  }
};
var SHARED_WORKSPACE_ID = "workspace";
async function ensureSharedWorkspace() {
  const project = { schemaVersion: 1, id: SHARED_WORKSPACE_ID, name: "workspace" };
  await ensureSharedLayer(join6(registryRoot(), SHARED_WORKSPACE_ID), project);
  return project;
}
async function listGlobalProjects() {
  const out = /* @__PURE__ */ new Map();
  const workspace = await ensureSharedWorkspace();
  out.set(workspace.id, workspace);
  const entries = await readdir4(registryRoot(), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const project = await readGlobalProject(entry.name);
    if (project !== void 0) {
      await ensureSharedLayer(join6(registryRoot(), project.id), project);
      out.set(project.id, project);
    }
  }
  return out;
}
async function readGlobalProject(id) {
  return parse(await readFile6(manifestPath(id), "utf8").catch(() => ""));
}
async function canonical(path) {
  return realpath(path).catch(() => resolve4(path));
}
async function registerGlobalProject(path, preferredName) {
  const target = resolve4(path);
  const canonicalTarget = await canonical(target);
  if (canonicalTarget === await canonical(resolveHome())) return await ensureSharedWorkspace();
  const projects = [...(await listGlobalProjects()).values()];
  for (const project2 of projects) {
    if (project2.path !== void 0 && await canonical(project2.path) === canonicalTarget) return project2;
  }
  const displayName = basename(target) || (preferredName ?? "");
  const wanted = preferredName !== void 0 && preferredName !== "" ? preferredName : displayName;
  const generated = entityId(wanted, "url");
  const base = generated.ok ? generated.id : opaqueProjectId(canonicalTarget);
  const taken = new Set((await readdir4(registryRoot()).catch(() => [])).filter((name) => !name.startsWith(".")));
  const id = uniqueId(base, taken);
  const project = { schemaVersion: 1, id, name: displayName || id, path: target };
  await ensureSharedLayer(join6(registryRoot(), id), project);
  return project;
}
async function ensureGlobalProject(path, preferredName) {
  return registerGlobalProject(path, preferredName);
}

// src/tasks.ts
init_home();
import { mkdir as mkdir6, readFile as readFile7, readdir as readdir6, rename as rename3, stat as stat7, writeFile as writeFile8 } from "node:fs/promises";
import { join as join9 } from "node:path";

// src/task-worktree.ts
init_home();
import { execFile as execFile2 } from "node:child_process";
import { mkdir as mkdir5, readdir as readdir5, stat as stat5, writeFile as writeFile7 } from "node:fs/promises";
import { join as join7 } from "node:path";
import { promisify as promisify2 } from "node:util";

// src/worktree-identity.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var run = promisify(execFile);
var IDENTITY_DOMAIN = "lifeos.local";
function identityOf(agentId) {
  return { name: agentId, email: `${agentId}@${IDENTITY_DOMAIN}` };
}
async function git(cwd, args) {
  const { stdout } = await run("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], {
    timeout: 6e4,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" }
  });
  return stdout;
}
async function applyWorktreeIdentity(input) {
  const expected = identityOf(input.agentId);
  try {
    await git(input.worktree, ["config", "extensions.worktreeConfig", "true"]);
    await git(input.worktree, ["config", "--worktree", "user.name", expected.name]);
    await git(input.worktree, ["config", "--worktree", "user.email", expected.email]);
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] ?? "" : String(error);
    return { ok: false, reason: `\u5DE5\u4F5C\u533A\u8EAB\u4EFD\u5199\u5165\u5931\u8D25\uFF08${detail || "\u672A\u77E5\u9519\u8BEF"}\uFF09\uFF1A\u63D0\u4EA4\u524D\u663E\u5F0F\u4F20 -c user.name=${expected.name} -c user.email=${expected.email}` };
  }
}

// src/worktree-profile.ts
var SHARED_WORKSPACE = "workspace";
function escapeGlob(segment) {
  return segment.replace(/[\\*?[\]]/g, (ch) => `\\${ch}`);
}
function worktreeProfileOf(input) {
  const patterns = ["/*", "!/agents/*"];
  if (input.taskDirName === void 0) {
    patterns.push(`/agents/${escapeGlob(input.agentId)}/`);
  } else {
    const agent = `/agents/${escapeGlob(input.agentId)}`;
    patterns.push(
      `${agent}/AGENTS.md`,
      `${agent}/agent.json`,
      `${agent}/identity.md`,
      `${agent}/avatar/`,
      `${agent}/memory/`,
      `${agent}/tools/`
      // 协议 §4.1：Agent 本身的工具
    );
    if (input.projectId === void 0) {
      throw new Error("worktreeProfileOf\uFF1A\u4F20\u4E86 taskDirName \u5C31\u5FC5\u987B\u540C\u65F6\u4F20 projectId\uFF08Task ID \u53EA\u5728 Agent \xD7 Project \u5185\u552F\u4E00\uFF09");
    }
    patterns.push(
      `${agent}/projects/${escapeGlob(input.projectId)}/`,
      // Agent×project 层：specs / devices / tools / knowledge
      `!${agent}/projects/*/tasks/*`,
      // ① 先排除所有 tasks/*
      `${agent}/projects/${escapeGlob(input.projectId)}/tasks/${escapeGlob(input.taskDirName)}/`
      // ② 再放行本 Task
    );
  }
  patterns.push("!/projects/*", `/projects/${SHARED_WORKSPACE}/`);
  for (const project of input.boundProjects) {
    if (project === SHARED_WORKSPACE) continue;
    patterns.push(`/projects/${escapeGlob(project)}/`);
  }
  return patterns;
}

// src/task-worktree.ts
var run2 = promisify2(execFile2);
var HOME_DIR = "home";
var REPO_DIR = "repo";
var MARKER_FILE = ".lifeos-worktree.json";
async function git2(cwd, args, maxBuffer = 16 * 1024 * 1024) {
  const { stdout } = await run2("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], {
    timeout: 12e4,
    maxBuffer,
    env: { ...process.env, LC_ALL: "C" }
  });
  return stdout;
}
async function isRegisteredWorktree(dir) {
  const marker = await stat5(join7(dir, MARKER_FILE)).then((info) => info.isFile(), () => false);
  if (marker) return true;
  return exists(join7(dir, ".git"));
}
var exists = (path) => stat5(path).then(() => true, () => false);
async function isGitRepo(path) {
  try {
    await git2(path, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}
async function baseRefOf(repo) {
  try {
    await git2(repo, ["rev-parse", "--verify", "--quiet", "main"]);
    return "main";
  } catch {
    return (await git2(repo, ["rev-parse", "--short", "HEAD"])).trim();
  }
}
async function archiveIfDirty(repo) {
  const status = (await git2(repo, ["status", "--porcelain"])).trim();
  if (status === "") return false;
  await git2(repo, ["add", "-A"]);
  await git2(repo, [
    "-c",
    "user.name=Life OS",
    "-c",
    "user.email=lifeos@localhost",
    "commit",
    "-q",
    "-m",
    "chore: \u5EFA Task \u5DE5\u4F5C\u533A\u524D\u5B58\u6863\uFF08\u81EA\u52A8\uFF09"
  ]);
  return true;
}
async function writeMarker(worktreePath, marker) {
  await writeFile7(join7(worktreePath, MARKER_FILE), `${JSON.stringify(marker, null, 2)}
`, { encoding: "utf8", mode: 384 });
}
async function identitySkipOf(worktree, agentId) {
  const applied = await applyWorktreeIdentity({ worktree, agentId });
  return applied.ok ? {} : { identitySkipped: applied.reason };
}
async function createHomeWorktree(input) {
  const home2 = resolveHome();
  if (!await isGitRepo(home2)) return { skipped: "\u5BB6\u76EE\u5F55\u4E0D\u662F git \u4ED3\uFF08\u6CA1\u6709 init \u8FC7\uFF09\uFF0C\u8DF3\u8FC7\u5BB6\u76EE\u5F55\u5DE5\u4F5C\u533A" };
  const path = join7(input.taskDir, HOME_DIR);
  const branch = `task/${input.agentId}/${input.projectId}/${input.taskId}`;
  const base = await baseRefOf(home2);
  const archived = await archiveIfDirty(home2);
  await git2(home2, ["worktree", "add", "--no-checkout", path, "-b", branch, base]);
  try {
    const profile = worktreeProfileOf({
      agentId: input.agentId,
      boundProjects: input.boundProjects,
      ...input.taskDirName !== void 0 ? { taskDirName: input.taskDirName, projectId: input.projectId } : {}
    });
    await git2(path, ["sparse-checkout", "set", "--no-cone", ...profile]);
    await git2(path, ["read-tree", "-mu", "HEAD"]);
    await writeMarker(path, {
      kind: "home",
      taskId: input.taskId,
      agentId: input.agentId,
      baseBranch: base,
      branch,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return { path, archived, ...await identitySkipOf(path, input.agentId) };
  } catch (error) {
    await removeWorktree(home2, path).catch(() => void 0);
    throw error;
  }
}
async function createProjectWorktree(input) {
  if (!await isGitRepo(input.projectPath)) return { skipped: "\u9879\u76EE\u76EE\u5F55\u4E0D\u662F git \u4ED3\uFF0C\u8DF3\u8FC7\u9879\u76EE\u5DE5\u4F5C\u533A" };
  const path = join7(input.taskDir, REPO_DIR);
  const branch = `dev/${input.agentId}/${input.projectId}/${input.taskId}`;
  const base = await baseRefOf(input.projectPath);
  await git2(input.projectPath, ["worktree", "add", path, "-b", branch, base]);
  try {
    await writeMarker(path, {
      kind: "project",
      taskId: input.taskId,
      projectId: input.projectId,
      agentId: input.agentId,
      baseBranch: base,
      branch,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return { path, ...await identitySkipOf(path, input.agentId) };
  } catch (error) {
    await removeWorktree(input.projectPath, path).catch(() => void 0);
    throw error;
  }
}
async function removeWorktree(repo, path) {
  await run2("git", ["-C", repo, "worktree", "remove", "--force", path], { timeout: 12e4 }).catch(() => void 0);
  await run2("git", ["-C", repo, "worktree", "prune"], { timeout: 6e4 }).catch(() => void 0);
}
async function boundProjectsOf(agentId) {
  const root = join7(resolveHome(), "agents", agentId, "projects");
  const entries = await readdir5(root, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}
async function createTaskWorktrees(input) {
  const skipped = [];
  const created = {};
  const boundProjects = await boundProjectsOf(input.agentId);
  const taskDirName = input.taskDir.split("/").pop() ?? "";
  const home2 = await createHomeWorktree({
    taskDir: input.taskDir,
    taskId: input.taskId,
    agentId: input.agentId,
    projectId: input.projectId,
    boundProjects,
    ...taskDirName !== "" ? { taskDirName } : {}
  });
  if (home2.path !== void 0) created.home = home2.path;
  if (home2.skipped !== void 0) skipped.push(home2.skipped);
  if (home2.identitySkipped !== void 0) skipped.push(home2.identitySkipped);
  if (input.projectPath !== void 0 && input.projectPath !== "") {
    const project = await createProjectWorktree({
      taskDir: input.taskDir,
      taskId: input.taskId,
      agentId: input.agentId,
      projectId: input.projectId,
      projectPath: input.projectPath
    });
    if (project.path !== void 0) created.project = project.path;
    if (project.skipped !== void 0) skipped.push(project.skipped);
    if (project.identitySkipped !== void 0) skipped.push(project.identitySkipped);
  } else {
    skipped.push(`\u9879\u76EE ${input.projectId} \u6CA1\u6709 path\uFF08\u4E0D\u662F\u4EE3\u7801\u4ED3\uFF09\uFF0C\u53EA\u6709\u5BB6\u76EE\u5F55\u5DE5\u4F5C\u533A`);
  }
  const docRoot = created.home === void 0 ? input.taskDir : join7(created.home, "agents", input.agentId, "projects", input.projectId, "tasks", input.taskDir.split("/").pop() ?? "");
  if (created.home !== void 0) await mkdir5(docRoot, { recursive: true, mode: 448 });
  return { docRoot, created, skipped };
}

// src/task-doc-path.ts
import { stat as stat6 } from "node:fs/promises";
import { join as join8 } from "node:path";
function taskWorktreeDocPathOf(taskDir, scope, dirName) {
  return join8(taskDir, HOME_DIR, "agents", scope.agentId, "projects", scope.projectId, "tasks", dirName);
}
async function taskDocRootOf(taskDir, scope, dirName) {
  const inWorktree = taskWorktreeDocPathOf(taskDir, scope, dirName);
  const info = await stat6(join8(inWorktree, "task.md")).catch(() => void 0);
  return info?.isFile() === true ? inWorktree : taskDir;
}

// src/tasks.ts
var tasksRoot = (ctx) => join9(resolveHome(), "agents", ctx.agentId, "projects", ctx.projectId, "tasks");
var projectDir = (ctx) => join9(resolveHome(), "agents", ctx.agentId, "projects", ctx.projectId);
async function taskDocPathOf(ctx, dirName) {
  return taskDocRootOf(join9(tasksRoot(ctx), dirName), ctx, dirName);
}
var isDoc = (value) => {
  if (typeof value !== "object" || value === null) return false;
  const doc = value;
  return typeof doc.file === "string" && doc.file !== "" && typeof doc.title === "string" && doc.title !== "" && Array.isArray(doc.sections) && doc.sections.every((section) => typeof section === "string");
};
var parseTemplate = (raw) => {
  try {
    const data = JSON.parse(raw);
    if (data.schemaVersion !== 1 || typeof data.type !== "string" || typeof data.categories !== "object" || data.categories === null) return void 0;
    const categories = {};
    for (const [key, value] of Object.entries(data.categories)) {
      if (typeof value !== "object" || value === null) return void 0;
      const category = value;
      if (typeof category.label !== "string" || !Array.isArray(category.docs) || !category.docs.every(isDoc)) return void 0;
      const extraDirs = Array.isArray(category.extraDirs) ? category.extraDirs.filter((dir) => typeof dir === "string" && dir !== "" && !dir.includes("/") && !dir.includes("..")) : [];
      categories[key] = { label: category.label, docs: category.docs, ...extraDirs.length > 0 ? { extraDirs } : {} };
    }
    return { schemaVersion: 1, type: data.type, categories };
  } catch {
    return void 0;
  }
};
function templateCandidates(ctx, type) {
  const home2 = resolveHome();
  const paths = [
    join9(home2, "agents", ctx.agentId, "projects", ctx.projectId, "task-types", type),
    join9(home2, "projects", ctx.projectId, "task-types", type),
    join9(home2, "interaction-harness", "task-types", type)
  ];
  return [...new Set(paths)];
}
async function resolveTaskTemplate(ctx, type) {
  for (const dir of templateCandidates(ctx, type)) {
    const raw = await readFile7(join9(dir, "template.json"), "utf8").catch(() => void 0);
    if (raw === void 0) continue;
    const template = parseTemplate(raw);
    if (template === void 0) return { code: "invalid_template", message: `\u4EFB\u52A1\u6A21\u677F\u635F\u574F\uFF1A${join9(dir, "template.json")}` };
    if (template.type !== type) return { code: "invalid_template", message: `\u4EFB\u52A1\u6A21\u677F\u7C7B\u578B\u4E0D\u5339\u914D\uFF1A${join9(dir, "template.json")}\uFF08\u5E94\u4E3A ${type}\uFF09` };
    return { template, source: dir };
  }
  return { code: "template_not_found", message: `\u627E\u4E0D\u5230 ${type} \u7684\u4EFB\u52A1\u6A21\u677F` };
}
var docSkeleton = (title, sections) => [`# ${title}`, "", ...sections.flatMap((section) => [`## ${section}`, "", "\uFF08\u5F85\u586B\uFF09", ""])].join("\n");
function localDate2(now = /* @__PURE__ */ new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
async function nextTaskNumber(ctx) {
  const entries = await readdir6(tasksRoot(ctx), { withFileTypes: true }).catch(() => []);
  let max = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = /^(\d{4})-/.exec(entry.name);
    if (match !== null) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}
async function resolveTaskDir(ctx, idOrDirName) {
  const match = /^(\d{4})(?:-|$)/.exec(idOrDirName);
  if (match === null) return void 0;
  const entries = await readdir6(tasksRoot(ctx), { withFileTypes: true }).catch(() => []);
  const entry = entries.find((candidate) => candidate.isDirectory() && (candidate.name === idOrDirName || candidate.name.startsWith(`${match[1]}-`)));
  return entry === void 0 ? void 0 : join9(tasksRoot(ctx), entry.name);
}
async function resolveTaskDocDir(ctx, idOrDirName) {
  const match = /^(\d{4})(?:-|$)/.exec(idOrDirName);
  if (match === null) return void 0;
  const entries = await readdir6(tasksRoot(ctx), { withFileTypes: true }).catch(() => []);
  const entry = entries.find((candidate) => candidate.isDirectory() && (candidate.name === idOrDirName || candidate.name.startsWith(`${match[1]}-`)));
  return entry === void 0 ? void 0 : await taskDocPathOf(ctx, entry.name);
}
var CODE_SPECS = [
  ["frontend", "specs/code/frontend/code.md"],
  ["backend", "specs/code/backend/code.md"],
  ["testing", "specs/code/testing/testing.md"],
  ["api", "specs/code/api/api.md"],
  ["architecture", "specs/code/architecture/architecture.md"]
];
var PROJECT_RULES = [
  ["\u5F00\u53D1\u843D\u70B9", "specs/development-harness/development-harness.md"],
  ["\u68C0\u89C6\u6D41\u7A0B", "specs/review/review.md"],
  ["\u53C2\u8003\u57FA\u7EBF", "knowledge/reference-baseline.md"]
];
async function codeSpecLines(home2, pid, taskType) {
  const codeTypes = /* @__PURE__ */ new Set(["development", "troubleshooting"]);
  if (taskType !== void 0 && !codeTypes.has(taskType)) return [];
  const projBase = join9(home2, "projects", pid);
  const files = [];
  for (const [, rel] of CODE_SPECS) {
    const exists2 = await stat7(join9(projBase, rel)).then(() => true, () => false);
    if (exists2) files.push(rel);
  }
  if (files.length === 0) return [];
  return [`- \u4EE3\u7801\u89C4\u8303\uFF08\u6309\u73AF\u8282\u9010\u4E2A\u5BF9\u7167\uFF09\uFF1A${files.map((rel) => join9(projBase, rel)).join(" \xB7 ")}`];
}
async function projectRuleLines(home2, pid) {
  const projBase = join9(home2, "projects", pid);
  const found = await Promise.all(PROJECT_RULES.map(async ([label, rel]) => {
    const path = join9(projBase, rel);
    return await stat7(path).then(() => true, () => false) ? { label, path } : void 0;
  }));
  const present = found.filter((x) => x !== void 0);
  if (present.length === 0) return [];
  const labels = present.map((x) => x.label).join(" / ");
  const paths = present.map((x) => x.path).join(" \xB7 ");
  return [`- \u672C\u9879\u76EE\u89C4\u8303\u4E0E\u6D41\u7A0B\uFF08${labels}\uFF09\uFF1A${paths}`];
}
async function referenceBlock(ctx, typeRulesDir, type) {
  const home2 = resolveHome();
  const lines = [
    "## \u672C\u4EFB\u52A1\u9075\u5B88",
    "",
    `- \u534F\u8BAE\uFF1A${join9(home2, "interaction-harness", "protocol.md")}`,
    `- \u7C7B\u578B\u89C4\u5219\uFF1A${join9(typeRulesDir, "AGENTS.md")}`,
    `- \u5171\u4EAB workspace \u89C4\u8303\uFF1A${join9(home2, "projects", "workspace", "specs")}/`,
    ...await codeSpecLines(home2, ctx.projectId, type),
    ...await projectRuleLines(home2, ctx.projectId)
  ];
  if (ctx.projectId !== "workspace") lines.push(`- \u9879\u76EE\u5171\u4EAB\u89C4\u8303\uFF1A${join9(home2, "projects", ctx.projectId, "specs")}/`);
  lines.push(`- Agent \xD7 \u9879\u76EE\u89C4\u8303\uFF1A${join9(projectDir(ctx), "specs")}/`);
  const manifest = await readProjectManifest(ctx.agentId, ctx.projectId);
  if (manifest !== void 0) {
    const repoGuide = join9(manifest.path, "AGENTS.md");
    if (await readFile7(repoGuide, "utf8").then(() => true, () => false)) lines.push(`- \u9879\u76EE\u4ED3\u5E93\u7EA6\u5B9A\uFF1A${repoGuide}`);
  }
  lines.push("");
  return lines;
}
async function materialize(ctx, input, docDir) {
  const id = String(input.number).padStart(4, "0");
  const dir = join9(tasksRoot(ctx), input.dirName);
  await mkdir6(dir, { recursive: true, mode: 448 });
  const doc = docDir ?? dir;
  if (doc !== dir) await mkdir6(doc, { recursive: true, mode: 448 });
  await ensureTaskSkeleton(doc);
  for (const extra of input.extraDirs) {
    const sub = join9(doc, extra);
    await mkdir6(sub, { recursive: true, mode: 448 });
    await writeFile8(join9(sub, "AGENTS.md"), await skeletonText(extra), { encoding: "utf8", mode: 384, flag: "wx" }).catch(() => {
    });
  }
  const taskMd = [
    `# ${input.title}`,
    "",
    `ID: ${id}`,
    `\u7C7B\u578B\uFF1A${input.type}`,
    `\u7C7B\u522B\uFF1A${input.categoryLabel}`,
    "\u72B6\u6001\uFF1A\u8FDB\u884C\u4E2D",
    // Task 0015 · T12：`负责人/记录者` 替掉。两者原来是**同一个变量的两份拷贝**（永远相等），
    // 且代码从不读它们（只有一条正则断言），而人已经手改过 8 个 task.md 表达"谁参与"。
    // 现在：归属 = owner（可校验，必须等于目录的 agentId）+ 参与者（≥0，含其他 Agent 与用户，**可不含用户**）。
    `\u5F52\u5C5E\uFF1A${ctx.agentId}/${ctx.projectId}/${id}`,
    `\u53C2\u4E0E\u8005\uFF1A${(input.participants ?? []).length > 0 ? input.participants.join(", ") : "\u2014"}`,
    ...input.date !== void 0 ? [`\u65E5\u671F\uFF1A${input.date}`] : [],
    `\u76EE\u6807\uFF1A${input.goal}`,
    `\u5FC5\u9700\u6587\u6863\uFF1A${input.requiredDocs.join(" \xB7 ")}`,
    `\u5F53\u524D\u6307\u9488\uFF1A${input.pointer}`,
    "",
    ...await referenceBlock(ctx, input.typeRulesDir, input.type)
  ].join("\n");
  await writeFile8(join9(doc, "task.md"), taskMd, { encoding: "utf8", mode: 384, flag: "wx" }).catch(() => {
  });
  for (const docTemplate of input.docs) {
    await writeFile8(join9(doc, docTemplate.file), docSkeleton(docTemplate.title, docTemplate.sections), { encoding: "utf8", mode: 384, flag: "wx" }).catch(() => {
    });
  }
  return {
    id,
    dirName: input.dirName,
    number: input.number,
    title: input.title,
    type: input.type,
    category: input.categoryLabel,
    status: "\u8FDB\u884C\u4E2D",
    goal: input.goal,
    path: dir,
    docPath: doc,
    ...input.date !== void 0 ? { date: input.date } : {},
    isDefault: input.type === "daily",
    participants: input.participants ?? [],
    docs: input.requiredDocs
  };
}
async function createTask(ctx, input) {
  const title = (input.title ?? "").trim();
  if (title === "") return { code: "invalid_title", message: "title \u4E0D\u80FD\u4E3A\u7A7A" };
  const type = (input.type ?? "development").trim();
  if (type === "daily") {
    return { code: "reserved_type", message: "daily \u662F\u7CFB\u7EDF\u4FDD\u7559\u7684\u7C7B\u578B\uFF08\u9ED8\u8BA4 Task \u7531\u7CFB\u7EDF\u7EF4\u62A4\uFF09\uFF0C\u4E0D\u80FD\u624B\u52A8\u65B0\u5EFA" };
  }
  if (!/^[a-z][a-z0-9-]*$/.test(type)) {
    return { code: "invalid_type", message: "type \u7528\u5C0F\u5199\u82F1\u6587\u4E0E\u8FDE\u5B57\u7B26\uFF0C\u5982 development\u3001general\u3001backend-api" };
  }
  const resolved = await resolveTaskTemplate(ctx, type);
  if ("code" in resolved) {
    return { code: resolved.code, message: `${resolved.message}\u3002\u6CA1\u6709\u5408\u9002\u7684\u7C7B\u578B\u65F6\uFF0C\u5148\u548C\u7528\u6237\u8BA8\u8BBA\uFF0C\u518D\u5728 task-types/${type}/ \u4E0B\u5EFA template.json \u4E0E AGENTS.md` };
  }
  const categoryTemplate = resolved.template.categories[input.category];
  if (categoryTemplate === void 0) {
    const allowed = Object.keys(resolved.template.categories).join(" / ");
    return { code: "invalid_category", message: `\u7C7B\u578B ${type} \u7684 category \u5FC5\u987B\u662F ${allowed}\uFF08\u6A21\u677F ${resolved.source}\uFF09` };
  }
  const manifest = await readProjectManifest(ctx.agentId, ctx.projectId);
  if (manifest === void 0 && ctx.projectId !== "workspace") {
    const info = await stat7(projectDir(ctx)).catch(() => void 0);
    if (info === void 0 || !info.isDirectory()) return { code: "project_not_found", message: `\u627E\u4E0D\u5230\u9879\u76EE ${ctx.projectId}` };
  }
  const number = await nextTaskNumber(ctx);
  const id = String(number).padStart(4, "0");
  const dirName = `${id}-${sanitizeSegment(title)}`;
  const taskDir = join9(tasksRoot(ctx), dirName);
  const worktrees = await createTaskWorktrees({
    taskDir,
    taskId: id,
    agentId: ctx.agentId,
    projectId: ctx.projectId,
    ...manifest?.path !== void 0 ? { projectPath: manifest.path } : {}
  });
  const goalInput = (input.goal ?? "").trim();
  const task = await materialize(ctx, {
    number,
    title,
    type,
    categoryLabel: categoryTemplate.label,
    goal: goalInput === "" ? title : goalInput,
    dirName,
    date: input.date ?? localDate2(),
    requiredDocs: [...categoryTemplate.docs.map((doc) => doc.file), ...(categoryTemplate.extraDirs ?? []).map((dir) => `${dir}/`)],
    extraDirs: categoryTemplate.extraDirs ?? [],
    docs: categoryTemplate.docs,
    typeRulesDir: resolved.source,
    pointer: "\uFF08\u4E0B\u4E00\u6B65\u505A\u4EC0\u4E48 / \u5361\u5728\u54EA\u2014\u2014\u72B6\u6001\u53EA\u5199\u5728\u8FD9\u91CC\uFF09"
  }, worktrees.docRoot);
  return { task, ...worktrees.skipped.length === 0 ? {} : { skipped: worktrees.skipped } };
}
var defaultLocks = /* @__PURE__ */ new Map();
async function ensureDefaultTask(ctx) {
  const key = `${ctx.agentId}\0${ctx.projectId}`;
  const running2 = defaultLocks.get(key);
  if (running2 !== void 0) return await running2;
  const work = (async () => {
    const existing = (await listTasks(ctx)).find((task) => task.isDefault === true);
    if (existing !== void 0) return existing;
    const resolved = await resolveTaskTemplate(ctx, "daily");
    if ("code" in resolved) throw new Error(resolved.message);
    const categoryTemplate = resolved.template.categories.D;
    if (categoryTemplate === void 0) throw new Error("daily \u6A21\u677F\u7F3A\u5C11 D \u7C7B\u522B");
    const number = await nextTaskNumber(ctx);
    const id = String(number).padStart(4, "0");
    const dirName = `${id}-default`;
    const manifest = await readProjectManifest(ctx.agentId, ctx.projectId);
    const worktrees = await createTaskWorktrees({
      taskDir: join9(tasksRoot(ctx), dirName),
      taskId: id,
      agentId: ctx.agentId,
      projectId: ctx.projectId,
      ...manifest?.path !== void 0 ? { projectPath: manifest.path } : {}
    });
    return await materialize(ctx, {
      number,
      title: "\u9ED8\u8BA4",
      type: "daily",
      categoryLabel: categoryTemplate.label,
      goal: "\u65E5\u5E38\u5BF9\u8BDD\u7684\u5165\u53E3\uFF1A\u6CA1\u6709\u660E\u786E Task \u65F6\u7684\u4EA4\u4E92\u90FD\u5F52\u5230\u8FD9\u91CC\uFF1B\u6309\u672C\u5730\u65E5\u671F\u8BB0\u5165 daily/<\u65E5\u671F>.md\uFF0C\u53EA\u6709\u53D1\u751F\u4EA4\u4E92\u7684\u65E5\u5B50\u624D\u6709\u5206\u7247",
      dirName,
      requiredDocs: ["daily/\uFF08\u6309\u5929\u5206\u7247\uFF09"],
      extraDirs: categoryTemplate.extraDirs ?? [],
      docs: categoryTemplate.docs,
      typeRulesDir: resolved.source,
      pointer: "\u6309\u65E5\u671F\u5206\u7247\uFF1A\u53D1\u8D77\u5BF9\u8BDD\u7684\u90A3\u4E00\u5929\u5EFA daily/<\u65E5\u671F>.md\uFF1B\u6CA1\u6709\u4EA4\u4E92\u7684\u65E5\u5B50\u6CA1\u6709\u5206\u7247"
    }, worktrees.docRoot);
  })().finally(() => {
    defaultLocks.delete(key);
  });
  defaultLocks.set(key, work);
  return await work;
}
async function ensureDailyShard(ctx, date = localDate2()) {
  const task = await ensureDefaultTask(ctx);
  const file = join9(task.docPath, "daily", `${date}.md`);
  await mkdir6(join9(task.docPath, "daily"), { recursive: true, mode: 448 });
  await writeFile8(file, `# ${date}

`, { encoding: "utf8", mode: 384, flag: "wx" }).catch(() => {
  });
  return { task, file };
}
function parseParticipants(text, participantsField, ownerField, recorderField, belongField) {
  const split = (value) => value.split(/[,，、]/).map((item) => item.trim()).filter((item) => item !== "" && item !== "\u2014");
  const legacyOwnerFromLine = (ownerField.split("\uFF5C")[0] ?? "").trim().replace(/^负责人：/, "");
  const owner = belongField !== "" ? belongField.split("/")[0]?.trim() : legacyOwnerFromLine !== "" ? legacyOwnerFromLine : void 0;
  const explicit = participantsField !== "" ? split(participantsField) : [];
  const legacy = [];
  const [ownerRaw, recorderRaw] = ownerField.split("\uFF5C");
  const legacyOwner = (ownerRaw ?? "").trim().replace(/^负责人：/, "");
  const legacyRecorder = (recorderRaw ?? recorderField).trim().replace(/^记录者：/, "");
  if (legacyRecorder !== "" && legacyRecorder !== legacyOwner) {
    legacy.push(legacyRecorder);
  }
  const merged = [...explicit, ...legacy].filter((item, index, all) => all.indexOf(item) === index);
  return owner !== void 0 && owner !== "" ? merged.filter((item) => item !== owner) : merged;
}
async function listTasks(ctx) {
  const entries = await readdir6(tasksRoot(ctx), { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = /^(\d{4})-(.+)$/.exec(entry.name);
    if (match === null) continue;
    const dir = join9(tasksRoot(ctx), entry.name);
    const docPath = await taskDocPathOf(ctx, entry.name);
    const text = await readFile7(join9(docPath, "task.md"), "utf8").catch(() => void 0);
    if (text === void 0) continue;
    const field = (label) => {
      const line = text.split("\n").find((candidate) => candidate.startsWith(`${label}\uFF1A`) || candidate.startsWith(`${label}:`));
      if (line === void 0) return "";
      return line.slice(line.indexOf(label) + label.length + 1).trim();
    };
    const date = field("\u65E5\u671F");
    const type = field("\u7C7B\u578B");
    const participants = parseParticipants(text, field("\u53C2\u4E0E\u8005"), field("\u8D1F\u8D23\u4EBA"), field("\u8BB0\u5F55\u8005"), field("\u5F52\u5C5E"));
    out.push({
      id: match[1] ?? "",
      dirName: entry.name,
      number: Number(match[1]),
      title: (text.split("\n")[0] ?? "").replace(/^#\s*/, ""),
      type,
      category: field("\u7C7B\u522B"),
      status: field("\u72B6\u6001"),
      goal: field("\u76EE\u6807"),
      path: dir,
      docPath,
      ...date !== "" ? { date } : {},
      isDefault: type === "daily",
      participants
    });
  }
  return out.sort((a, b) => a.number - b.number);
}
async function addTaskParticipant(ctx, taskId, participant) {
  const name = participant.trim();
  if (name === "" || name === "\u2014") return { ok: false, message: "\u53C2\u4E0E\u8005\u540D\u5B57\u4E0D\u80FD\u4E3A\u7A7A" };
  const task = (await listTasks(ctx)).find((item) => item.id === taskId);
  if (task === void 0) return { ok: false, message: `\u627E\u4E0D\u5230 Task ${taskId}` };
  if ((task.participants ?? []).includes(name)) {
    return { ok: true, added: false, participants: task.participants ?? [] };
  }
  const file = join9(task.docPath, "task.md");
  const text = await readFile7(file, "utf8").catch(() => void 0);
  if (text === void 0) return { ok: false, message: `\u8BFB\u4E0D\u5230 ${file}` };
  const next = task.participants !== void 0 && task.participants.length > 0 ? [...task.participants, name] : [name];
  const line = `\u53C2\u4E0E\u8005\uFF1A${next.join(", ")}`;
  const lines = text.split("\n");
  const index = lines.findIndex((candidate) => /^参与者[：:]/.test(candidate));
  if (index === -1) {
    return { ok: false, message: "\u8FD9\u4E2A task.md \u6CA1\u6709 `\u53C2\u4E0E\u8005\uFF1A` \u884C\uFF08\u8001\u683C\u5F0F\uFF09\uFF1A\u4E0D\u81EA\u52A8\u6539\uFF0C\u7B49\u4EBA\u5DE5\u51B3\u5B9A\u8981\u4E0D\u8981\u8865" };
  }
  lines[index] = line;
  const tmp = `${file}.tmp`;
  await writeFile8(tmp, lines.join("\n"), { encoding: "utf8", mode: 384 });
  await rename3(tmp, file);
  return { ok: true, added: true, participants: next };
}

// src/agents.ts
init_home();
import { mkdir as mkdir7, readFile as readFile8, readdir as readdir7, rm as rm3, stat as stat8, writeFile as writeFile9, rename as rename4 } from "node:fs/promises";
import { join as join10 } from "node:path";

// src/session-runtime.ts
init_home();
var running = /* @__PURE__ */ new Map();
var keyOf = (agentId) => `${resolveHome()}\0${agentId}`;
function bucket(agentId) {
  const key = keyOf(agentId);
  const existing = running.get(key);
  if (existing !== void 0) return existing;
  const created = /* @__PURE__ */ new Map();
  running.set(key, created);
  return created;
}
function markRunning(agentId, snapshot2) {
  bucket(agentId).set(snapshot2.sessionId, snapshot2);
}
function clearRunning(agentId, sessionId) {
  bucket(agentId).delete(sessionId);
}
function isRunning(agentId, sessionId) {
  return bucket(agentId).has(sessionId);
}
function runningOf(agentId) {
  return [...bucket(agentId).values()];
}
function runningAll() {
  const prefix = `${resolveHome()}\0`;
  const out = [];
  for (const [key, sessions] of running) {
    if (!key.startsWith(prefix)) continue;
    const agentId = key.slice(prefix.length);
    for (const snapshot2 of sessions.values()) out.push({ agentId, ...snapshot2 });
  }
  return out;
}
var draining = false;
var drainingSince;
var DRAIN_TTL_MS = 6e4;
function setDraining(value) {
  draining = value;
  drainingSince = value ? Date.now() : void 0;
}
function isDraining() {
  return draining;
}
function expireDrainIfStale(now = Date.now()) {
  if (!draining || drainingSince === void 0) return void 0;
  const forMs = now - drainingSince;
  if (forMs <= DRAIN_TTL_MS) return void 0;
  draining = false;
  drainingSince = void 0;
  return forMs;
}
function drainingForMs() {
  return draining && drainingSince !== void 0 ? Date.now() - drainingSince : void 0;
}

// src/agents.ts
var agentsRoot = () => join10(resolveHome(), "agents");
var agentDir = (id) => join10(agentsRoot(), id);
var isSlug = (id) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
var readJson = async (path) => readFile8(path, "utf8").then((text) => JSON.parse(text), () => void 0);
async function writeJson(path, data) {
  const tmp = `${path}.tmp`;
  await writeFile9(tmp, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", mode: 384 });
  await rename4(tmp, path);
}
async function allAgents() {
  const entries = await readdir7(agentsRoot(), { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const raw = await readJson(join10(agentsRoot(), entry.name, "agent.json"));
    if (raw !== void 0 && typeof raw.id === "string") out.push({ id: entry.name, record: raw });
  }
  return out;
}
var identitySkeleton = (name) => `# ${name}

\uFF08\u4E00\u53E5\u8BDD\uFF1A\u8FD9\u4E2A Agent \u662F\u8C01\u3001\u957F\u671F\u8D1F\u8D23\u4EC0\u4E48\u3002\uFF09

## \u8EAB\u4EFD

- \u540D\u79F0\uFF1A${name}
- \u89D2\u8272\uFF1A\uFF08\u5F85\u586B\uFF09

## \u4EBA\u683C

- \uFF08\u5F85\u586B\uFF1A\u53E3\u543B\u3001\u98CE\u683C\u3001\u534F\u4F5C\u8FB9\u754C\u3002\uFF09
`;
async function createAgent(input) {
  const name = (input.name ?? "").trim().slice(0, 60);
  if (name === "") return { code: "invalid_name", message: "name \u4E0D\u80FD\u4E3A\u7A7A", status: 400 };
  const description = input.description !== void 0 ? input.description.trim().slice(0, 300) : void 0;
  const live = (await allAgents()).find((entry) => entry.record.archivedAt === void 0 && entry.record.name === name);
  if (live !== void 0) {
    return { id: live.id, name: live.record.name, dir: agentDir(live.id), created: false };
  }
  const generated = entityId(name, "url");
  if (!generated.ok) return { code: "needs_ascii_name", message: generated.message, status: 400 };
  const existing = new Set((await allAgents()).map((entry) => entry.id));
  const id = uniqueId(generated.id, existing);
  if (!isSlug(id)) return { code: "invalid_id", message: "\u65E0\u6CD5\u4ECE name \u751F\u6210\u5408\u6CD5 id", status: 400 };
  const dir = agentDir(id);
  try {
    try {
      await mkdir7(dir, { mode: 448 });
    } catch (error) {
      if (await stat8(dir).catch(() => void 0) !== void 0) {
        return { code: "id_taken", message: `\u76EE\u5F55\u5DF2\u5B58\u5728\uFF1A${id}`, status: 400 };
      }
      throw error;
    }
    const record = {
      schemaVersion: 1,
      id,
      name,
      ...description !== void 0 && description !== "" ? { description } : {},
      defaultProjectId: "workspace"
    };
    await writeJson(join10(dir, "agent.json"), record);
    await writeFile9(join10(dir, "identity.md"), identitySkeleton(name), { encoding: "utf8", mode: 384 });
    await ensureAgentLayer(dir);
    const workspace = join10(dir, "projects", "workspace");
    await ensureAgentProjectLayer(workspace);
    await ensureDefaultTask({ agentId: id, projectId: "workspace" });
    broadcast({ type: "agents_changed" });
    return { id, name, dir, created: true };
  } catch (error) {
    await rm3(dir, { recursive: true, force: true }).catch(() => {
    });
    return { code: "create_failed", message: error instanceof Error ? error.message : String(error), status: 400 };
  }
}
async function readAgent(id) {
  const raw = await readJson(join10(agentDir(id), "agent.json"));
  if (raw === void 0 || typeof raw.id !== "string") return void 0;
  const { boundProjectIds: legacy, ...clean } = raw;
  if (legacy !== void 0) await writeAgent(clean);
  return clean;
}
async function writeAgent(agent) {
  const { boundProjectIds: _legacy, ...clean } = agent;
  const path = join10(agentDir(agent.id), "agent.json");
  const tmp = `${path}.tmp`;
  await writeFile9(tmp, JSON.stringify(clean, null, 2) + "\n", { encoding: "utf8", mode: 384 });
  await rename4(tmp, path);
}
async function archiveAgent(id) {
  if (!isSlug(id)) return { code: "not_found", message: "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", status: 404 };
  const path = join10(agentDir(id), "agent.json");
  const raw = await readJson(path);
  if (raw === void 0 || typeof raw.id !== "string") return { code: "not_found", message: "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", status: 404 };
  if (raw.archivedAt !== void 0) return { code: "not_found", message: "\u8BE5 Agent \u5DF2\u5F52\u6863", status: 404 };
  if (runningOf(id).length > 0) return { code: "agent_running", message: "\u8BE5 Agent \u6709\u4F1A\u8BDD\u6B63\u5728\u8FD0\u884C\uFF0C\u5148\u7B49\u5B83\u7ED3\u675F", status: 409 };
  const alive = (await allAgents()).filter((entry) => entry.record.archivedAt === void 0);
  if (alive.length <= 1) return { code: "last_agent", message: "\u81F3\u5C11\u4FDD\u7559\u4E00\u4E2A Agent", status: 400 };
  await writeJson(path, { ...raw, archivedAt: (/* @__PURE__ */ new Date()).toISOString() });
  broadcast({ type: "agents_changed" });
  return { archived: id };
}

// src/projects.ts
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var agentProjectsRoot = (agentId) => join11(resolveHome(), "agents", agentId, "projects");
async function readProjectManifest(agentId, pid) {
  if (pid === "workspace") return void 0;
  if (!await stat9(join11(agentProjectsRoot(agentId), pid)).then((info) => info.isDirectory(), () => false)) return void 0;
  const global = await readGlobalProject(pid);
  if (global === void 0 || global.path === void 0) return void 0;
  return { schemaVersion: 1, id: global.id, name: global.name, path: global.path };
}
async function readProjectManifests(agentId) {
  const out = /* @__PURE__ */ new Map();
  for (const dir of await scanProjectDirs(agentId)) {
    if (UUID_RE.test(dir)) continue;
    const manifest = await readProjectManifest(agentId, dir);
    if (manifest !== void 0) {
      await ensureAgentProjectLayer(join11(agentProjectsRoot(agentId), dir));
      const global = await ensureGlobalProject(manifest.path, manifest.id);
      out.set(global.id === manifest.id ? manifest.id : dir, global.id === manifest.id ? manifest : { ...manifest, id: dir });
    }
  }
  return out;
}
async function scanProjectDirs(agentId) {
  const entries = await readdir8(agentProjectsRoot(agentId), { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).sort();
}
async function listAgentProjects(agentId) {
  const agent = await readAgent(agentId);
  if (agent === void 0) return [];
  const defaultId = agent.defaultProjectId ?? "workspace";
  const manifests = await readProjectManifests(agentId);
  const hidden = new Set(agent.hiddenProjectIds ?? []);
  const items = [];
  for (const dir of await scanProjectDirs(agentId)) {
    if (hidden.has(dir)) continue;
    const manifest = manifests.get(dir);
    const global = dir === "workspace" ? void 0 : await readGlobalProject(dir).catch(() => void 0);
    const name = dir === "workspace" ? "workspace" : global !== void 0 && global.name.trim() !== "" ? global.name.trim() : manifest !== void 0 ? basename2(manifest.path) || dir : dir;
    const icon = global?.icon;
    const path = dir === "workspace" ? void 0 : manifest?.path ?? join11(agentProjectsRoot(agentId), dir);
    items.push({ id: dir, name, isDefault: dir === defaultId, ...path !== void 0 ? { path } : {}, ...icon !== void 0 ? { icon } : {} });
  }
  items.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
  return items;
}
async function countSharedAssets(pid) {
  const base = join11(resolveHome(), "projects", pid);
  const md = (entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "AGENTS.md";
  const [knowledge, cases, tools, specs] = await Promise.all([
    readdir8(join11(base, "knowledge"), { recursive: true, withFileTypes: true }).catch(() => []).then((entries) => entries.filter(md).length),
    readdir8(join11(base, "cases"), { withFileTypes: true }).catch(() => []).then((entries) => entries.filter(md).length),
    readdir8(join11(base, "tools"), { withFileTypes: true }).catch(() => []).then((entries) => entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).length),
    readdir8(join11(base, "specs"), { withFileTypes: true }).catch(() => []).then((entries) => entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).length)
  ]);
  return { knowledge, cases, tools, specs };
}
async function projectOverview(agentId, project, isDefault) {
  const [tasks, assets] = await Promise.all([
    listTasks({ agentId, projectId: project.id }).then((items) => ({
      total: items.length,
      running: items.filter((task) => task.status === "\u8FDB\u884C\u4E2D").length
    })),
    countSharedAssets(project.id)
  ]);
  return { path: project.path ?? null, isDefault, tasks, assets };
}
async function bindProject(agentId, path) {
  const agent = await readAgent(agentId);
  if (agent === void 0) return { code: "agent_not_found", message: "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", status: 404 };
  const registered = await registerProject(agentId, path).catch((error) => {
    if (error instanceof DefaultTaskFailed) return { code: "default_task_failed", message: error.message, status: 422 };
    throw error;
  });
  if ("code" in registered) return registered;
  const defaultId = agent.defaultProjectId ?? "workspace";
  const project = {
    id: registered.project.id,
    name: registered.project.name,
    path: registered.project.path,
    isDefault: registered.project.id === defaultId
  };
  const hidden = (agent.hiddenProjectIds ?? []).filter((item) => item !== project.id);
  const unhidden = hidden.length !== (agent.hiddenProjectIds ?? []).length;
  if (unhidden) await writeAgent({ ...agent, hiddenProjectIds: hidden });
  const changed = registered.created || unhidden;
  if (changed) broadcast({ type: "agents_changed" });
  return { project, created: registered.created, changed, defaultTask: registered.defaultTask };
}
async function unbindProject(agentId, pid) {
  const agent = await readAgent(agentId);
  if (agent === void 0) return { code: "agent_not_found", message: "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", status: 404 };
  const defaultId = agent.defaultProjectId ?? "workspace";
  if (pid === "workspace" || pid === defaultId) return { code: "cannot_unbind_default", message: "\u9ED8\u8BA4\u9879\u76EE\u4E0D\u53EF\u89E3\u7ED1", status: 400 };
  const hidden = agent.hiddenProjectIds ?? [];
  if (hidden.includes(pid)) return { code: "project_not_found", message: "\u8BE5 Agent \u4E0B\u6CA1\u6709\u8FD9\u4E2A\u9879\u76EE", status: 404 };
  if (!(await scanProjectDirs(agentId)).includes(pid)) return { code: "project_not_found", message: "\u8BE5 Agent \u4E0B\u6CA1\u6709\u8FD9\u4E2A\u9879\u76EE", status: 404 };
  await writeAgent({ ...agent, hiddenProjectIds: [...hidden, pid] });
  broadcast({ type: "agents_changed" });
  return "unbound";
}
async function registerProject(agentId, path) {
  const target = resolve5(path.trim());
  const info = await stat9(target).catch(() => void 0);
  if (info === void 0) return { code: "not_found", message: "\u76EE\u5F55\u4E0D\u5B58\u5728", status: 404 };
  if (!info.isDirectory()) return { code: "not_a_directory", message: "\u4E0D\u662F\u76EE\u5F55", status: 400 };
  const existing = await readProjectManifests(agentId);
  for (const project of existing.values()) {
    if (project.path === target) {
      const global2 = await ensureGlobalProject(project.path, project.id);
      const bound2 = await bindAgentProject(agentId, project.id, global2);
      return { project: bound2.manifest, created: false, defaultTask: bound2.defaultTask };
    }
  }
  const name = basename2(target) || target;
  const global = await ensureGlobalProject(target, sanitizeSegment(name));
  const bound = await bindAgentProject(agentId, void 0, global);
  return { project: bound.manifest, created: true, defaultTask: bound.defaultTask };
}
async function bindAgentProject(agentId, localId, global) {
  const targetDir = join11(agentProjectsRoot(agentId), global.id);
  const sourceDir = localId !== void 0 && localId !== global.id ? join11(agentProjectsRoot(agentId), localId) : targetDir;
  const existedBefore = await stat9(targetDir).then((info) => info.isDirectory(), () => false);
  const moved = sourceDir !== targetDir;
  if (moved) {
    const targetExists = await stat9(targetDir).catch(() => void 0);
    if (targetExists === void 0) await rename5(sourceDir, targetDir).catch(() => {
    });
  }
  if (global.path === void 0) throw new Error(`external project ${global.id} has no path`);
  await ensureAgentProjectLayer(targetDir);
  let defaultTask;
  try {
    defaultTask = await ensureDefaultTask({ agentId, projectId: global.id });
  } catch (error) {
    if (!existedBefore && !moved) await rm4(targetDir, { recursive: true, force: true }).catch(() => {
    });
    throw new DefaultTaskFailed(global.id, error instanceof Error ? error.message : String(error));
  }
  return { manifest: { schemaVersion: 1, id: global.id, name: global.name, path: global.path }, defaultTask };
}
var DefaultTaskFailed = class extends Error {
  projectId;
  constructor(projectId, reason) {
    super(`\u9ED8\u8BA4 Task \u521B\u5EFA\u5931\u8D25\uFF1A${reason}`);
    this.name = "DefaultTaskFailed";
    this.projectId = projectId;
  }
};

// src/assembly.ts
var DEFAULT_PI_THINKING_LEVEL = "medium";
var readJson2 = async (path) => readFile10(path, "utf8").then((text) => JSON.parse(text), () => void 0);
var readText = async (path) => readFile10(path, "utf8").then((text) => text, () => void 0);
function toChoice(data) {
  if (data === void 0) return void 0;
  const provider = data.defaultProvider;
  const model = data.defaultModel;
  if (typeof provider !== "string" || provider === "" || typeof model !== "string" || model === "") return void 0;
  const thinking = data.defaultThinkingLevel;
  return {
    defaultProvider: provider,
    defaultModel: model,
    ...typeof thinking === "string" && thinking !== "" ? { defaultThinkingLevel: thinking } : {}
  };
}
async function readAgentModelChoice(agentId) {
  return toChoice(await readJson2(join12(resolveHome(), "agents", agentId, "projects", "workspace", "config.json")));
}
async function readSystemModelChoice() {
  return toChoice(await readJson2(join12(resolveHome(), "config", "settings.json")));
}
async function readCatalogModelChoice() {
  const data = await readJson2(join12(resolveHome(), "config", "models.json"));
  const providers = data?.providers;
  if (providers === void 0 || typeof providers !== "object" || providers === null) return void 0;
  for (const [provider, value] of Object.entries(providers)) {
    const models = value?.models;
    if (!Array.isArray(models)) continue;
    const first = models.find((model) => typeof model === "object" && model !== null && typeof model.id === "string");
    if (first !== void 0) return { defaultProvider: provider, defaultModel: first.id };
  }
  return void 0;
}
async function readSpecPaths(root) {
  const data = await readJson2(join12(root, "index.json"));
  const entries = data?.specs;
  if (!Array.isArray(entries)) return [];
  const rootAbs = resolve6(root);
  const out = [];
  for (const entry of entries) {
    if (typeof entry.path !== "string" || entry.path.trim() === "") continue;
    const path = resolve6(rootAbs, entry.path);
    const rel = relative(rootAbs, path);
    if (rel.startsWith("..") || isAbsolute(rel) || rel === "") continue;
    out.push(path);
  }
  return out;
}
async function resolveModelChoice(agentId) {
  const agentChoice = await readAgentModelChoice(agentId);
  if (agentChoice !== void 0) return { choice: agentChoice, source: "agent" };
  const systemChoice = await readSystemModelChoice();
  if (systemChoice !== void 0) return { choice: systemChoice, source: "settings" };
  const catalogChoice = await readCatalogModelChoice();
  if (catalogChoice !== void 0) return { choice: catalogChoice, source: "catalog" };
  return void 0;
}
async function resolveTypeRulesPath(agentId, projectId, type) {
  const home2 = resolveHome();
  const candidates = [
    join12(home2, "agents", agentId, "projects", projectId, "task-types", type, "AGENTS.md"),
    join12(home2, "projects", projectId, "task-types", type, "AGENTS.md"),
    join12(home2, "interaction-harness", "task-types", type, "AGENTS.md")
  ];
  for (const path of candidates) {
    if (await readText(path) !== void 0) return path;
  }
  return void 0;
}
async function layerIndex(label, root) {
  const hasNote = await readText(join12(root, "AGENTS.md")) !== void 0;
  if (!hasNote) return [];
  const names = (await readdir9(root, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.name !== "AGENTS.md" && !entry.name.startsWith(".")).map((entry) => entry.isDirectory() ? `${entry.name}/` : entry.name).sort();
  return [`- ${label}\uFF1A${join12(root, "AGENTS.md")}\uFF08\u6709\uFF1A${names.join("\u3001") || "\u65E0"}\uFF09`];
}
async function buildPromptParts(agentId, projectId, taskId) {
  const home2 = resolveHome();
  const harnessRoot = join12(home2, "interaction-harness");
  const agentDir2 = join12(home2, "agents", agentId);
  const projectDir2 = join12(agentDir2, "projects", projectId);
  const sharedWorkspace = join12(home2, "projects", "workspace");
  const sharedProject = join12(home2, "projects", projectId);
  const sections = [];
  const sources = [];
  const pushFile = async (title, path) => {
    const text = await readText(path);
    if (text === void 0 || text.trim() === "") return;
    sources.push(path);
    sections.push(`## ${title}

${text.trim()}`);
  };
  await pushFile("\u534F\u8BAE\u6B63\u6587 \xB7 protocol.md", join12(harnessRoot, "protocol.md"));
  await pushFile("\u534F\u8BAE\u76EE\u5F55\u8BF4\u660E \xB7 AGENTS.md", join12(harnessRoot, "AGENTS.md"));
  const specRoots = [
    { label: "\u5171\u4EAB workspace", root: join12(sharedWorkspace, "specs") },
    ...projectId !== "workspace" ? [{ label: `\u5171\u4EAB\u9879\u76EE ${projectId}`, root: join12(sharedProject, "specs") }] : [],
    { label: `Agent \xD7 \u9879\u76EE ${projectId}`, root: join12(projectDir2, "specs") }
  ];
  const ctx = { agentId, projectId };
  const taskDir = taskId !== void 0 && taskId !== "" ? await resolveTaskDocDir(ctx, taskId) : void 0;
  let typeRules;
  if (taskDir !== void 0) {
    const taskMd = await readText(join12(taskDir, "task.md"));
    const type = taskMd?.split("\n").find((line) => line.startsWith("\u7C7B\u578B\uFF1A"))?.slice("\u7C7B\u578B\uFF1A".length).trim() ?? "";
    const taskLabel = basename3(taskDir);
    await pushFile(`\u5F53\u524D Task \xB7 ${taskLabel}/AGENTS.md`, join12(taskDir, "AGENTS.md"));
    await pushFile(`\u5F53\u524D Task \xB7 ${taskLabel}/task.md`, join12(taskDir, "task.md"));
    if (type !== "") {
      typeRules = await resolveTypeRulesPath(agentId, projectId, type);
      if (typeRules !== void 0) await pushFile(`\u4EFB\u52A1\u7C7B\u578B\u89C4\u5219 \xB7 ${type}/AGENTS.md`, typeRules);
    }
    specRoots.push({ label: `Task ${taskLabel}`, root: join12(taskDir, "specs") });
  }
  const seenSpecs = /* @__PURE__ */ new Set();
  for (const { label, root } of specRoots) {
    for (const path of await readSpecPaths(root)) {
      if (seenSpecs.has(path)) continue;
      seenSpecs.add(path);
      const topic = basename3(resolve6(path, ".."));
      await pushFile(`\u89C4\u8303 \xB7 ${label} \xB7 ${topic}`, path);
    }
  }
  const manifest = await readProjectManifest(agentId, projectId);
  if (manifest !== void 0) {
    await pushFile(`\u9879\u76EE\u89C4\u8303 \xB7 ${basename3(manifest.path)}/AGENTS.md\uFF08\u9879\u76EE\u76EE\u5F55\uFF0C\u4E0D\u7EE7\u627F\u7236\u76EE\u5F55\uFF09`, join12(manifest.path, "AGENTS.md"));
  }
  const index = [
    ...await layerIndex("Agent \u672C\u8EAB", agentDir2),
    ...await layerIndex("\u5171\u4EAB workspace", sharedWorkspace),
    ...projectId !== "workspace" ? await layerIndex(`\u5171\u4EAB\u9879\u76EE ${projectId}`, sharedProject) : [],
    ...await layerIndex(`Agent \xD7 \u9879\u76EE ${projectId}`, projectDir2),
    ...taskDir !== void 0 ? await layerIndex(`\u5F53\u524D Task ${basename3(taskDir)}`, taskDir) : []
  ];
  const harnessSection = [
    "\u4EE5\u4E0B\u662F\u7528\u6237\u4E0E\u8BE5\u9879\u76EE\u7684\u4EA4\u4E92 harness\uFF08\u534F\u4F5C\u89C4\u8303\u4E0E\u8D44\u6599\uFF09\uFF0C\u672C\u6B21\u4F1A\u8BDD\u5FC5\u987B\u9075\u5B88\uFF1B\u9700\u8981\u5B8C\u6574\u8D44\u6599\u65F6\u6309\u7D22\u5F15\u8BFB\u53D6\u3002",
    "",
    sections.join("\n\n"),
    "",
    "## \u8BF4\u660E\u6587\u4EF6\u7D22\u5F15\uFF08\u6309\u9700\u8BFB\u53D6\uFF0C\u4E0D\u5E38\u9A7B\uFF09",
    ...index
  ].join("\n");
  const identity = await readText(join12(agentDir2, "identity.md"));
  const customPrompt = identity === void 0 || identity.trim() === "" ? "" : `<lifeos_identity>
${identity.trim()}
</lifeos_identity>`;
  return { customPrompt, harnessSection, sources };
}
function extractRenderedSection(rendered, tag) {
  return rendered.match(new RegExp(`<${tag}>
([\\s\\S]*?)
</${tag}>`))?.[1];
}
function createLifeOsPromptExtension(source) {
  return {
    name: "lifeos-prompt",
    hidden: true,
    factory: (pi) => {
      pi.on("before_agent_start", async (event) => {
        const parts = typeof source === "function" ? await source() : source;
        const rendered = event.systemPrompt;
        const tools = extractRenderedSection(rendered, "tools");
        const rules = extractRenderedSection(rendered, "rules");
        const options = event.systemPromptOptions;
        if (parts.customPrompt !== "") options.customPrompt = parts.customPrompt;
        options.sections = {
          ...options.sections,
          ...tools !== void 0 ? { tools } : {},
          ...rules !== void 0 ? { rules } : {},
          lifeos_interaction_harness: parts.harnessSection,
          // 身份段（Task 0014）：Pi 支持任意 tag 作为 sections 项（`core/system-prompt.ts:29-30`）；
          // 内容是 raw `<lifeos_current_speaker>` 串（与 customPrompt 的 `<lifeos_identity>` 同一写法）。
          ...parts.speakerSection !== void 0 && parts.speakerSection !== "" ? { lifeos_current_speaker: parts.speakerSection } : {}
        };
      });
    }
  };
}
function createLifeOsReadPathExtension() {
  return {
    name: "lifeos-read-path",
    hidden: true,
    factory: (pi) => {
      pi.on("tool_result", (event, ctx) => {
        if (event.toolName !== "read") return;
        const blocks = event.content;
        if (!Array.isArray(blocks) || !blocks.some((block) => block.type === "image")) return;
        const rawPath = event.input?.path;
        if (typeof rawPath !== "string" || rawPath === "") return;
        const absolutePath = isAbsolute(rawPath) ? rawPath : resolve6(ctx.cwd, rawPath);
        const image = blocks.find((block) => block.type === "image");
        if (image === void 0 || image.type !== "image") return;
        const note = formatImageNote({ path: absolutePath, base64: image.data, mimeType: image.mimeType });
        const content = blocks.map((block) => block.type === "text" && isImageNoteText(block.text) ? { type: "text", text: note } : block);
        const first = content[0];
        const hasNote = content.some((block) => block.type === "text" && block.text === note);
        const withNote = hasNote ? content : [{ type: "text", text: note }, ...first === void 0 ? [] : content];
        return { content: withNote.filter((block) => block.type !== "image") };
      });
    }
  };
}
var KEEP_REINJECTED_IMAGES = 3;
function createLifeOsImageBudgetExtension() {
  return {
    name: "lifeos-image-budget",
    hidden: true,
    factory: (pi) => {
      pi.on("context", async (event, ctx) => {
        const model = ctx.model ?? void 0;
        const reinjected = await reinjectRecentImages(
          event.messages,
          KEEP_REINJECTED_IMAGES,
          {
            allowImages: model === void 0 || model.input === void 0 || model.input.includes("image"),
            // D7 之后重注入是「从磁盘读原图」，不再经过 Pi 的 processImage →
            // 这里必须显式把模型档位传下去，否则 `inputLimits.images.resize` 对读图路径无效。
            resize: model?.inputLimits?.images?.resize
          }
        );
        const handBack = () => reinjected.changed ? { messages: reinjected.messages } : void 0;
        const providerId = model?.provider ?? "";
        if (providerId !== "") {
          const recent = ctx.sessionManager.getEntries().slice(-16);
          const rejected = recent.some((entry) => {
            const message = entry.message;
            return message?.role === "assistant" && typeof message.errorMessage === "string" && PAYLOAD_TOO_LARGE.test(message.errorMessage);
          });
          if (rejected) {
            const bodyBytes = imageBytesOf(reinjected.messages);
            if (bodyBytes > 0) {
              await recordObservedToFile(resolveHome(), { providerId, bodyBytes, outcome: "too_large" }).catch(() => void 0);
              void log.info("agent-host", "imageBudget", "\u4E0A\u4E00\u6B21\u8BF7\u6C42\u88AB\u5224\u4F53\u79EF\u8D85\u9650\uFF0C\u672C\u6B21\u6536\u7D27\u9884\u7B97", { details: { providerId, bodyBytes } });
            }
          }
        }
        const limits = await readLimits(resolveHome());
        const applied = applyImageBudget(reinjected.messages, model, limits);
        if (applied === void 0) return handBack();
        const { budget, result } = applied;
        if (budget.undersized) {
          void log.warn("agent-host", "imageBudget", "\u8BF7\u6C42\u4F53\u4E0A\u9650\u592A\u5C0F\uFF0C\u6DD8\u6C70\u65E0\u6CD5\u56DE\u5230\u5B89\u5168\u533A", {
            details: { limit: budget.limit, source: budget.source, triggerBytes: budget.triggerBytes }
          });
        }
        if (result.droppedCount > 0 && result.keptImages < KEEP_REINJECTED_IMAGES) {
          void log.warn("agent-host", "imageBudget", "\u5355\u5F20\u56FE\u7247\u8D85\u8FC7\u8BF7\u6C42\u4F53\u9884\u7B97\uFF0C\u5DF2\u8FDE\u540C\u6700\u8FD1\u56FE\u4E00\u8D77\u7701\u7565", {
            details: {
              dropped: result.droppedCount,
              keptImages: result.keptImages,
              bytesAfter: result.bytesAfter,
              hardBytes: budget.hardBytes,
              resize: model?.inputLimits?.images?.resize ?? null
            }
          });
        }
        if (result.droppedCount === 0) return handBack();
        void log.info("agent-host", "imageBudget", "\u6DD8\u6C70\u5386\u53F2\u56FE\u7247", {
          details: {
            dropped: result.droppedCount,
            keptImages: result.keptImages,
            bytesBefore: result.bytesBefore,
            bytesAfter: result.bytesAfter,
            triggerBytes: budget.triggerBytes,
            targetBytes: budget.targetBytes,
            source: budget.source
          }
        });
        return { messages: result.messages };
      });
    }
  };
}

// src/agent-host.ts
init_logging();
init_home();
import { readFile as readFile20, readdir as readdir14, rm as rm8 } from "node:fs/promises";
import { join as join24, sep as sep4 } from "node:path";

// src/agent-tools.ts
import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";

// src/review-comments.ts
init_atomic_file();
init_home();
import { createHash as createHash3 } from "node:crypto";
import { mkdir as mkdir9, readFile as readFile11, readdir as readdir10, rm as rm5, writeFile as writeFile11 } from "node:fs/promises";
import { join as join13 } from "node:path";
var MAX_COMMENTS_PER_TASK = 200;
var SCHEMA_VERSION = 2;
var COMMENTS_DIR = join13("state", "review-comments");
var COMMENTS_NOTE = `# review-comments \xB7 \u68C0\u89C6\u8BC4\u8BBA

- \u80CC\u666F\uFF1A\u68C0\u89C6\u6A21\u5F0F\uFF08Task worktree diff \u68C0\u89C6\uFF09\u7684**\u8BC4\u8BBA\u6570\u636E**\u3002\u8BC4\u8BBA\u7ED1"\u68C0\u89C6\u5BF9\u8C61"\uFF08taskId\uFF09\uFF0C\u4E0D\u7ED1\u5BF9\u8BDD\u3001\u4E0D\u7ED1\u5BF9\u8BDD/\u4F1A\u8BDD/\u6D4F\u89C8\u5668\u3002
- \u5185\u5BB9\uFF1A<slug>.json\uFF0C\u6BCF\u884C\u4E00\u4E2A Task\u3002slug = \u53EF\u8BFB\u524D\u7F00 + taskDir \u5168\u8DEF\u5F84\u7684 sha1 \u524D 8 \u4F4D\uFF08\u9632\u540C\u540D\u649E\u8F66\uFF09\u3002\u7ED3\u6784 \`{ version, taskId, taskDir, comments: [] }\`\u3002
- \u4F55\u65F6\u8BFB\uFF1A\u6392\u67E5"\u8BC4\u8BBA\u4E3A\u4EC0\u4E48\u4E0D\u663E\u793A/\u4E3A\u4EC0\u4E48\u4E32\u5230\u522B\u7684 Task"\u65F6\uFF1B\u6216\u60F3\u76F4\u63A5\u770B\u67D0\u4E2A Task \u6709\u54EA\u4E9B\u8BC4\u8BBA\u3002
- \u600E\u4E48\u7528\uFF1A\u4E0D\u8981\u624B\u6539\uFF08\u5199\u5165\u662F\u539F\u5B50\u66FF\u6362\uFF0C\u624B\u6539\u4F1A\u88AB\u8986\u76D6\uFF09\uFF1B\u5220\u9664\u67D0\u4E2A\u6587\u4EF6\u7B49\u4E8E\u6E05\u7A7A\u8BE5 Task \u7684\u8BC4\u8BBA\u3002\u4E0D\u5165\u5E93\u3002
`;
var isString = (v) => typeof v === "string";
var isNum = (v) => typeof v === "number" && Number.isFinite(v);
function taskSlugOf(taskDir) {
  const base = taskDir.replace(/\/+$/, "").split("/").pop() ?? "task";
  const readable = base.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const hash = createHash3("sha1").update(taskDir).digest("hex").slice(0, 8);
  const head = readable === "" ? "task" : readable;
  return `${head}-${hash}`.slice(0, 64);
}
function commentsFileOf(taskDir) {
  return join13(resolveHome(), COMMENTS_DIR, `${taskSlugOf(taskDir)}.json`);
}
function commentKeyOf(c) {
  const start = Math.min(c.anchor.start, c.anchor.end);
  const end = Math.max(c.anchor.start, c.anchor.end);
  return [
    c.taskId,
    c.anchor.source,
    c.anchor.path,
    c.anchor.side,
    `${start}-${end}`
  ].join("\0") + `${c.author.kind}:${c.author.id}`;
}
var toAuthor = (raw) => {
  if (typeof raw !== "object" || raw === null) return void 0;
  const r = raw;
  if (r.kind !== "user" && r.kind !== "agent") return void 0;
  if (!isString(r.id) || r.id === "") return void 0;
  return { kind: r.kind, id: r.id };
};
var toAnchor = (raw) => {
  if (typeof raw !== "object" || raw === null) return void 0;
  const r = raw;
  if (r.source !== "worktree" && r.source !== "lifeos") return void 0;
  if (!isString(r.path) || r.path === "") return void 0;
  if (r.side !== "old" && r.side !== "new") return void 0;
  const start = r.start;
  const end = r.end;
  if (!isNum(start) || !isNum(end) || start < 1 || end < 1) return void 0;
  return {
    source: r.source,
    path: r.path,
    side: r.side,
    // 归一：倒序输入不产生 start > end 的锚点（前端 rangeOf 已归一，这里是存储层的兜底）
    start: Math.min(start, end),
    end: Math.max(start, end),
    ...isString(r.quote) ? { quote: r.quote } : {},
    ...isString(r.snapshot) ? { snapshot: r.snapshot } : {},
    ...isString(r.baseCommit) && r.baseCommit !== "" ? { baseCommit: r.baseCommit } : {}
  };
};
var toReply = (raw) => {
  if (typeof raw !== "object" || raw === null) return void 0;
  const r = raw;
  if (!isString(r.id) || r.id === "") return void 0;
  const author = toAuthor(r.author);
  if (author === void 0) return void 0;
  if (!isString(r.body)) return void 0;
  const createdAt = isString(r.createdAt) && r.createdAt !== "" ? r.createdAt : (/* @__PURE__ */ new Date()).toISOString();
  const updatedAt = isString(r.updatedAt) && r.updatedAt !== "" && r.updatedAt !== createdAt ? r.updatedAt : void 0;
  return { id: r.id, author, body: r.body, createdAt, ...updatedAt !== void 0 ? { updatedAt } : {} };
};
function toReviewComment(raw) {
  if (typeof raw !== "object" || raw === null) return void 0;
  const r = raw;
  const id = r.id;
  const taskId = r.taskId;
  if (!isString(id) || id === "") return void 0;
  if (!isString(taskId) || taskId === "") return void 0;
  const author = toAuthor(r.author);
  if (author === void 0) return void 0;
  const anchor = toAnchor(r.anchor);
  if (anchor === void 0) return void 0;
  if (!isString(r.body)) return void 0;
  const state = r.state === "open" || r.state === "resolved" || r.state === "draft" ? r.state : "draft";
  const awaiting = r.awaiting === "user" || r.awaiting === "agent" ? r.awaiting : null;
  const canClose = r.canClose === "author" ? "author" : "author-or-user";
  const resolvedAt = isString(r.resolvedAt) && r.resolvedAt !== "" ? r.resolvedAt : void 0;
  const resolvedBy = toAuthor(r.resolvedBy);
  const createdAt = isString(r.createdAt) && r.createdAt !== "" ? r.createdAt : (/* @__PURE__ */ new Date()).toISOString();
  const updatedAt = isString(r.updatedAt) && r.updatedAt !== "" ? r.updatedAt : createdAt;
  const marks = Array.isArray(r.marks) ? r.marks.filter((m) => isString(m) && m !== "") : [];
  const originRaw = r.origin;
  let origin;
  if (typeof originRaw === "object" && originRaw !== null) {
    const o = originRaw;
    if (o.kind === "review-panel" || o.kind === "agent-tool") {
      origin = { kind: o.kind, ...isString(o.sessionId) ? { sessionId: o.sessionId } : {} };
    }
  }
  const replies = Array.isArray(r.replies) ? r.replies.map(toReply).filter((reply) => reply !== void 0) : [];
  return {
    id,
    taskId,
    author,
    anchor,
    body: r.body,
    marks,
    state,
    awaiting,
    canClose,
    replies,
    createdAt,
    updatedAt,
    ...origin !== void 0 ? { origin } : {},
    ...resolvedAt !== void 0 ? { resolvedAt } : {},
    ...resolvedBy !== void 0 ? { resolvedBy } : {}
  };
}
async function readComments(taskDir) {
  const file = commentsFileOf(taskDir);
  let text;
  try {
    text = await readFile11(file, "utf8");
  } catch {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const shape = parsed;
  if (shape.version !== 1 && shape.version !== SCHEMA_VERSION || !Array.isArray(shape.comments)) return [];
  const out = [];
  for (const item of shape.comments) {
    const comment = toReviewComment(item);
    if (comment !== void 0) out.push(comment);
  }
  return out;
}
var chains = /* @__PURE__ */ new Map();
function serialize(taskDir, work) {
  const key = commentsFileOf(taskDir);
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(work, work).catch(() => void 0);
  chains.set(key, next);
  return next;
}
async function writeComments(taskDir, taskId, comments) {
  const valid = comments.filter((c) => c.taskId === taskId).map((c) => toReviewComment(c)).filter((c) => c !== void 0);
  const trimmed = valid.length <= MAX_COMMENTS_PER_TASK ? valid : [...valid].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(valid.length - MAX_COMMENTS_PER_TASK);
  const file = commentsFileOf(taskDir);
  const dir = join13(file, "..");
  const body = { version: SCHEMA_VERSION, taskId, taskDir, comments: trimmed };
  await serialize(taskDir, async () => {
    await mkdir9(dir, { recursive: true, mode: 448 });
    await writeTextAtomic(file, JSON.stringify(body, null, 2) + "\n");
    await writeFile11(join13(dir, "AGENTS.md"), COMMENTS_NOTE, { flag: "wx", mode: 384 }).catch(() => void 0);
  });
}
async function upsertComment(taskDir, input, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const all = await readComments(taskDir);
  const key = commentKeyOf({ taskId: input.taskId, author: input.author, anchor: input.anchor });
  const existing = all.find((c) => commentKeyOf(c) === key);
  const candidate = {
    ...input,
    id: input.id ?? existing?.id ?? newId(),
    marks: input.marks ?? existing?.marks ?? [],
    state: input.state ?? existing?.state ?? "open",
    awaiting: input.awaiting !== void 0 ? input.awaiting : existing?.awaiting ?? null,
    canClose: input.canClose ?? existing?.canClose ?? "author-or-user",
    // 回复不随“编辑正文”消失：不传就保留原值（S4h·4 的回归）
    replies: input.replies ?? existing?.replies ?? [],
    createdAt: input.createdAt ?? existing?.createdAt ?? now,
    updatedAt: now
  };
  const validated = toReviewComment(candidate);
  if (validated === void 0) throw new Error("\u8BC4\u8BBA\u5B57\u6BB5\u4E0D\u5408\u6CD5\uFF08\u9700\u8981 taskId/author/anchor/body\uFF09");
  const rest = all.filter((c) => commentKeyOf(c) !== key);
  await writeComments(taskDir, input.taskId, [...rest, validated]);
  return validated;
}
async function removeComment(taskDir, id) {
  const all = await readComments(taskDir);
  const next = all.filter((c) => c.id !== id);
  if (next.length === all.length) return false;
  await writeComments(taskDir, all[0]?.taskId ?? "", next);
  return true;
}
async function clearComments(taskDir) {
  const file = commentsFileOf(taskDir);
  await rm5(file, { force: true });
}
function toCommentInput(raw, taskId) {
  if (typeof raw !== "object" || raw === null) return void 0;
  const r = raw;
  const author = toAuthor(r.author);
  if (author === void 0) return void 0;
  const anchorOk = toAnchor(r.anchor);
  if (anchorOk === void 0) return void 0;
  if (!isString(r.body)) return void 0;
  const marks = Array.isArray(r.marks) ? r.marks.filter((m) => isString(m) && m !== "") : void 0;
  const state = r.state === "open" || r.state === "resolved" || r.state === "draft" ? r.state : void 0;
  const awaiting = r.awaiting === "user" || r.awaiting === "agent" ? r.awaiting : void 0;
  const canClose = r.canClose === "author" ? "author" : r.canClose === "author-or-user" ? "author-or-user" : void 0;
  return {
    ...isString(r.id) && r.id !== "" ? { id: r.id } : {},
    taskId,
    author,
    anchor: anchorOk,
    body: r.body,
    ...marks !== void 0 ? { marks } : {},
    ...state !== void 0 ? { state } : {},
    ...awaiting !== void 0 ? { awaiting } : {},
    ...canClose !== void 0 ? { canClose } : {}
  };
}
function newId() {
  return `rc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
function canCloseComment(comment, by) {
  const isAuthor = comment.author.kind === by.kind && comment.author.id === by.id;
  if (isAuthor) return true;
  if (comment.author.kind === "user" && by.kind === "user") return true;
  return comment.canClose === "author-or-user" && by.kind === "user";
}
async function setCommentState(taskDir, id, state, by, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const all = await readComments(taskDir);
  const current = all.find((c) => c.id === id);
  if (current === void 0) return void 0;
  if (state === "resolved" && !canCloseComment(current, by)) {
    throw new Error(`\u4E0D\u80FD\u5173\u95ED\uFF1A\u53EA\u6709\u63D0\u51FA\u8005 ${current.author.kind}:${current.author.id} \u6216\u7528\u6237\u672C\u4EBA\u53EF\u4EE5\u5173\u95ED\u8FD9\u6761\u8BC4\u8BBA`);
  }
  if (state !== "resolved") {
    const isAuthor = current.author.kind === by.kind && current.author.id === by.id;
    if (!isAuthor && by.kind !== "user") {
      throw new Error(`\u4E0D\u80FD\u91CD\u5F00\uFF1A\u53EA\u6709\u63D0\u51FA\u8005 ${current.author.kind}:${current.author.id} \u6216\u7528\u6237\u672C\u4EBA\u53EF\u4EE5\u91CD\u5F00\u8FD9\u6761\u8BC4\u8BBA`);
    }
  }
  const { resolvedAt: _dropAt, resolvedBy: _dropBy, ...rest } = current;
  const cleaned = state === "resolved" ? { ...rest, state, updatedAt: now, resolvedAt: now, resolvedBy: by } : { ...rest, state, updatedAt: now };
  await writeComments(taskDir, current.taskId, all.map((c) => c.id === id ? cleaned : c));
  return cleaned;
}
function canReplyToComment(comment) {
  return comment.state !== "resolved";
}
function awaitingAfterReply(author) {
  return author.kind === "agent" ? "user" : "agent";
}
function newReplyId() {
  return `rr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
async function addReply(taskDir, commentId, reply, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const author = toAuthor(reply.author);
  if (author === void 0) throw new Error("\u56DE\u590D\u7684 author \u4E0D\u5408\u6CD5\uFF08\u9700\u8981 kind=user|agent \u4E0E\u975E\u7A7A id\uFF09");
  if (typeof reply.body !== "string" || reply.body.trim() === "") throw new Error("\u56DE\u590D\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A\uFF08body\uFF09");
  const all = await readComments(taskDir);
  const current = all.find((c) => c.id === commentId);
  if (current === void 0) throw new Error(`\u627E\u4E0D\u5230\u8BC4\u8BBA ${commentId}`);
  if (!canReplyToComment(current)) throw new Error("\u5DF2\u5173\u95ED\u7684\u8BC4\u8BBA\u4E0D\u80FD\u56DE\u590D\uFF0C\u8BF7\u5148\u91CD\u5F00");
  const next = {
    ...current,
    replies: [...current.replies, { id: newReplyId(), author, body: reply.body, createdAt: now }],
    // 交棒：有了新回复，“现在等谁”就换人了
    awaiting: awaitingAfterReply(author),
    updatedAt: now
  };
  await writeComments(taskDir, current.taskId, all.map((c) => c.id === commentId ? next : c));
  return next;
}
async function upsertReply(taskDir, commentId, reply, now = (/* @__PURE__ */ new Date()).toISOString()) {
  if (typeof reply.body !== "string" || reply.body.trim() === "") throw new Error("\u56DE\u590D\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A\uFF08body\uFF09");
  const all = await readComments(taskDir);
  const current = all.find((c) => c.id === commentId);
  if (current === void 0) throw new Error(`\u627E\u4E0D\u5230\u8BC4\u8BBA ${commentId}`);
  const target = current.replies.find((r) => r.id === reply.id);
  if (target === void 0) throw new Error(`\u627E\u4E0D\u5230\u56DE\u590D ${reply.id}`);
  assertCanEditReply(target, reply.author);
  const next = {
    ...current,
    replies: current.replies.map((r) => r.id === reply.id ? { ...r, body: reply.body, updatedAt: now } : r),
    updatedAt: now
  };
  await writeComments(taskDir, current.taskId, all.map((c) => c.id === commentId ? next : c));
  return next;
}
async function removeReply(taskDir, commentId, replyId, by) {
  const all = await readComments(taskDir);
  const current = all.find((c) => c.id === commentId);
  if (current === void 0) throw new Error(`\u627E\u4E0D\u5230\u8BC4\u8BBA ${commentId}`);
  const target = current.replies.find((r) => r.id === replyId);
  if (target === void 0) return current;
  assertCanEditReply(target, by);
  const next = {
    ...current,
    replies: current.replies.filter((r) => r.id !== replyId),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await writeComments(taskDir, current.taskId, all.map((c) => c.id === commentId ? next : c));
  return next;
}
function assertCanEditReply(reply, by) {
  const isAuthor = reply.author.kind === by.kind && reply.author.id === by.id;
  if (isAuthor || by.kind === "user") return;
  throw new Error(`\u53EA\u6709\u56DE\u590D\u4F5C\u8005 ${reply.author.kind}:${reply.author.id} \u6216\u7528\u6237\u672C\u4EBA\u53EF\u4EE5\u4FEE\u6539/\u5220\u9664\u8FD9\u6761\u56DE\u590D`);
}
async function setCommentAwaiting(taskDir, id, awaiting, _by, now = (/* @__PURE__ */ new Date()).toISOString()) {
  if (awaiting !== "user" && awaiting !== "agent" && awaiting !== null) {
    throw new Error("awaiting \u5FC5\u987B\u662F user / agent / null");
  }
  const all = await readComments(taskDir);
  const current = all.find((c) => c.id === id);
  if (current === void 0) return void 0;
  const next = { ...current, awaiting, updatedAt: now };
  await writeComments(taskDir, current.taskId, all.map((c) => c.id === id ? next : c));
  return next;
}
function pendingFor(comments, who, available) {
  return comments.filter((c) => c.state !== "resolved" && (c.awaiting === null || c.awaiting === who) && (available === void 0 || isCountable(c, available)));
}
function isEmptyDraft(comment) {
  return (comment.state ?? "draft") === "draft" && comment.body.trim() === "";
}
function isCountable(comment, available) {
  if (isEmptyDraft(comment)) return false;
  const a = comment.anchor;
  return available.has(`${a.source}\0${a.path}`);
}

// src/review.ts
init_home();
import { execFile as execFile3 } from "node:child_process";
import { mkdir as mkdir10, readdir as readdir11, readFile as readFile12, rm as rm6, stat as stat10 } from "node:fs/promises";
import { basename as basename5, join as join14, resolve as resolve7 } from "node:path";
import { tmpdir } from "node:os";
import { promisify as promisify3 } from "node:util";

// src/review-patch.ts
var HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
function parseUnifiedPatchToHunks(body) {
  const hunks = [];
  let current;
  let oldNo = 0;
  let newNo = 0;
  let oldLeft = 0;
  let newLeft = 0;
  for (const raw of body) {
    const line = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
    const hunk = HUNK_RE.exec(line);
    if (hunk !== null) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[3]);
      oldLeft = hunk[2] === void 0 ? 1 : Number(hunk[2]);
      newLeft = hunk[4] === void 0 ? 1 : Number(hunk[4]);
      current = { oldStart: oldNo, oldLines: oldLeft, newStart: newNo, newLines: newLeft, lines: [] };
      hunks.push(current);
      continue;
    }
    if (current === void 0) continue;
    if (line.startsWith("\\ ")) continue;
    const prefix = line.charAt(0);
    const text = line.slice(1);
    if (prefix === " " || prefix === "" && text === "") {
      if (oldLeft <= 0 && newLeft <= 0) continue;
      current.lines.push({ type: "context", oldNo: oldNo++, newNo: newNo++, text });
      if (oldLeft > 0) oldLeft--;
      if (newLeft > 0) newLeft--;
      continue;
    }
    if (prefix === "-") {
      current.lines.push({ type: "removed", oldNo: oldNo++, newNo: null, text });
      if (oldLeft > 0) oldLeft--;
      continue;
    }
    if (prefix === "+") {
      current.lines.push({ type: "added", oldNo: null, newNo: newNo++, text });
      if (newLeft > 0) newLeft--;
      continue;
    }
  }
  return hunks;
}

// src/worktree-mount.ts
import { basename as basename4, dirname as dirname3 } from "node:path";
var LEGACY_WORKTREE_DIR = "worktree";
var MOUNT_KINDS = /* @__PURE__ */ new Set([HOME_DIR, REPO_DIR, LEGACY_WORKTREE_DIR]);
var TASK_DIR_NAME = /^\d{4}-/;
function worktreeMountKindOf(path) {
  const name = basename4(path);
  if (!MOUNT_KINDS.has(name)) return void 0;
  if (!TASK_DIR_NAME.test(basename4(dirname3(path)))) return void 0;
  return name;
}
function worktreeMountOf(target) {
  let current = target;
  for (; ; ) {
    const parent = dirname3(current);
    if (parent === current) return void 0;
    if (worktreeMountKindOf(parent) !== void 0) {
      const kind = worktreeMountKindOf(parent);
      if (kind !== void 0) return { path: parent, kind };
      return void 0;
    }
    current = parent;
  }
}

// src/review.ts
var run3 = promisify3(execFile3);
var MAX_FILE_DIFF_BYTES = 1024 * 1024;
var MAX_REVIEW_FILES = 200;
var MAX_REVIEW_DIFF_LINES = 2e4;
var EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
var isMd = (path) => /\.(md|markdown|mdx)$/i.test(path);
var fileKindOf = (path) => isMd(path) ? "doc" : /\.(ts|tsx|js|mjs|cjs|jsx|css|json|ya?ml|html|rs|py|go|sh|toml)$/i.test(path) ? "code" : "other";
async function git3(cwd, args, maxBuffer = 64 * 1024 * 1024) {
  const { stdout } = await run3("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], {
    timeout: 15e3,
    maxBuffer,
    env: { ...process.env, LC_ALL: "C" }
  });
  return stdout;
}
function gitShortError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/not a git repository/i.test(message)) return { code: "no_vcs", message: "\u8FD9\u4E2A\u76EE\u5F55\u4E0D\u662F git \u4ED3\u5E93", status: 400 };
  if (/bad object|unknown revision|ambiguous argument/i.test(message)) return { code: "bad_ref", message: "git \u5F15\u7528\u4E0D\u5B58\u5728\u6216\u5DF2\u635F\u574F", status: 502 };
  return { code: "git_broken", message: `git \u547D\u4EE4\u5931\u8D25\uFF1A${message.slice(0, 200)}`, status: 502 };
}
async function dirExists(path) {
  try {
    return (await stat10(path)).isDirectory();
  } catch {
    return false;
  }
}
async function gitMarkerExists(path) {
  try {
    const info = await stat10(path);
    return info.isDirectory() || info.isFile();
  } catch {
    return false;
  }
}
async function locateSources(taskDir) {
  const sources = [];
  const convention = join14(taskDir, REPO_DIR);
  const legacy = join14(taskDir, "evidence", "worktree");
  let worktreePath;
  let via;
  if (await dirExists(convention)) {
    worktreePath = convention;
    via = "convention";
  } else if (await dirExists(legacy)) {
    worktreePath = legacy;
    via = "convention";
  } else {
    try {
      const entries = await readdir11(taskDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const mountKind = worktreeMountKindOf(join14(taskDir, entry.name));
        if (mountKind === HOME_DIR) continue;
        const candidate = join14(taskDir, entry.name);
        if (await gitMarkerExists(join14(candidate, ".git"))) {
          worktreePath = candidate;
          via = "scan";
          break;
        }
      }
    } catch {
    }
  }
  if (worktreePath !== void 0) {
    const source = { kind: "worktree", path: worktreePath, exists: true };
    if (via !== void 0) source.via = via;
    try {
      const branch = (await git3(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      const head = (await git3(worktreePath, ["rev-parse", "--short", "HEAD"])).trim();
      if (branch !== "") source.branch = branch;
      if (head !== "") source.head = head;
    } catch {
    }
    sources.push(source);
  } else {
    sources.push({ kind: "worktree", path: convention, exists: false });
  }
  const homeWorktree = join14(taskDir, HOME_DIR);
  if (await dirExists(homeWorktree)) {
    const source = { kind: "lifeos", path: homeWorktree, exists: true, via: "direct" };
    try {
      const branch = (await git3(homeWorktree, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      const head = (await git3(homeWorktree, ["rev-parse", "--short", "HEAD"])).trim();
      if (branch !== "") source.branch = branch;
      if (head !== "") source.head = head;
    } catch {
    }
    sources.push(source);
    return sources;
  }
  const lifeos = { kind: "lifeos", path: taskDir, exists: true, via: "direct" };
  const homeRepo = resolveHome();
  try {
    const head = (await git3(homeRepo, ["rev-parse", "--short", "HEAD"])).trim();
    if (head !== "") lifeos.head = head;
  } catch {
  }
  sources.push(lifeos);
  return sources;
}
async function lifeosBaseline(taskDir) {
  const homeRepo = resolveHome();
  try {
    const log2 = await git3(homeRepo, ["log", "--format=%H %cI", "-n", "1", "--", taskDir]);
    const [commit, at] = log2.trim().split(" ");
    if (commit === void 0 || commit === "") return void 0;
    return at !== void 0 && at !== "" ? { commit, at } : { commit };
  } catch {
    return void 0;
  }
}
async function computeLifeosDiff(taskDir) {
  const homeRepo = resolveHome();
  const base = await lifeosBaseline(taskDir);
  const rel = relativeTo(homeRepo, taskDir);
  const source = { kind: "lifeos", path: taskDir, exists: true, via: "direct" };
  try {
    const head = (await git3(homeRepo, ["rev-parse", "--short", "HEAD"])).trim();
    if (head !== "") source.head = head;
  } catch {
  }
  if (source.head === void 0) {
    return { source: { ...source, exists: await dirExists(taskDir) }, files: [], truncated: false, degraded: "no_vcs" };
  }
  const tmpDir = join14(homeRepo, "tmp");
  const tmpIndex = join14(tmpDir, `review-index-${process.pid}-${Date.now()}.idx`);
  try {
    await mkdir10(tmpDir, { recursive: true });
    let oldRoot = EMPTY_TREE;
    if (base !== void 0) {
      oldRoot = (await git3(homeRepo, ["rev-parse", `${base.commit}^{tree}`]).catch(() => ""))?.trim() || EMPTY_TREE;
    }
    const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
    await run3("git", ["-C", homeRepo, "read-tree", "--empty"], { env, timeout: 1e4, maxBuffer: 1024 * 1024 });
    await run3("git", ["-C", homeRepo, "add", "-A", "--", rel], { env, timeout: 6e4, maxBuffer: 64 * 1024 * 1024 });
    const newRoot = (await run3("git", ["-C", homeRepo, "write-tree"], { env, timeout: 3e4, maxBuffer: 1024 * 1024 })).stdout.trim();
    const diffPaths = [rel, `:(exclude)${rel === "." ? "" : rel + "/"}evidence/**`];
    const patch = await git3(homeRepo, ["diff", "--no-color", "--no-ext-diff", "--unified=3", oldRoot, newRoot, "--", ...diffPaths]);
    return { source, files: filesFromPatch(patch), truncated: false, ...base !== void 0 ? { base } : {} };
  } catch (error) {
    const e = gitShortError(error);
    if (e.code !== "no_vcs") console.error(`[review] lifeos diff \u5931\u8D25 (${taskDir}):`, e.message);
    return { source, files: [], truncated: false, ...base !== void 0 ? { base } : {}, degraded: "no_vcs" };
  } finally {
    await import("node:fs/promises").then((fs2) => fs2.rm(tmpIndex, { force: true })).catch(() => {
    });
  }
}
function safeRelativePath(path) {
  if (typeof path !== "string" || path === "") return void 0;
  if (path.includes("\0")) return void 0;
  if (path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path)) return void 0;
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) return void 0;
  return normalized;
}
function looksBinary(buffer) {
  const head = buffer.subarray(0, 8192);
  for (const byte of head) if (byte === 0) return true;
  return false;
}
function truncateContent(buffer) {
  if (buffer.length <= MAX_FILE_DIFF_BYTES) return { content: buffer.toString("utf8"), truncated: false };
  const head = buffer.subarray(0, MAX_FILE_DIFF_BYTES);
  const lastNewline = head.lastIndexOf(10);
  const cut = lastNewline > 0 ? head.subarray(0, lastNewline + 1) : head;
  return { content: cut.toString("utf8"), truncated: true };
}
async function readDiskFile(root, relative3) {
  const absolute = resolve7(root, relative3);
  const rootResolved = resolve7(root);
  if (absolute !== rootResolved && !absolute.startsWith(rootResolved + "/")) return void 0;
  try {
    const info = await stat10(absolute);
    if (!info.isFile()) return void 0;
    return await readFile12(absolute);
  } catch {
    return void 0;
  }
}
async function readGitBlob(repo, ref, relative3) {
  try {
    const { stdout } = await run3("git", ["-C", repo, "-c", "core.quotePath=false", "show", `${ref}:${relative3}`], {
      timeout: 15e3,
      maxBuffer: 256 * 1024 * 1024,
      encoding: "buffer",
      env: { ...process.env, LC_ALL: "C" }
    });
    return stdout;
  } catch {
    return void 0;
  }
}
var blobError = (code, message, status) => ({ error: { code, message, status } });
async function worktreeBaseRef(repo) {
  const baseBranch = await baseBranchOf(repo);
  if (baseBranch !== void 0) {
    try {
      const mergeBase = (await git3(repo, ["merge-base", baseBranch, "HEAD"])).trim();
      if (mergeBase !== "") return mergeBase;
    } catch {
    }
  }
  return "HEAD";
}
async function readReviewBlob(input) {
  const { taskDir } = input;
  if (input.source !== "worktree" && input.source !== "lifeos") {
    return blobError("invalid_source", "source \u53EA\u80FD\u662F worktree \u6216 lifeos", 400);
  }
  if (input.side !== "old" && input.side !== "new") {
    return blobError("invalid_side", "side \u53EA\u80FD\u662F old \u6216 new", 400);
  }
  const relative3 = safeRelativePath(input.path);
  if (relative3 === void 0) return blobError("bad_request", "\u6587\u4EF6\u8DEF\u5F84\u4E0D\u5408\u6CD5\uFF08\u4E0D\u5141\u8BB8\u7EDD\u5BF9\u8DEF\u5F84\u6216 .. \u9003\u9038\uFF09", 400);
  if (!await dirExists(taskDir)) {
    return blobError("task_dir_not_found", `Task \u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${basename5(taskDir)}`, 404);
  }
  const ownBuffer = async (side) => {
    if (input.source === "worktree") {
      const source = (await locateSources(taskDir)).find((item) => item.kind === "worktree");
      if (source === void 0 || !source.exists) return void 0;
      if (side === "old") return readGitBlob(source.path, await worktreeBaseRef(source.path), relative3);
      return readDiskFile(source.path, relative3);
    }
    const homeRepo = resolveHome();
    if (side === "new") return readDiskFile(taskDir, relative3);
    const base = await lifeosBaseline(taskDir);
    if (base === void 0) return void 0;
    return readGitBlob(homeRepo, base.commit, relativeTo(homeRepo, join14(taskDir, relative3)));
  };
  const wanted = await ownBuffer(input.side);
  if (wanted === void 0) {
    const other = await ownBuffer(input.side === "old" ? "new" : "old");
    if (other !== void 0 && !looksBinary(other)) return { content: "", truncated: false };
    if (other !== void 0) return blobError("binary_not_supported", "\u8FD9\u662F\u4E8C\u8FDB\u5236\u6587\u4EF6\uFF0C\u4E0D\u63D0\u4F9B\u6587\u672C\u5185\u5BB9", 400);
    if (input.source === "worktree") {
      const source = (await locateSources(taskDir)).find((item) => item.kind === "worktree");
      if (source === void 0 || !source.exists) {
        return blobError("worktree_missing", "\u8FD9\u4E2A Task \u8FD8\u6CA1\u6709 worktree\uFF08\u7EA6\u5B9A\u4F4D\u7F6E evidence/worktree\uFF09", 404);
      }
    }
    return blobError("file_not_found", `\u4E24\u4FA7\u90FD\u627E\u4E0D\u5230\u8FD9\u4E2A\u6587\u4EF6\uFF1A${relative3}`, 404);
  }
  if (looksBinary(wanted)) return blobError("binary_not_supported", "\u8FD9\u662F\u4E8C\u8FDB\u5236\u6587\u4EF6\uFF0C\u4E0D\u63D0\u4F9B\u6587\u672C\u5185\u5BB9", 400);
  return truncateContent(wanted);
}
var CONTENT_TYPES = {
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  avif: "image/avif",
  bmp: "image/bmp",
  mp4: "video/mp4",
  webm: "video/webm",
  pdf: "application/pdf"
};
function contentTypeOf(path) {
  const dot = path.lastIndexOf(".");
  const ext = dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}
async function readReviewRaw(input) {
  const { taskDir } = input;
  if (input.source !== "worktree" && input.source !== "lifeos") {
    return blobError("invalid_source", "source \u53EA\u80FD\u662F worktree \u6216 lifeos", 400);
  }
  if (input.side !== "old" && input.side !== "new") {
    return blobError("invalid_side", "side \u53EA\u80FD\u662F old \u6216 new", 400);
  }
  const relative3 = safeRelativePath(input.path);
  if (relative3 === void 0) return blobError("bad_request", "\u6587\u4EF6\u8DEF\u5F84\u4E0D\u5408\u6CD5\uFF08\u4E0D\u5141\u8BB8\u7EDD\u5BF9\u8DEF\u5F84\u6216 .. \u9003\u9038\uFF09", 400);
  if (!await dirExists(taskDir)) {
    return blobError("task_dir_not_found", `Task \u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${basename5(taskDir)}`, 404);
  }
  const readSide = async (side) => {
    if (input.source === "worktree") {
      const source = (await locateSources(taskDir)).find((item) => item.kind === "worktree");
      if (source === void 0 || !source.exists) return void 0;
      if (side === "old") return readGitBlob(source.path, await worktreeBaseRef(source.path), relative3);
      return readDiskFile(source.path, relative3);
    }
    if (side === "new") return readDiskFile(taskDir, relative3);
    const base = await lifeosBaseline(taskDir);
    if (base === void 0) return void 0;
    return readGitBlob(resolveHome(), base.commit, relativeTo(resolveHome(), join14(taskDir, relative3)));
  };
  const wanted = await readSide(input.side);
  if (wanted === void 0) {
    const other = await readSide(input.side === "old" ? "new" : "old");
    if (other !== void 0) return { bytes: Buffer.alloc(0), contentType: contentTypeOf(relative3) };
    return blobError("file_not_found", `\u4E24\u4FA7\u90FD\u627E\u4E0D\u5230\u8FD9\u4E2A\u6587\u4EF6\uFF1A${relative3}`, 404);
  }
  return { bytes: wanted, contentType: contentTypeOf(relative3) };
}
function relativeTo(root, dir) {
  const r = resolve7(root);
  const d = resolve7(dir);
  if (d === r) return ".";
  if (!d.startsWith(r + "/")) return ".";
  return d.slice(r.length + 1);
}
async function computeWorktreeDiff(source) {
  const baseBranch = await baseBranchOf(source.path);
  let baseRef;
  try {
    if (baseBranch !== void 0) {
      baseRef = (await git3(source.path, ["merge-base", baseBranch, "HEAD"])).trim() || void 0;
    }
  } catch {
  }
  const range = baseRef ?? "HEAD";
  let patch;
  try {
    patch = await diffIncludingUntracked(source.path, range);
  } catch (error) {
    throw gitShortError(error);
  }
  return { source, files: filesFromPatch(patch), truncated: false, ...baseRef !== void 0 ? { base: { commit: baseRef } } : {} };
}
async function treeOfRef(repo, ref) {
  const asTree = await git3(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{tree}`]).catch((error) => {
    console.error(`[review] treeOfRef(${repo}, ${ref}^{tree}) \u5931\u8D25\uFF1A`, error instanceof Error ? error.message : String(error));
    return "";
  });
  if (asTree.trim() !== "") return asTree.trim();
  const peeled = await git3(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}^{tree}`]).catch((error) => {
    console.error(`[review] treeOfRef(${repo}, ${ref}^{commit}^{tree}) \u5931\u8D25\uFF1A`, error instanceof Error ? error.message : String(error));
    return "";
  });
  return peeled.trim() !== "" ? peeled.trim() : EMPTY_TREE;
}
async function diffIncludingUntracked(repo, range) {
  const baseTree = await treeOfRef(repo, range);
  const tmpIndex = join14(tmpdir(), `lifeos-review-${process.pid}-${Date.now()}.idx`);
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
  try {
    await run3("git", ["-C", repo, "read-tree", baseTree], { env, timeout: 3e4, maxBuffer: 1024 * 1024 });
    const skipWorktree = (await git3(repo, ["ls-files", "-v"])).split("\n").filter((line) => line.startsWith("S ")).map((line) => line.slice(2));
    const excludes = skipWorktree.map((path) => `:(exclude)${path}`);
    await run3("git", ["-C", repo, "add", "-A", "--", ".", ...excludes], { env, timeout: 12e4, maxBuffer: 64 * 1024 * 1024 });
    const newTree = (await run3("git", ["-C", repo, "write-tree"], { env, timeout: 6e4, maxBuffer: 1024 * 1024 })).stdout.trim();
    return await git3(repo, ["diff", "--no-color", "--no-ext-diff", "--unified=3", baseTree, newTree]);
  } finally {
    await rm6(tmpIndex, { force: true }).catch(() => void 0);
  }
}
async function baseBranchOf(repo) {
  for (const name of ["main", "master"]) {
    try {
      await git3(repo, ["rev-parse", "--verify", name]);
      return name;
    } catch {
    }
  }
  return void 0;
}
function filesFromPatch(patch) {
  const files = [];
  let totalLines = 0;
  let hitLimit = false;
  for (const section of splitPatchByFile(patch)) {
    if (files.length >= MAX_REVIEW_FILES) {
      hitLimit = true;
      break;
    }
    const meta = fileMetaOf(section.header);
    if (meta === void 0) continue;
    const hunks = parseUnifiedPatchToHunks(section.body);
    let additions = 0;
    let deletions = 0;
    let lines = 0;
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.type === "added") additions++;
        else if (line.type === "removed") deletions++;
        lines++;
      }
    }
    const remaining = MAX_REVIEW_DIFF_LINES - totalLines;
    if (lines <= remaining) {
      totalLines += lines;
      files.push({ ...meta, additions, deletions, hunks });
      continue;
    }
    const kept = [];
    let keptLines = 0;
    let keptAdd = 0;
    let keptDel = 0;
    for (const hunk of hunks) {
      if (keptLines >= remaining) break;
      const budget = remaining - keptLines;
      if (hunk.lines.length <= budget) {
        kept.push(hunk);
        keptLines += hunk.lines.length;
        keptAdd += hunk.lines.filter((l) => l.type === "added").length;
        keptDel += hunk.lines.filter((l) => l.type === "removed").length;
        continue;
      }
      const clipped = { ...hunk, lines: hunk.lines.slice(0, budget) };
      kept.push(clipped);
      keptLines += budget;
      keptAdd += clipped.lines.filter((l) => l.type === "added").length;
      keptDel += clipped.lines.filter((l) => l.type === "removed").length;
      break;
    }
    totalLines += keptLines;
    files.push({ ...meta, additions: keptAdd, deletions: keptDel, hunks: kept, truncated: true });
    hitLimit = true;
    break;
  }
  const last = files[files.length - 1];
  if (hitLimit && last !== void 0 && last.truncated !== true) last.truncated = true;
  return files;
}
function splitPatchByFile(patch) {
  const sections = [];
  let current;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = { header: [line], body: [] };
      sections.push(current);
      inHunk = false;
      continue;
    }
    if (current === void 0) continue;
    if (line.startsWith("@@")) inHunk = true;
    if (inHunk) current.body.push(line);
    else current.header.push(line);
  }
  return sections;
}
function fileMetaOf(headerLines) {
  const diffLine = headerLines[0] ?? "";
  const m = /^diff --git a\/(.+) b\/(.+)$/.exec(diffLine);
  if (m === null) return void 0;
  const aPath = m[1];
  const bPath = m[2];
  const text = headerLines.join("\n");
  let status = "modified";
  let oldPath;
  if (/^new file mode/m.test(text)) status = "added";
  else if (/^deleted file mode/m.test(text)) status = "deleted";
  else if (/^copy from |^rename from /m.test(text)) {
    status = "renamed";
    const rm12 = /^rename from (.+)$/m.exec(text);
    if (rm12 !== null) oldPath = rm12[1];
  }
  const path = status === "deleted" ? aPath ?? "" : bPath ?? aPath ?? "";
  return { path, kind: fileKindOf(path), status, ...oldPath !== void 0 ? { oldPath } : {} };
}
async function computeReviewDiff(taskDir) {
  if (!await dirExists(taskDir)) {
    return { error: { code: "task_dir_not_found", message: `Task \u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${basename5(taskDir)}`, status: 404 } };
  }
  const sources = await locateSources(taskDir);
  const items = [];
  for (const source of sources) {
    if (source.kind === "worktree") {
      if (!source.exists) {
        items.push({ source, files: [], truncated: false });
        continue;
      }
      try {
        items.push(await computeWorktreeDiff(source));
      } catch (error) {
        const e = error;
        if (e.code === "no_vcs") {
          items.push({ source, files: [], truncated: false, degraded: "no_vcs" });
        } else {
          console.error(`[review] worktree diff \u5931\u8D25 (${source.path}):`, e.message);
          items.push({ source, files: [], truncated: false });
        }
      }
    } else {
      const homeWorktree = join14(taskDir, HOME_DIR);
      if (await dirExists(homeWorktree)) {
        try {
          items.push(await computeWorktreeDiff({ ...source, path: homeWorktree }));
        } catch (error) {
          const e = error;
          console.error(`[review] home worktree diff \u5931\u8D25 (${homeWorktree}):`, e?.message ?? String(error));
          items.push({ source, files: [], truncated: false, degraded: "no_vcs" });
        }
      } else {
        items.push(await computeLifeosDiff(taskDir));
      }
    }
  }
  return { items };
}

// src/review-overview.ts
var OVERVIEW_FILE_SAMPLE = 20;
var OVERVIEW_COMMENT_SAMPLE = 10;
var PREVIEW_CHARS = 120;
var preview = (body) => {
  const first = body.trim().split("\n")[0] ?? "";
  return first.length <= PREVIEW_CHARS ? first : `${first.slice(0, PREVIEW_CHARS)}\u2026`;
};
var whereOf = (c) => {
  const { path, side, start, end } = c.anchor;
  return `${path}:${start === end ? `L${start}` : `L${start}-L${end}`} (${side})`;
};
async function reviewOverviewOf(taskDir, taskId) {
  const warnings = [];
  const diff = await computeReviewDiff(taskDir);
  if ("error" in diff && diff.error !== void 0) {
    warnings.push(`${diff.error.code}\uFF1A${diff.error.message}`);
  }
  const items = "items" in diff && diff.items !== void 0 ? diff.items : [];
  const sources = items.map((item) => ({
    kind: item.source.kind,
    path: item.source.path,
    exists: item.source.exists,
    ...item.source.branch !== void 0 ? { branch: item.source.branch } : {},
    ...item.source.head !== void 0 ? { head: item.source.head } : {},
    ...item.degraded !== void 0 ? { degraded: item.degraded } : {}
  }));
  const allFiles = items.flatMap((item) => item.files.map((file) => ({ file, kind: item.source.kind })));
  const files = {
    total: allFiles.length,
    code: allFiles.filter((entry) => entry.file.kind === "code").length,
    doc: allFiles.filter((entry) => entry.file.kind === "doc").length,
    other: allFiles.filter((entry) => entry.file.kind === "other").length,
    additions: allFiles.reduce((sum, entry) => sum + entry.file.additions, 0),
    deletions: allFiles.reduce((sum, entry) => sum + entry.file.deletions, 0),
    truncated: items.some((item) => item.truncated),
    sample: allFiles.slice(0, OVERVIEW_FILE_SAMPLE).map((entry) => `${entry.kind === "lifeos" ? "[\u6587\u6863\u6E90] " : ""}${entry.file.path} (+${entry.file.additions} -${entry.file.deletions})`)
  };
  const comments = await readComments(taskDir);
  const byState = { draft: 0, open: 0, resolved: 0 };
  const awaiting = { none: 0, user: 0, agent: 0 };
  for (const comment of comments) {
    byState[comment.state] += 1;
    if (comment.state === "resolved") continue;
    if (comment.awaiting === null) awaiting.none += 1;
    else awaiting[comment.awaiting] += 1;
  }
  const pendingAgent = pendingFor(comments, "agent").length;
  const pendingUser = pendingFor(comments, "user").length;
  const latest = [...comments].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, OVERVIEW_COMMENT_SAMPLE).map((comment) => ({
    id: comment.id,
    where: whereOf(comment),
    author: `${comment.author.kind}:${comment.author.id}`,
    state: comment.state,
    awaiting: comment.awaiting,
    replies: comment.replies.length,
    preview: preview(comment.body)
  }));
  return {
    taskId,
    taskDir,
    sources,
    files,
    comments: {
      total: comments.length,
      byState,
      awaiting,
      pendingForAgent: pendingAgent,
      pendingForUser: pendingUser,
      threadsWithReplies: comments.filter((comment) => comment.replies.length > 0).length,
      latest
    },
    warnings
  };
}
function formatReviewOverview(overview) {
  const lines = [];
  const { taskId, files, comments } = overview;
  lines.push(`Review state for task ${taskId}`);
  lines.push("", "Sources:");
  for (const source of overview.sources) {
    const label = source.kind === "worktree" ? "project code (repo/)" : "home documents (~/.lifeos)";
    const meta = [source.branch !== void 0 ? `branch ${source.branch}` : void 0, source.head !== void 0 ? `@ ${source.head}` : void 0].filter((part) => part !== void 0).join(" ");
    const state = source.exists ? meta === "" ? "exists" : `exists, ${meta}` : "missing";
    lines.push(`- ${label}: ${source.path} (${state})${source.degraded !== void 0 ? ` [${source.degraded}]` : ""}`);
  }
  const missingWorktree = overview.sources.some((source) => source.kind === "worktree" && !source.exists);
  if (missingWorktree) {
    lines.push("  note: no code worktree for this task yet \u2014 it is expected at <taskDir>/repo/ (legacy tasks: evidence/worktree/).");
  }
  lines.push("", `Changes: ${files.total} file(s) (+${files.additions} -${files.deletions}) \u2014 code ${files.code}, doc ${files.doc}, other ${files.other}${files.truncated ? " [truncated]" : ""}`);
  for (const line of files.sample) lines.push(`- ${line}`);
  if (files.total > files.sample.length) lines.push(`- \u2026and ${files.total - files.sample.length} more`);
  lines.push("", `Comments: ${comments.total} thread(s) \u2014 draft ${comments.byState.draft}, open ${comments.byState.open}, resolved ${comments.byState.resolved}`);
  lines.push(`Waiting (open threads only): for you ${comments.pendingForAgent}, for the user ${comments.pendingForUser}, unassigned ${comments.awaiting.none} (${comments.threadsWithReplies} thread(s) have replies)`);
  for (const item of comments.latest) {
    const who = item.state === "resolved" || item.awaiting === null ? "" : ` waiting:${item.awaiting}`;
    lines.push(`- ${item.id} ${item.where} by ${item.author} \xB7 ${item.state}${who} \xB7 ${item.replies} repl${item.replies === 1 ? "y" : "ies"} \u2014 ${item.preview}`);
  }
  if (comments.total > comments.latest.length) lines.push(`- \u2026and ${comments.total - comments.latest.length} more`);
  lines.push(
    "",
    "Next:",
    "- `lifeos_review_comments({ taskId, pendingForMe: true })` \u2014 the threads that still wait for you (your review TODO).",
    "- `lifeos_review_comments({ taskId })` \u2014 every thread with full text and replies.",
    "- `lifeos_review_comment_reply({ taskId, id, body })` \u2014 say what you changed and where (this hands the thread back to the user).",
    "- `lifeos_review_comment_resolve({ taskId, id })` \u2014 close a thread **you** raised; threads the user raised can only be closed by the user."
  );
  if (overview.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of overview.warnings) lines.push(`- ${warning}`);
  }
  return lines.join("\n");
}

// src/memory/index.ts
import { randomUUID } from "node:crypto";

// src/memory/store.ts
import { mkdir as mkdir11, writeFile as writeFile13 } from "node:fs/promises";
import { join as join17 } from "node:path";
import { bootstrapMemoryCoreFull } from "@memtensor/memos-local-plugin/dist/core/pipeline/memory-core.js";
import { resolveHome as memosResolveHome } from "@memtensor/memos-local-plugin/dist/core/config/index.js";

// src/memory/config.ts
init_home();
import { readFile as readFile13, rename as rename6, writeFile as writeFile12 } from "node:fs/promises";
import { join as join15 } from "node:path";
var DEFAULT_EMBEDDING = {
  endpoint: "http://127.0.0.1:11434/v1",
  model: "nomic-embed-text",
  apiKey: "ollama"
};
var quote = (value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
var ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
function expandEnvValue(raw, what) {
  if (raw.startsWith("!")) {
    throw new Error(`${what}\uFF1Amemory \u94FE\u8DEF\u4E0D\u652F\u6301 !command \u5F62\u5F0F\u7684\u5BC6\u94A5\uFF0C\u8BF7\u6539\u7528 \${ENV} \u5F15\u7528`);
  }
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const dollar = raw.indexOf("$", i);
    if (dollar < 0) {
      out += raw.slice(i);
      break;
    }
    out += raw.slice(i, dollar);
    const next = raw[dollar + 1];
    if (next === "$") {
      out += "$";
      i = dollar + 2;
      continue;
    }
    let name;
    let end;
    if (next === "{") {
      const close = raw.indexOf("}", dollar + 2);
      if (close < 0) {
        out += "$";
        i = dollar + 1;
        continue;
      }
      const candidate = raw.slice(dollar + 2, close);
      if (!ENV_NAME_RE.test(candidate)) {
        out += raw.slice(dollar, close + 1);
        i = close + 1;
        continue;
      }
      name = candidate;
      end = close + 1;
    } else {
      const match = raw.slice(dollar + 1).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (match === null) {
        out += "$";
        i = dollar + 1;
        continue;
      }
      name = match[0];
      end = dollar + 1 + name.length;
    }
    const value = process.env[name];
    if (value === void 0) {
      throw new Error(`${what}\uFF1A\u73AF\u5883\u53D8\u91CF ${name} \u672A\u8BBE\u7F6E\uFF08\u65E0\u6CD5\u89E3\u6790\u5BC6\u94A5\uFF09`);
    }
    out += value;
    i = end;
  }
  return out;
}
async function readJson3(path) {
  return readFile13(path, "utf8").then((text) => JSON.parse(text), () => void 0);
}
async function resolveLlm(config) {
  if (config.llm?.endpoint !== void 0 && config.llm.model !== void 0 && config.llm.apiKey !== void 0) {
    return { provider: config.llm.provider ?? "custom", baseUrl: config.llm.endpoint, apiKey: config.llm.apiKey, model: config.llm.model };
  }
  const models = await readJson3(join15(resolveHome(), "config", "models.json"));
  const providers = models?.providers ?? {};
  const wanted = config.llm?.provider;
  const order = wanted !== void 0 && providers[wanted] !== void 0 ? [wanted] : Object.keys(providers);
  for (const id of order) {
    const provider = providers[id];
    if (provider === void 0 || typeof provider.baseUrl !== "string" || provider.baseUrl === "") continue;
    const model = config.llm?.model ?? provider.models?.find((entry) => typeof entry.id === "string")?.id;
    if (typeof model !== "string" || model === "") continue;
    const rawKey = typeof provider.apiKey === "string" ? provider.apiKey : "";
    if (rawKey === "") continue;
    const apiKey = expandEnvValue(rawKey, `models.json provider "${id}" \u7684 apiKey`);
    return { provider: id, baseUrl: provider.baseUrl, apiKey, model };
  }
  return void 0;
}
async function memoryRuntimeConfig() {
  const file = await readJson3(join15(resolveHome(), "config", "memory.json"));
  const embedding = {
    endpoint: file?.embedding?.endpoint ?? DEFAULT_EMBEDDING.endpoint,
    model: file?.embedding?.model ?? DEFAULT_EMBEDDING.model,
    apiKey: file?.embedding?.apiKey ?? DEFAULT_EMBEDDING.apiKey
  };
  const llm = await resolveLlm(file ?? {});
  if (llm === void 0) {
    throw new Error("\u8BB0\u5FC6\u9700\u8981 LLM\uFF1A\u8BF7\u914D\u7F6E ~/.lifeos/config/memory.json \u6216\u5728 config/models.json \u91CC\u63D0\u4F9B\u5E26 apiKey \u7684 provider");
  }
  const apiKeyEnvName = "LIFEOS_MEMORY_API_KEY";
  const yaml = [
    "embedding:",
    "  provider: openai_compatible",
    `  endpoint: ${quote(embedding.endpoint)}`,
    `  model: ${quote(embedding.model)}`,
    `  apiKey: ${quote(embedding.apiKey)}`,
    "llm:",
    "  provider: openai_compatible",
    `  endpoint: ${quote(llm.baseUrl)}`,
    `  model: ${quote(llm.model)}`,
    `  apiKey: "\${${apiKeyEnvName}}"`,
    "  timeoutMs: 120000",
    ""
  ].join("\n");
  return { yaml, apiKeyEnvName, apiKey: llm.apiKey };
}
async function writeMemoryConfig(root, config) {
  const path = join15(root, "config.yaml");
  const tmp = `${path}.tmp`;
  await writeFile12(tmp, config.yaml, { encoding: "utf8", mode: 384 });
  await rename6(tmp, path);
}

// src/memory/roles.ts
init_home();
import { join as join16 } from "node:path";
var DEFAULT_USER_ID = "default";
var seg = (value) => sanitizeSegment(value);
function roleKey(role) {
  switch (role.kind) {
    case "user":
      return `user:${seg(role.userId ?? DEFAULT_USER_ID)}`;
    case "agent":
      return `agent:${seg(role.agentId)}`;
    case "agent_project":
      return `agent_project:${seg(role.agentId)}:${seg(role.projectId)}`;
    case "project":
      return `project:${seg(role.projectId)}`;
  }
}
function storeRoot(role) {
  const home2 = resolveHome();
  switch (role.kind) {
    case "user":
      return join16(home2, "memory", "user", seg(role.userId ?? DEFAULT_USER_ID));
    case "agent":
      return join16(home2, "agents", seg(role.agentId), "memory");
    case "agent_project":
      return join16(home2, "agents", seg(role.agentId), "projects", seg(role.projectId), "memory");
    case "project":
      return join16(home2, "projects", seg(role.projectId), "memory");
  }
}
function roleLabel(role) {
  switch (role.kind) {
    case "user":
      return `\u7528\u6237\u8BB0\u5FC6\uFF08${role.userId ?? DEFAULT_USER_ID}\uFF09`;
    case "agent":
      return `Agent \u8BB0\u5FC6\uFF08${role.agentId}\uFF09`;
    case "agent_project":
      return `agent \u7684\u9879\u76EE\u8BB0\u5FC6\uFF08${role.agentId} @ ${role.projectId}\uFF09`;
    case "project":
      return `\u9879\u76EE\u5171\u4EAB\u8BB0\u5FC6\uFF08${role.projectId}\uFF09`;
  }
}
function defaultReadOrder(input) {
  return [
    { kind: "agent_project", agentId: input.agentId, projectId: input.projectId },
    { kind: "project", projectId: input.projectId },
    { kind: "agent", agentId: input.agentId },
    { kind: "user", ...input.userId !== void 0 ? { userId: input.userId } : {} }
  ];
}

// src/memory/store.ts
var RUNTIME_NOTE = `# \u8BB0\u5FC6\u8FD0\u884C\u65F6\u76EE\u5F55

- \u80CC\u666F\uFF1AMemOS \u8BB0\u5FC6\u6A21\u5757\u81EA\u52A8\u521B\u5EFA/\u7EF4\u62A4\u7684\u8FD0\u884C\u65F6\u76EE\u5F55\uFF0C\u5185\u5BB9\u968F\u4F7F\u7528\u53D8\u5316\u3002
- \u5185\u5BB9\uFF1A\u6570\u636E\u5E93\u3001\u65E5\u5FD7\u3001\u5B88\u62A4\u8FDB\u7A0B\u6216\u6280\u80FD\u7F13\u5B58\uFF1B\u4E0D\u662F\u9700\u8981\u4EBA\u8BFB\u7684\u6587\u6863\u3002
- \u4F55\u65F6\u8BFB\uFF1A\u6392\u969C\u3001\u5907\u4EFD\u3001\u8FC1\u79FB\u65F6\uFF1B\u65E5\u5E38\u4E0D\u7528\u6253\u5F00\u3002
- \u600E\u4E48\u7528\uFF1A\u4E0D\u8981\u624B\u6539\u6216\u5220\u9664\u6B63\u5728\u4F7F\u7528\u7684\u6587\u4EF6\uFF1B\u8FC1\u79FB/\u5907\u4EFD\u524D\u5148\u505C\u540E\u7AEF\u3002
`;
var stores = /* @__PURE__ */ new Map();
function storeFor(role) {
  const key = roleKey(role);
  const existing = stores.get(key);
  if (existing !== void 0) return existing;
  const pending2 = (async () => {
    const root = storeRoot(role);
    await mkdir11(root, { recursive: true, mode: 448 });
    const config = await memoryRuntimeConfig();
    process.env[config.apiKeyEnvName] = config.apiKey;
    await writeMemoryConfig(root, config);
    const home2 = memosResolveHome("lifeos", root);
    const { core } = await bootstrapMemoryCoreFull({ agent: "lifeos", home: home2, initLogging: false });
    await core.init();
    for (const dir of [home2.dataDir, home2.logsDir, home2.daemonDir, home2.skillsDir]) {
      await mkdir11(dir, { recursive: true, mode: 448 }).catch(() => void 0);
      await writeFile13(join17(dir, "AGENTS.md"), RUNTIME_NOTE, { flag: "wx", mode: 384 }).catch(() => void 0);
    }
    return { core, root };
  })();
  stores.set(key, pending2);
  pending2.catch(() => stores.delete(key));
  return pending2;
}

// src/memory/merge.ts
function mergeRoleHits(groups, limit) {
  if (limit <= 0) return [];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const group of groups) {
    for (const hit of group.hits) {
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      out.push({ ...hit, role: group.role });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// src/memory/index.ts
async function recordMemory(role, input) {
  const { core } = await storeFor(role);
  const ts = input.ts ?? Date.now();
  const sessionId = input.sessionId ?? `memory-${randomUUID()}`;
  const session = await core.openSession({ agent: "lifeos", sessionId });
  const episodeId = await core.openEpisode({ sessionId: session, userMessage: input.userText });
  await core.onTurnStart({
    agent: "lifeos",
    sessionId: session,
    episodeId,
    userText: input.userText,
    ts
  });
  return await core.onTurnEnd({
    agent: "lifeos",
    sessionId: session,
    episodeId,
    agentText: input.agentText,
    toolCalls: input.toolCalls ?? [],
    ts
  });
}
async function searchMemory(role, query, options = {}) {
  const { core } = await storeFor(role);
  const result = await core.searchMemory({ agent: "lifeos", query, reason: "tool_driven" });
  const hits = result.hits ?? [];
  return hits.slice(0, options.limit ?? 20).map((hit) => ({ id: hit.refId, score: hit.score, text: String(hit.snippet ?? "") }));
}
async function searchMemoryScopes(roles, query, options = {}) {
  const limit = options.limit ?? 20;
  const groups = [];
  for (const role of roles) {
    groups.push({ role, hits: await searchMemory(role, query, { limit }) });
  }
  return mergeRoleHits(groups, limit);
}
async function deleteMemory(role, id) {
  const { core } = await storeFor(role);
  const result = await core.deleteTrace(id);
  return result.deleted === true;
}

// src/memory/resolve.ts
function resolveMemoryRole(input) {
  const projectId = input.targetProjectId ?? input.currentProjectId;
  const crossProject = projectId !== input.currentProjectId;
  if (crossProject && input.scope !== "project") {
    return { error: "\u8DE8\u9879\u76EE\u53EA\u80FD\u8BBF\u95EE\u8BE5\u9879\u76EE\u7684\u9879\u76EE\u5171\u4EAB\u8BB0\u5FC6\uFF08scope=project\uFF09\uFF1Bagent \u7684\u9879\u76EE\u8BB0\u5FC6\u3001Agent \u8BB0\u5FC6\u3001\u7528\u6237\u8BB0\u5FC6\u4E0D\u80FD\u8DE8\u9879\u76EE\u6307\u5B9A" };
  }
  if (crossProject && input.action !== "search") {
    return { error: "\u4E0D\u5141\u8BB8\u8DE8\u9879\u76EE\u5199\u5165\u6216\u5220\u9664\u8BB0\u5FC6\uFF08\u53EA\u80FD\u8BFB\u9879\u76EE\u5171\u4EAB\u8BB0\u5FC6\uFF09" };
  }
  switch (input.scope) {
    case "agent_project":
      return { role: { kind: "agent_project", agentId: input.agentId, projectId } };
    case "project":
      return { role: { kind: "project", projectId } };
    case "agent":
      return { role: { kind: "agent", agentId: input.agentId } };
    case "user":
      return { role: { kind: "user" } };
  }
}

// src/peer.ts
import { readdir as readdir12, readFile as readFile14, stat as stat11 } from "node:fs/promises";
import { join as join18 } from "node:path";

// src/peer-completion.ts
var pending = /* @__PURE__ */ new Map();
var sent = /* @__PURE__ */ new Map();
var COMPLETION_TTL_MS = 10 * 60 * 1e3;
var COMPLETION_CAP = 4096;
var deliverer;
var keyOf2 = (targetAgentId, sessionId) => `${targetAgentId}\0${sessionId}`;
var completionKey = (targetAgentId, sessionId, turnId) => `${targetAgentId}\0${sessionId}\0${turnId}`;
function setPeerDeliverer(fn) {
  deliverer = fn;
}
function registerPendingPeer(targetAgentId, sessionId, entry) {
  pending.set(keyOf2(targetAgentId, sessionId), entry);
}
function bindPendingPeerTurn(targetAgentId, sessionId, turnId) {
  const key = keyOf2(targetAgentId, sessionId);
  const entry = pending.get(key);
  if (entry === void 0 || entry.turnId !== void 0) return;
  pending.set(key, { ...entry, turnId });
}
function completionAlreadySent(targetAgentId, sessionId, turnId) {
  const at = sent.get(completionKey(targetAgentId, sessionId, turnId));
  return at !== void 0 && Date.now() - at <= COMPLETION_TTL_MS;
}
function markCompletionSent(targetAgentId, sessionId, turnId) {
  const now = Date.now();
  for (const [key, at] of sent) if (now - at > COMPLETION_TTL_MS) sent.delete(key);
  if (sent.size >= COMPLETION_CAP) {
    const oldest = [...sent.entries()].sort((a, b) => a[1] - b[1])[0];
    if (oldest !== void 0) sent.delete(oldest[0]);
  }
  sent.set(completionKey(targetAgentId, sessionId, turnId), now);
}
async function notifyPeerTurnFinished(targetAgentId, sessionId, turnId, state) {
  const entry = pending.get(keyOf2(targetAgentId, sessionId));
  if (entry === void 0) return false;
  if (entry.turnId !== void 0 && entry.turnId !== turnId) return false;
  if (deliverer === void 0) return false;
  if (completionAlreadySent(targetAgentId, sessionId, turnId)) return false;
  try {
    const delivered = await deliverer({ ...entry, targetAgentId, sessionId, turnId, state });
    if (!delivered) return false;
    markCompletionSent(targetAgentId, sessionId, turnId);
    pending.delete(keyOf2(targetAgentId, sessionId));
    return true;
  } catch {
    return false;
  }
}

// src/peer.ts
init_home();
var PEER_ENTRY = "lifeos_peer";
var PEER_DONE_ENTRY = "lifeos_peer_done";
async function resolvePeer(sourceAgentId, targetAgentId) {
  if (targetAgentId === sourceAgentId) return { ok: false, code: "self" };
  const agent = await readAgent(targetAgentId);
  if (agent === void 0) return { ok: false, code: "unknown_agent" };
  if (agent.archivedAt !== void 0) return { ok: false, code: "archived" };
  return { ok: true, name: agent.name };
}
var peerIndex = /* @__PURE__ */ new Map();
function laneKey(sourceAgentId, targetAgentId, projectId, taskId) {
  return `${resolveHome()}\0${sourceAgentId}|${targetAgentId}|${projectId}|${taskId ?? ""}`;
}
function peerSessionsDir(targetAgentId, projectId) {
  return join18(resolveHome(), "agents", targetAgentId, "projects", projectId, "sessions");
}
async function markerOfSessionFile(file) {
  let text;
  try {
    text = await readFile14(file, "utf8");
  } catch {
    return void 0;
  }
  let found;
  for (const line of text.split("\n")) {
    if (line.trim() === "" || !line.includes(PEER_ENTRY)) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type !== "custom" || entry.customType !== PEER_ENTRY) continue;
      const data = entry.data ?? {};
      const peer = data.peerAgentId;
      if (typeof peer !== "string" || peer === "") continue;
      found = {
        peerAgentId: peer,
        ...typeof data.initiatorTaskId === "string" ? { initiatorTaskId: data.initiatorTaskId } : {},
        ...typeof data.targetAgentId === "string" ? { targetAgentId: data.targetAgentId } : {},
        ...typeof data.projectId === "string" ? { projectId: data.projectId } : {},
        ...typeof data.at === "string" ? { at: data.at } : {}
      };
    } catch {
    }
  }
  return found;
}
async function listPeerSessions(sourceAgentId, targetAgentId, projectId) {
  const dir = peerSessionsDir(targetAgentId, projectId);
  const files = await readdir12(dir).catch(() => []);
  const out = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(file);
    const sessionId = match?.[1];
    if (sessionId === void 0) continue;
    const marker = await markerOfSessionFile(join18(dir, file));
    if (marker === void 0) continue;
    if (marker.peerAgentId !== sourceAgentId) continue;
    const info = await stat11(join18(dir, file)).catch(() => void 0);
    const text = await readFile14(join18(dir, file), "utf8").catch(() => "");
    const messages = text.split("\n").reduce((count, line) => {
      if (line.trim() === "" || !line.includes('"message"')) return count;
      try {
        return JSON.parse(line).type === "message" ? count + 1 : count;
      } catch {
        return count;
      }
    }, 0);
    out.push({
      sessionId,
      marker,
      updatedAtMs: info?.mtimeMs ?? 0,
      messages,
      running: isRunning(targetAgentId, sessionId)
    });
  }
  return out.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}
function inLane(entry, sourceAgentId, taskId) {
  if (entry.marker.peerAgentId !== sourceAgentId) return false;
  if (entry.marker.initiatorTaskId === void 0) return true;
  if (taskId === void 0) return true;
  return entry.marker.initiatorTaskId === taskId;
}
async function peerConversation(sourceAgentId, targetAgentId, projectId, cwd, options = {}) {
  const verdict = await resolvePeer(sourceAgentId, targetAgentId);
  if (!verdict.ok) return verdict;
  const project = await ensurePeerProject(sourceAgentId, targetAgentId, projectId);
  if (!project.ok) return { ok: false, code: "unknown_agent" };
  projectId = project.projectId;
  const taskId = options.taskId;
  const key = laneKey(sourceAgentId, targetAgentId, projectId, taskId);
  if (options.sessionId !== void 0) {
    const wanted = options.sessionId;
    const all = await listPeerSessions(sourceAgentId, targetAgentId, projectId);
    const hit = all.find((entry) => entry.sessionId === wanted);
    if (hit === void 0) {
      return { ok: false, code: "session_not_found", available: all.map((entry) => entry.sessionId) };
    }
    if (!inLane(hit, sourceAgentId, taskId)) {
      return {
        ok: false,
        code: "session_not_in_lane",
        available: all.filter((entry) => inLane(entry, sourceAgentId, taskId)).map((entry) => entry.sessionId)
      };
    }
    peerIndex.set(key, hit.sessionId);
    return {
      ok: true,
      name: verdict.name,
      conversation: { agentId: targetAgentId, sessionId: hit.sessionId, created: false, ...hit.marker.initiatorTaskId !== void 0 ? { initiatorTaskId: hit.marker.initiatorTaskId } : {} }
    };
  }
  if (options.newSession === true) {
    return await createPeerConversation(sourceAgentId, targetAgentId, projectId, cwd, taskId, verdict.name, key);
  }
  const memo = peerIndex.get(key);
  if (memo !== void 0) {
    return { ok: true, conversation: { agentId: targetAgentId, sessionId: memo, created: false, ...taskId !== void 0 ? { initiatorTaskId: taskId } : {} }, name: verdict.name };
  }
  const lane = (await listPeerSessions(sourceAgentId, targetAgentId, projectId)).filter((entry) => inLane(entry, sourceAgentId, taskId));
  const newest = lane[0];
  if (newest !== void 0) {
    peerIndex.set(key, newest.sessionId);
    return {
      ok: true,
      name: verdict.name,
      conversation: {
        agentId: targetAgentId,
        sessionId: newest.sessionId,
        created: false,
        ...newest.marker.initiatorTaskId !== void 0 ? { initiatorTaskId: newest.marker.initiatorTaskId } : {}
      }
    };
  }
  return await createPeerConversation(sourceAgentId, targetAgentId, projectId, cwd, taskId, verdict.name, key);
}
async function laneCount(sourceAgentId, targetAgentId, projectId, taskId) {
  const all = await listPeerSessions(sourceAgentId, targetAgentId, projectId);
  return all.filter((entry) => inLane(entry, sourceAgentId, taskId)).length;
}
async function createPeerConversation(sourceAgentId, targetAgentId, projectId, cwd, taskId, peerName, key) {
  const sessionId = await createSession(targetAgentId, cwd, projectId);
  const state = await getSession(targetAgentId, sessionId, cwd);
  const marker = {
    // 对端 = 发起方（会话建在目标 Agent 的项目里；M1 语义不变，`peerMarkerOf` 靠它对 server 做只读检查）
    peerAgentId: sourceAgentId,
    targetAgentId,
    ...taskId !== void 0 ? { initiatorTaskId: taskId } : {},
    projectId,
    at: (/* @__PURE__ */ new Date()).toISOString()
  };
  state?.session.sessionManager.appendCustomEntry(PEER_ENTRY, marker);
  await persistPeerMarker(sessionId, targetAgentId, projectId, marker);
  peerIndex.set(key, sessionId);
  return {
    ok: true,
    name: peerName,
    conversation: { agentId: targetAgentId, sessionId, created: true, ...taskId !== void 0 ? { initiatorTaskId: taskId } : {} }
  };
}
function lastReply(state) {
  if (state === void 0) return void 0;
  const messages = messagesOf(state);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    const text = (message.text ?? "").trim();
    if (text !== "") return text;
  }
  return void 0;
}
async function persistPeerMarker(sessionId, targetAgentId, projectId, marker) {
  const { appendFile: appendFile2, mkdir: mkdir18, readdir: readdir20, writeFile: writeFile21 } = await import("node:fs/promises");
  const dir = peerSessionsDir(targetAgentId, projectId);
  await mkdir18(dir, { recursive: true });
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const entry = `${JSON.stringify({
    type: "custom",
    customType: PEER_ENTRY,
    data: marker,
    id: `${stamp}_0`.replace(/[^A-Za-z0-9_-]/g, ""),
    parentId: null,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  })}
`;
  const files = await readdir20(dir).catch(() => []);
  const existing = files.find((file) => file.includes(sessionId) && file.endsWith(".jsonl"));
  if (existing !== void 0) {
    await appendFile2(join18(dir, existing), entry);
    return;
  }
  await writeFile21(join18(dir, `${stamp}_${sessionId}.jsonl`), entry, { flag: "wx" }).catch(() => void 0);
}
var ASK_DEFAULT_TIMEOUT_MS = 10 * 60 * 1e3;
function lastBlocksOf(state) {
  if (state === void 0) return [];
  const messages = messagesOf(state);
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    return message.blocks ?? [];
  }
  return [];
}
function derivePhase(lastBlocks) {
  const last = lastBlocks.at(-1);
  if (last === void 0) return { phase: "waiting" };
  if (last.type === "thinking") return { phase: "thinking" };
  if (last.type === "toolCall") {
    if (last.result !== void 0) return { phase: "thinking" };
    return last.name !== void 0 ? { phase: "tool", activeTool: last.name } : { phase: "tool" };
  }
  if (last.type === "text") return { phase: "text" };
  return { phase: "waiting" };
}
async function peerSnapshot(targetAgentId, sessionId, initiatorTaskId, messagesBeforeSend) {
  const base = { agentId: targetAgentId, sessionId, ...initiatorTaskId !== void 0 ? { initiatorTaskId } : {} };
  const running2 = isRunning(targetAgentId, sessionId);
  const state = await getSession(targetAgentId, sessionId, resolveHome());
  if (state === void 0 && !running2) {
    return { ...base, state: "missing", messages: 0, canWaitMore: false, next: "\u8FD9\u6761\u4F1A\u8BDD\u5DF2\u4E0D\u5B58\u5728\uFF08\u53EF\u80FD\u88AB\u5220\u9664\uFF09\u3002\u8BF7\u91CD\u65B0\u53D1\u6D88\u606F\u6216\u6362\u4E00\u4E2A\u76EE\u6807\u4F1A\u8BDD\u3002" };
  }
  const messages = state !== void 0 ? messagesOf(state).length : 0;
  const accepted = messagesBeforeSend === void 0 ? void 0 : messages > messagesBeforeSend;
  const { turn } = await turnLastOf(targetAgentId, sessionId).catch(() => ({ turn: null }));
  const reply = state !== void 0 ? lastReply(state) : void 0;
  if (running2) {
    const startedMs = turn?.state === "running" ? Date.parse(turn.at) : Number.NaN;
    const derived = derivePhase(lastBlocksOf(state));
    return {
      ...base,
      state: "running",
      phase: derived.phase,
      ...derived.activeTool !== void 0 ? { activeTool: derived.activeTool } : {},
      ...accepted !== void 0 ? { myMessageAccepted: accepted } : {},
      ...turn !== null ? { turnId: turn.turnId } : {},
      ...Number.isNaN(startedMs) ? {} : { startedAt: new Date(startedMs).toISOString(), runningForMs: Date.now() - startedMs },
      messages,
      canWaitMore: true,
      next: "\u5BF9\u65B9\u8FD8\u5728\u5904\u7406\u4E2D\u3002\u53EF\u4EE5\u518D\u7B49\u4E00\u4F1A\u513F\u3001\u53BB\u67E5\u5B83\u7684\u8FC7\u7A0B\uFF08\u5B83\u662F\u4E00\u6761\u666E\u901A\u4F1A\u8BDD\uFF09\uFF0C\u6216\u8005\u5148\u628A\u8FD9\u4EF6\u4E8B\u653E\u4E0B\u505A\u522B\u7684\uFF1B\u4E0D\u8981 sleep \u8F6E\u8BE2\u3002"
    };
  }
  if (turn?.state === "error") {
    return {
      ...base,
      state: "error",
      ...accepted !== void 0 ? { myMessageAccepted: accepted } : {},
      ...turn.turnId !== void 0 ? { turnId: turn.turnId } : {},
      finishedAt: turn.at,
      ...reply !== void 0 ? { lastReply: reply } : {},
      failure: { kind: "unknown", message: "\u5BF9\u65B9\u56DE\u5408\u4EE5\u5931\u8D25\u7ED3\u675F\uFF08\u5177\u4F53\u539F\u56E0\u89C1\u5B83\u7684\u4F1A\u8BDD\u8BB0\u5F55\uFF09" },
      messages,
      canWaitMore: false,
      next: "\u5BF9\u65B9\u8FD9\u4E00\u8F6E\u5931\u8D25\u4E86\u3002\u770B\u5B83\u7684\u4F1A\u8BDD\u8BB0\u5F55\u786E\u8BA4\u539F\u56E0\uFF1B\u91CD\u8BD5\u524D\u5148\u5224\u65AD\u662F\u5076\u53D1\uFF08\u7F51\u7EDC/\u9650\u6D41\uFF09\u8FD8\u662F\u8FD9\u6761\u8BF7\u6C42\u672C\u8EAB\u6709\u95EE\u9898\u3002"
    };
  }
  if (turn !== null && turn.state === "done") {
    return {
      ...base,
      state: "idle",
      ...accepted !== void 0 ? { myMessageAccepted: accepted } : {},
      ...turn.turnId !== void 0 ? { turnId: turn.turnId } : {},
      finishedAt: turn.at,
      ...reply !== void 0 ? { lastReply: reply } : {},
      messages,
      canWaitMore: false,
      next: reply !== void 0 ? "\u5BF9\u65B9\u5DF2\u56DE\u590D\uFF08lastReply \u5C31\u662F\u5B83\u7684\u56DE\u7B54\uFF09\u3002\u76F4\u63A5\u7528\u5B83\uFF0C\u4E0D\u9700\u8981\u518D\u95EE\u4E00\u904D\u3002" : "\u5BF9\u65B9\u8FD9\u4E00\u8F6E\u7ED3\u675F\u4E86\u4F46\u6CA1\u6709\u6587\u5B57\u56DE\u590D\uFF1B\u9700\u8981\u7ED3\u8BBA\u5C31\u518D\u95EE\u4E00\u6B21\u5E76\u628A\u8981\u6C42\u5199\u5230\u6587\u5B57\u91CC\u3002"
    };
  }
  return {
    ...base,
    state: "idle",
    ...accepted !== void 0 ? { myMessageAccepted: accepted } : {},
    messages,
    canWaitMore: true,
    next: "\u8FD9\u6761\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u8DD1\u8FC7\u56DE\u5408\u3002\u76F4\u63A5\u53D1\u6D88\u606F\u5373\u53EF\u3002"
  };
}
async function deliverPeerCompletion(input) {
  const { targetAgentId, sessionId, turnId, state } = input;
  if (completionAlreadySent(targetAgentId, sessionId, turnId)) return false;
  const initiator = await getSession(input.initiatorAgentId, input.initiatorSessionId, resolveHome());
  if (initiator === void 0) {
    const { log: log2 } = await Promise.resolve().then(() => (init_logging(), logging_exports));
    void log2.error("peer", "deliverPeerCompletion", "\u53D1\u8D77\u65B9\u4F1A\u8BDD\u8BFB\u4E0D\u5230", { details: { agent: input.initiatorAgentId, session: input.initiatorSessionId } });
    return false;
  }
  let snapshot2 = await peerSnapshot(targetAgentId, sessionId, input.initiatorTaskId);
  if (state === "done" && snapshot2.lastReply === void 0) {
    const persisted = await lastAssistantTextFromFile(targetAgentId, sessionId);
    if (persisted !== void 0) snapshot2 = { ...snapshot2, lastReply: persisted };
  }
  const body = [
    `\u3010\u4E0E ${input.peerName} \u7684\u5BF9\u8BDD\u3011${state === "done" ? "\u5DF2\u5B8C\u6210" : "\u5931\u8D25\u4E86"}`,
    `\u4F1A\u8BDD\uFF1A${sessionId}`,
    ...input.initiatorTaskId !== void 0 ? [`Task\uFF1A${input.initiatorTaskId}`] : [],
    ...snapshot2.lastReply !== void 0 ? ["", snapshot2.lastReply] : ["", "\uFF08\u8FD9\u4E00\u8F6E\u6CA1\u6709\u6587\u5B57\u56DE\u590D\uFF09"],
    "",
    `\u4E0B\u4E00\u6B65\uFF1A${state === "done" ? "\u76F4\u63A5\u7528\u4E0A\u9762\u7684\u7ED3\u679C\u63A8\u8FDB\u4F60\u624B\u4E0A\u7684\u4E8B\uFF1B\u9700\u8981\u66F4\u591A\u7EC6\u8282\u5C31\u53BB\u770B\u8FD9\u6761\u4F1A\u8BDD\u3002" : "\u770B\u90A3\u6761\u4F1A\u8BDD\u786E\u8BA4\u5931\u8D25\u539F\u56E0\uFF0C\u518D\u51B3\u5B9A\u91CD\u8BD5\u8FD8\u662F\u6362\u529E\u6CD5\u3002"}`
  ].join("\n");
  try {
    await initiator.session.sendCustomMessage({
      customType: PEER_DONE_ENTRY,
      content: body,
      display: true,
      details: { peerAgentId: targetAgentId, sessionId, turnId, state }
    }, { triggerTurn: false });
  } catch (error) {
    const { log: log2 } = await Promise.resolve().then(() => (init_logging(), logging_exports));
    void log2.error("peer", "deliverPeerCompletion", "\u6295\u9012\u629B\u9519", { details: { message: error instanceof Error ? error.message : String(error) } });
    return false;
  }
  if (input.initiatorTaskId !== void 0) {
    await addTaskParticipant(
      { agentId: input.initiatorAgentId, projectId: input.projectId },
      input.initiatorTaskId,
      targetAgentId
    ).catch(() => void 0);
  }
  return true;
}
setPeerDeliverer(deliverPeerCompletion);
async function ensurePeerProject(sourceAgentId, targetAgentId, projectId) {
  if (projectId === "workspace") return { ok: true, projectId, bound: false };
  const existing = await listAgentProjects(targetAgentId);
  if (existing.some((item) => item.id === projectId)) return { ok: true, projectId, bound: false };
  const source = await listAgentProjects(sourceAgentId);
  const match = source.find((item) => item.id === projectId);
  if (match === void 0) return { ok: false, message: `\u53D1\u8D77\u65B9\u6CA1\u6709\u9879\u76EE "${projectId}"\uFF0C\u65E0\u6CD5\u5728\u76EE\u6807 Agent \u4E0A\u5EFA\u7ACB\u540C\u540D\u9879\u76EE` };
  if (match.path === void 0) return { ok: false, message: `\u9879\u76EE "${projectId}" \u6CA1\u6709\u53EF\u7ED1\u5B9A\u7684\u76EE\u5F55\u8DEF\u5F84` };
  const bound = await bindProject(targetAgentId, match.path);
  if ("code" in bound) return { ok: false, message: `\u65E0\u6CD5\u628A\u9879\u76EE "${projectId}" \u7ED1\u5B9A\u5230\u76EE\u6807 Agent\uFF1A${bound.message}` };
  return { ok: true, projectId: bound.project.id, bound: true };
}
function namePeerSession(state, peerName, ordinal = 1) {
  const manager = state?.session.sessionManager;
  if (manager === void 0 || manager.getSessionName()) return;
  manager.appendSessionInfo(ordinal > 1 ? `\u4E0E ${peerName} \u7684\u5BF9\u8BDD #${ordinal}` : `\u4E0E ${peerName} \u7684\u5BF9\u8BDD`);
}
async function listPeerAgents(selfAgentId) {
  const root = join18(resolveHome(), "agents");
  const entries = await readdir12(root, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const agent = await readAgent(entry.name);
    if (agent === void 0) continue;
    if (agent.id === selfAgentId) continue;
    out.push({
      id: agent.id,
      name: agent.name,
      ...agent.description !== void 0 ? { description: agent.description } : {},
      archived: agent.archivedAt !== void 0
    });
  }
  return out.sort((a, b) => a.id < b.id ? -1 : 1);
}
async function peerSessionTitle(targetAgentId, sessionId) {
  const dirs = await readdir12(join18(resolveHome(), "agents", targetAgentId, "projects")).catch(() => []);
  for (const dir of dirs) {
    const sessionsDir = join18(resolveHome(), "agents", targetAgentId, "projects", dir, "sessions");
    const files = await readdir12(sessionsDir).catch(() => []);
    const file = files.find((name) => name.includes(sessionId) && name.endsWith(".jsonl"));
    if (file === void 0) continue;
    const text = await readFile14(join18(sessionsDir, file), "utf8").catch(() => "");
    let title;
    for (const line of text.split("\n")) {
      if (line.trim() === "" || !line.includes("session_info")) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === "session_info" && typeof entry.name === "string" && entry.name.trim() !== "") title = entry.name;
      } catch {
      }
    }
    return title;
  }
  return void 0;
}
function snapshotText(peerName, snapshot2, hint) {
  const lines = [];
  lines.push(`${peerName} \xB7 state=${snapshot2.state}${hint !== void 0 ? `\uFF08${hint}\uFF09` : ""}`);
  lines.push(`session: ${snapshot2.sessionId}`);
  if (snapshot2.initiatorTaskId !== void 0) lines.push(`task: ${snapshot2.initiatorTaskId}`);
  if (snapshot2.turnId !== void 0) lines.push(`turn: ${snapshot2.turnId}`);
  if (snapshot2.phase !== void 0) {
    lines.push(`\u5728\u505A\u4EC0\u4E48: ${snapshot2.phase}${snapshot2.activeTool !== void 0 ? `\uFF08${snapshot2.activeTool}\uFF09` : ""}`);
  }
  if (snapshot2.myMessageAccepted !== void 0) {
    lines.push(`\u6211\u8FD9\u6761\u6D88\u606F: ${snapshot2.myMessageAccepted ? "\u5DF2\u8FDB\u5165\u5BF9\u65B9\u4F1A\u8BDD" : "**\u6CA1\u6709\u8FDB\u5165**\u5BF9\u65B9\u4F1A\u8BDD"}`);
  }
  if (snapshot2.runningForMs !== void 0) lines.push(`\u5DF2\u5728\u8DD1: ${Math.round(snapshot2.runningForMs / 1e3)}s`);
  if (snapshot2.finishedAt !== void 0) lines.push(`\u7ED3\u675F\u4E8E: ${snapshot2.finishedAt}`);
  lines.push(`\u6D88\u606F\u6570: ${snapshot2.messages}`);
  if (snapshot2.lastReply !== void 0) {
    lines.push("", "\u5B83\u7684\u56DE\u590D\uFF1A", snapshot2.lastReply);
  } else if (snapshot2.state !== "running") {
    lines.push("", "\uFF08\u8FD9\u4E00\u8F6E\u6CA1\u6709\u6587\u5B57\u56DE\u590D\uFF09");
  }
  lines.push("", `\u4E0B\u4E00\u6B65\uFF1A${snapshot2.next}`);
  return lines.join("\n");
}
async function lastAssistantTextFromFile(targetAgentId, sessionId) {
  const read = await readSessionEntries(targetAgentId, sessionId).catch(() => void 0);
  if (read === void 0) return void 0;
  for (let i = read.entries.length - 1; i >= 0; i -= 1) {
    const entry = read.entries[i];
    if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;
    const content = entry.message.content;
    if (typeof content === "string" && content.trim() !== "") return content.trim();
    if (Array.isArray(content)) {
      const text = content.flatMap((part) => part.type === "text" ? [part.text ?? ""] : []).join("").trim();
      if (text !== "") return text;
    }
  }
  return void 0;
}

// src/agent-tools.ts
init_home();
init_logging();

// src/tool-names.ts
var LIFEOS_TOOL_NAMES = [
  "lifeos_agent_create",
  "lifeos_agent_delete",
  "lifeos_task_create",
  "lifeos_task_list",
  "lifeos_task_enter",
  "lifeos_project_add",
  "lifeos_project_remove",
  "lifeos_project_list",
  "lifeos_memory_search",
  "lifeos_memory_record",
  "lifeos_memory_delete",
  "lifeos_ask",
  "lifeos_send",
  "lifeos_agent_list",
  "lifeos_ask_list",
  "lifeos_review_state",
  "lifeos_review_open",
  "lifeos_review_comments",
  "lifeos_review_comment_add",
  "lifeos_review_comment_reply",
  "lifeos_review_comment_resolve",
  "lifeos_media_catalog",
  "lifeos_media_avatar_set"
];

// src/media.ts
init_home();
import { mkdir as mkdir12, readFile as readFile15, readdir as readdir13, stat as stat12, writeFile as writeFile14, rename as rename7 } from "node:fs/promises";
import { join as join19 } from "node:path";
var MEDIA_DIR = "media";
var EMPTY_CATALOG = { schemaVersion: 1, entries: [] };
var mediaRoot = (home2 = resolveHome()) => join19(home2, MEDIA_DIR);
var catalogPath = (home2 = resolveHome()) => join19(mediaRoot(home2), "catalog.json");
var MEDIA_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
function isMediaId(value) {
  return MEDIA_ID.test(value);
}
async function readCatalog(home2 = resolveHome()) {
  const text = await readFile15(catalogPath(home2), "utf8").catch(() => void 0);
  if (text === void 0) return EMPTY_CATALOG;
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.entries)) return EMPTY_CATALOG;
    return { schemaVersion: 1, entries: parsed.entries.filter(isMediaEntry) };
  } catch {
    return EMPTY_CATALOG;
  }
}
function isMediaEntry(value) {
  if (value === null || typeof value !== "object") return false;
  const entry = value;
  return typeof entry.id === "string" && isMediaId(entry.id) && (entry.kind === "avatar" || entry.kind === "emoji") && typeof entry.pack === "string" && typeof entry.file === "string" && entry.file !== "" && !entry.file.includes("..") && typeof entry.mime === "string" && typeof entry.bytes === "number" && Array.isArray(entry.keywords) && entry.keywords.every((k) => typeof k === "string") && typeof entry.source === "string" && typeof entry.license === "string" && typeof entry.addedAt === "string";
}
function sortEntries(entries) {
  return [...entries].sort((a, b) => a.kind !== b.kind ? a.kind.localeCompare(b.kind) : a.pack !== b.pack ? a.pack.localeCompare(b.pack) : a.id.localeCompare(b.id));
}
function findEntry(catalog, id) {
  return catalog.entries.find((entry) => entry.id === id);
}
function searchEntries(catalog, query = {}) {
  const limit = query.limit !== void 0 && query.limit > 0 ? Math.floor(query.limit) : 20;
  const terms = (query.query ?? "").trim().toLowerCase().split(/\s+/).filter((term) => term !== "");
  const pool = catalog.entries.filter((entry) => (query.kind === void 0 || entry.kind === query.kind) && (query.pack === void 0 || entry.pack === query.pack));
  if (terms.length === 0) return sortEntries(pool).slice(0, limit);
  const scored = [];
  for (const entry of pool) {
    const words = [entry.id, ...entry.keywords].map((word) => word.toLowerCase());
    let total = 0;
    let allHit = true;
    for (const term of terms) {
      const hits = words.filter((word) => word.includes(term)).length;
      if (hits === 0) {
        allHit = false;
        break;
      }
      total += hits;
    }
    if (allHit) scored.push({ entry, score: total });
  }
  scored.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
  return scored.slice(0, limit).map((item) => item.entry);
}
function mediaFilePath(home2, entry) {
  return join19(mediaRoot(home2), entry.file);
}
async function readMediaBytes(home2, entry) {
  return readFile15(mediaFilePath(home2, entry)).catch(() => void 0);
}
function sniffMediaImage(buffer) {
  if (buffer.length >= 8 && buffer[0] === 137 && buffer[1] === 80 && buffer[2] === 78 && buffer[3] === 71) return { ext: "png", mime: "image/png" };
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return { ext: "jpg", mime: "image/jpeg" };
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return { ext: "webp", mime: "image/webp" };
  if (buffer.length >= 6 && buffer.toString("ascii", 0, 3) === "GIF") return { ext: "gif", mime: "image/gif" };
  return void 0;
}
async function mediaStats(home2 = resolveHome()) {
  const catalog = await readCatalog(home2);
  let avatar = 0;
  let emoji = 0;
  let totalBytes = 0;
  const packs = /* @__PURE__ */ new Set();
  for (const entry of catalog.entries) {
    if (entry.kind === "avatar") avatar += 1;
    else emoji += 1;
    totalBytes += entry.bytes;
    packs.add(entry.pack);
  }
  return { avatar, emoji, totalBytes, packs: [...packs].sort() };
}
var MEDIA_NOTE = `# media \u2014 \u5A92\u4F53\u5E93\uFF08\u5934\u50CF\u4E0E\u8868\u60C5\u7D20\u6750\uFF09

\u7A0B\u5E8F\u5199\u5165\u7684\u8FD0\u884C\u76EE\u5F55\uFF0C**\u4E0D\u8FDB\u7248\u672C\u63A7\u5236**\u3002

## \u91CC\u9762\u6709\u4EC0\u4E48

- \`catalog.json\`\uFF1A\u6BCF\u4EF6\u7D20\u6750\u7684\u767B\u8BB0\uFF08id / \u79CD\u7C7B avatar\xB7emoji / \u7D20\u6750\u5305 / \u6587\u4EF6 / \u5B57\u8282\u6570 / \u5173\u952E\u8BCD / \u6765\u6E90 / \u8BB8\u53EF / \u6536\u5165\u65F6\u95F4\uFF09\uFF1B
- \`avatar/<id>.<ext>\`\uFF1A\u5934\u50CF\u5019\u9009\u56FE\uFF1B
- \`emoji/<id>.<ext>\`\uFF1A\u8868\u60C5\u56FE\u3002

## \u4EC0\u4E48\u65F6\u5019\u8BFB

\u8981\u7ED9\u67D0\u4E2A Agent \u6362\u5934\u50CF\u3001\u6216\u8981\u8BA9 Agent \u53D1\u4E00\u4E2A\u8868\u60C5\u65F6\u3002**\u4E0D\u8981\u7528 read \u53BB\u8BFB\u8FD9\u91CC\u7684\u56FE**\u2014\u2014
\u8BFB\u56FE\u4F1A\u6309 4800 \u5B57\u7B26/\u5F20\u8FDB\u5165\u4E0A\u4E0B\u6587\uFF08\`pi/packages/ai/src/utils/estimate.ts\`\uFF09\u3002\u7528\u76EE\u5F55\u67E5\u3001\u6309 id \u53D6\u3002

## \u600E\u4E48\u7528

- \u67E5\uFF1A\`lifeos_media_catalog { kind, query }\`\uFF08\u4E2D\u82F1\u6587\u5173\u952E\u8BCD\u90FD\u80FD\u641C\uFF09\uFF1B
- \u6362\u5934\u50CF\uFF1A\`lifeos_media_avatar_set { agentId, mediaId }\`\uFF08\u6A21\u578B\u5168\u7A0B\u4E0D\u63A5\u89E6\u56FE\u7247\u5B57\u8282\uFF09\uFF1B
- \u53D1\u8868\u60C5\uFF1A\u6B63\u6587\u91CC\u5199 \`:shortcode:\`\uFF08\u5982 \`:blush:\`\uFF09\uFF0C\u524D\u7AEF\u6E32\u67D3\u6210\u56FE\uFF1B\u77ED\u7801\u8868\u7528 \`lifeos_media_catalog { kind: "emoji" }\` \u67E5\u3002

## \u7EAA\u5F8B

- **\u5FC5\u987B**\u6BCF\u4EF6\u7D20\u6750\u90FD\u767B\u8BB0 \`source\` \u4E0E \`license\`\uFF1B\u6765\u6E90\u4E0D\u660E\u6216\u6CA1\u6709\u8BB8\u53EF\u7684\u56FE\u4E0D\u8BB8\u6536\u8FDB\u6765\u3002
- **\u5FC5\u987B**\u7528 \`scripts/media-seed.mjs\` \u6536\u5165\u7D20\u6750\uFF08\u5B83\u4FDD\u8BC1\u6821\u9A8C\u3001\u53BB\u91CD\u4E0E\u767B\u8BB0\uFF09\uFF1B\u624B\u5DE5\u5F80\u76EE\u5F55\u91CC\u653E\u56FE\u4F1A\u53D8\u6210"\u767B\u8BB0\u4E4B\u5916\u7684\u5B64\u513F"\u3002
- **\u4E0D\u5E94\u8BE5**\u628A\u8FD9\u91CC\u5F53\u6210\u7528\u6237\u4E0A\u4F20\u9644\u4EF6\u7684\u4ED3\u5E93\u2014\u2014\u9644\u4EF6\u5728 \`attachments/\`\uFF0C\u7531 \`gcAttachments\` \u81EA\u52A8\u6E05\u7406\u3002
`;
async function ensureMediaDir(home2 = resolveHome()) {
  await mkdir12(join19(mediaRoot(home2), "avatar"), { recursive: true, mode: 448 });
  await mkdir12(join19(mediaRoot(home2), "emoji"), { recursive: true, mode: 448 });
  await writeFile14(join19(mediaRoot(home2), "AGENTS.md"), MEDIA_NOTE, { flag: "wx", mode: 384 }).catch(() => void 0);
  const info = await stat12(join19(mediaRoot(home2), "AGENTS.md")).catch(() => void 0);
  if (info === void 0) {
    await writeFile14(join19(mediaRoot(home2), "AGENTS.md"), MEDIA_NOTE, { mode: 384 }).catch(() => void 0);
  }
}

// src/avatar.ts
import { mkdir as mkdir13, rm as rm7, writeFile as writeFile15 } from "node:fs/promises";
import { join as join20 } from "node:path";
init_home();
var MAX_AGENT_AVATAR_BYTES = 2 * 1024 * 1024;
async function setAgentAvatar(agentId, buffer) {
  const agent = await readAgent(agentId);
  if (agent === void 0) {
    return { ok: false, code: "agent_not_found", message: `\u627E\u4E0D\u5230 Agent\uFF1A${agentId}`, status: 404 };
  }
  if (buffer.length > MAX_AGENT_AVATAR_BYTES) {
    return { ok: false, code: "image_too_large", message: `\u5934\u50CF\u4E0D\u80FD\u8D85\u8FC7 ${MAX_AGENT_AVATAR_BYTES / (1024 * 1024)}MB`, status: 400 };
  }
  const sniffed = sniffMediaImage(buffer);
  if (sniffed === void 0) {
    return { ok: false, code: "invalid_image", message: "\u4EC5\u652F\u6301 png/jpg/webp", status: 400 };
  }
  const avatarDir = join20(resolveHome(), "agents", agent.id, "avatar");
  await mkdir13(avatarDir, { recursive: true, mode: 448 });
  await rm7(avatarDir, { recursive: true, force: true });
  await mkdir13(avatarDir, { recursive: true, mode: 448 });
  const file = `avatar.${sniffed.ext}`;
  await writeFile15(join20(avatarDir, file), buffer, { mode: 384 });
  const avatar = { kind: "image", file, revision: Date.now() };
  await writeAgent({ ...agent, avatar });
  broadcast({ type: "agents_changed" });
  return { ok: true, avatar };
}
async function clearAgentAvatar(agentId) {
  const agent = await readAgent(agentId);
  if (agent === void 0) {
    return { ok: false, code: "agent_not_found", message: `\u627E\u4E0D\u5230 Agent\uFF1A${agentId}`, status: 404 };
  }
  await rm7(join20(resolveHome(), "agents", agent.id, "avatar"), { recursive: true, force: true });
  const updated = { ...agent };
  delete updated.avatar;
  await writeAgent(updated);
  broadcast({ type: "agents_changed" });
  return { ok: true };
}

// src/agent-tools.ts
function createAgentTools(ctx) {
  const create = defineTool({
    name: "lifeos_agent_create",
    label: "Create Life OS agent",
    description: "Create a new Life OS agent (a long-lived assistant with its own identity, a default workspace project with its default task, and sessions). The id is generated once and stays stable \u2014 renaming the display name never changes it, so never archive and recreate an agent just to change an id. Creating with an existing agent name returns that agent unchanged (no duplicates). Non-ASCII names get an opaque id such as agent-3f9a; that is expected. The agent gets its standard skeleton (agent.json, identity.md, tools/, memory/, and the workspace project with flywheel, concept-space, cases, knowledge, tools, todo, sessions and tasks/0001-default). Nothing is written outside ~/.lifeos/agents/<id>/, and other agents are untouched.",
    promptSnippet: "Create a new Life OS agent (multi-agent)",
    promptGuidelines: [
      "Use lifeos_agent_create when the user asks for a second assistant with a different role or focus; report the returned id so they can switch with ?agent=<id>."
    ],
    parameters: Type.Object({
      name: Type.String({ description: "Display name of the new agent, e.g. 'Code Reviewer'. Used to generate the id." }),
      description: Type.Optional(Type.String({ description: "One-line summary shown in the agent list (not injected into the prompt)." }))
    }),
    async execute(_toolCallId, params) {
      const result = await createAgent({ name: params.name, ...params.description !== void 0 ? { description: params.description } : {} });
      if ("code" in result) throw new Error(result.message);
      if (!result.created) {
        return {
          content: [{
            type: "text",
            text: `Agent "${result.name}" already exists (id: ${result.id}); nothing was created.
The id is stable: renaming the display name never changes it \u2014 do not archive and recreate an agent to change an id.`
          }],
          details: { id: result.id, dir: result.dir, created: false }
        };
      }
      return {
        content: [{
          type: "text",
          text: `Created agent "${result.name}" (id: ${result.id}).
Files: ${result.dir}/agent.json \xB7 identity.md (skeleton) \xB7 projects/workspace/{AGENTS.md,flywheel.md,concept-space.md,specs,cases,knowledge,tools,todo,memory,task-types,sessions,tasks/0001-default}
No preset session: the first message starts a new session.`
        }],
        details: { id: result.id, dir: result.dir, created: true }
      };
    }
  });
  const remove = defineTool({
    name: "lifeos_agent_delete",
    label: "Archive Life OS agent",
    description: "Archive a Life OS agent: hidden from all lists, while its sessions, records and files stay on disk (recoverable by removing archivedAt from its agent.json). Fails when the agent has a running session or is the last non-archived agent. To discover ids, list ~/.lifeos/agents/ or ask the user.",
    promptSnippet: "Archive a Life OS agent (keeps all data)",
    promptGuidelines: [
      "lifeos_agent_delete only hides an agent; it never deletes conversations. Confirm the agent id with the user before calling it."
    ],
    annotations: { destructiveHint: true, readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    parameters: Type.Object({
      id: Type.String({ description: "Agent id (the directory name under ~/.lifeos/agents/)." })
    }),
    async execute(_toolCallId, params) {
      const result = await archiveAgent(params.id);
      if ("code" in result) throw new Error(result.message);
      return {
        content: [{ type: "text", text: `Archived agent ${result.archived} (hidden from lists; sessions and records kept).` }],
        details: { archived: result.archived }
      };
    }
  });
  const taskCreate = defineTool({
    name: "lifeos_task_create",
    label: "Create Life OS task",
    description: "Create a numbered task in the current project: a task directory with task.md (single source of truth), the shared task structure and the documents its type declares. The type is open-ended: it names a folder under task-types/ that holds the type's template and rules (e.g. development, general). If no existing type fits, discuss it with the user and add a new type template instead of forcing one. daily is reserved for the system's default task. Creating a task also makes it the current task of this conversation (applied from the next turn).",
    promptSnippet: "Create a numbered task of a declared type (task-types/<type>) with task.md and its documents",
    promptGuidelines: [
      "Use lifeos_task_create when the user asks for real work \u2014 then fill the background first, with facts, before planning.",
      "Pick the type whose template fits the work; if none fits, discuss a new type with the user first.",
      "Keep task.md as the single place for status; update \u5F53\u524D\u6307\u9488 as you go. Status is a record, not a lock: the user may reopen a finished task at any time."
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Task title, e.g. '\u6587\u4EF6\u9762\u677F\uFF1A\u5220\u9664\u5DF2\u6CE8\u518C\u6839'. Chinese is fine; it becomes the directory name." }),
      type: Type.Optional(Type.String({
        description: "Task type = a folder name under task-types/ (default development). Declared types are described in task-types/*/AGENTS.md. daily is reserved."
      })),
      category: Type.String({
        description: "Category as declared by the type's template (e.g. development: A / B / C; general: G)."
      }),
      goal: Type.Optional(Type.String({ description: "One-line verifiable goal. Defaults to the title; editable later." }))
    }),
    async execute(_toolCallId, params) {
      const result = await createTask(ctx, {
        title: params.title,
        ...params.type !== void 0 ? { type: params.type } : {},
        category: params.category,
        ...params.goal !== void 0 ? { goal: params.goal } : {}
      });
      if ("code" in result) throw new Error(result.message);
      const task = result.task;
      await ctx.onEnterTask?.(task.id);
      const files = task.docs ?? [];
      const skipped = result.skipped ?? [];
      return {
        content: [{
          type: "text",
          // **给的必须是文档路径**（协议 §3.7「给模型的 Task 路径」）：`task.path` 是两个工作区的
          // 挂载点，主区那份没有文档（新建的 Task 更是连目录都没有），照着写就是凭空造文件或绕过检视。
          text: `Created task ${task.id} (${task.type} \xB7 ${task.category}) at ${task.docPath}
(write documents here; ${task.path} is the mount point in the main area \u2014 do not write there)
Files: task.md${files.length > 0 ? ` \xB7 ${files.join(" \xB7 ")}` : ""}
` + (skipped.length > 0 ? `\u26A0 ${skipped.join("\n\u26A0 ")}
` : "") + `This conversation now works in task ${task.id} (takes effect from the next turn). Next: fill the background with current facts, then the plan.`
        }],
        // 字段名自解释：`mountPath` 一眼看得出是挂载点（不要往这写），`docPath` 才是写的地方。
        // 不给裸 `path`——名字中立，模型与人都容易拿错（reviewer 建议，Task 0004 · P2.5）。
        details: { id: task.id, number: task.number, docPath: task.docPath, mountPath: task.path, type: task.type, skipped }
      };
    }
  });
  const taskList = defineTool({
    name: "lifeos_task_list",
    label: "List Life OS tasks",
    description: "List this project's tasks (number, title, category, status, goal) by reading task.md in each task directory. Newest numbers last.",
    promptSnippet: "List this project's tasks and their status",
    parameters: Type.Object({}),
    async execute() {
      const tasks = await listTasks(ctx);
      if (tasks.length === 0) {
        return { content: [{ type: "text", text: "No tasks in this project yet." }], details: { tasks: [] } };
      }
      const text = tasks.map((task) => `${task.id} \xB7 ${task.type}/${task.category} \xB7 ${task.status} \xB7 ${task.goal}`).join("\n");
      return { content: [{ type: "text", text }], details: { tasks } };
    }
  });
  const taskEnter = defineTool({
    name: "lifeos_task_enter",
    label: "Enter an existing Life OS task",
    description: "Point this conversation at an existing task of the current project (takes effect from the next turn). Use it when the user names a task to continue or take over \u2014 do not create a duplicate task for the same work. Task switching happens here, in the conversation: there is no separate UI switch command.",
    promptSnippet: "Enter an existing task of this project by its number (applies from the next turn)",
    promptGuidelines: [
      "Use lifeos_task_enter when the user refers to an existing task ('\u7EE7\u7EED 0002', '\u63A5\u624B\u90A3\u4E2A Task').",
      "Call lifeos_task_list first if you are not sure of the number; never guess an id."
    ],
    parameters: Type.Object({
      taskId: Type.String({ description: "Task number (e.g. 0002); the full directory name (0002-some-title) is also accepted" })
    }),
    async execute(_toolCallId, params) {
      const tasks = await listTasks(ctx);
      const wanted = params.taskId.trim();
      const found = tasks.find((task) => task.id === wanted || task.dirName === wanted);
      if (found === void 0) {
        throw new Error(`No task ${wanted} in this project. Use lifeos_task_list to see the available tasks.`);
      }
      await ctx.onEnterTask?.(found.id);
      return {
        content: [{
          type: "text",
          // 同 `lifeos_task_create`：给文档路径，不给主区挂载点（协议 §3.7）。
          text: `Now working in task ${found.id} \xB7 ${found.title} (takes effect from the next turn).
Documents: ${found.docPath} (write documents here; ${found.path} is the mount point in the main area \u2014 do not write there)`
        }],
        details: { id: found.id, title: found.title, dirName: found.dirName, docPath: found.docPath, mountPath: found.path }
      };
    }
  });
  const projectAdd = defineTool({
    name: "lifeos_project_add",
    label: "Add Life OS project",
    description: "Add a directory as a project of this agent: registers it and binds it to the agent so it appears in the project list. The path must be an existing directory; nothing is written into it (the manifest lives under ~/.lifeos). Adding the same path again is idempotent (returns the existing project, created=false).",
    promptSnippet: "Add a directory as a project of this agent",
    promptGuidelines: [
      "Use lifeos_project_add when the user wants to work on another repository/folder; report the project id so they can select it.",
      "Do not call it for paths that do not exist; ask the user for the correct path instead."
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Absolute path of an existing directory, e.g. /Users/you/Code/some-project" })
    }),
    async execute(_toolCallId, params) {
      const result = await bindProject(ctx.agentId, params.path);
      if ("code" in result) throw new Error(result.message);
      return {
        content: [{
          type: "text",
          text: result.created ? `Added project "${result.project.name}" (id: ${result.project.id}) from ${result.project.path}.` : `Project already exists: "${result.project.name}" (id: ${result.project.id}) at ${result.project.path}. Nothing was created.`
        }],
        details: { project: result.project, created: result.created, defaultTask: result.defaultTask }
      };
    }
  });
  const projectRemove = defineTool({
    name: "lifeos_project_remove",
    label: "Remove Life OS project",
    description: "Remove a project from this agent's list so it no longer appears in the UI. Files, sessions and records stay on disk and are recoverable by adding the same path again. The built-in workspace project and the default project cannot be removed.",
    promptSnippet: "Remove a project from this agent's list (keeps all data)",
    promptGuidelines: [
      "lifeos_project_remove only hides a project from the list; it never deletes the directory or its sessions.",
      "Confirm the project id with the user before removing it."
    ],
    annotations: { destructiveHint: true, readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    parameters: Type.Object({
      id: Type.String({ description: "Project id (directory name under the agent's projects/), as returned by lifeos_project_list" })
    }),
    async execute(_toolCallId, params) {
      const result = await unbindProject(ctx.agentId, params.id);
      if (result !== "unbound") throw new Error(result.message);
      return {
        content: [{
          type: "text",
          text: `Removed project "${params.id}" from the list. Its files and sessions are unchanged; add the same path again to restore it.`
        }],
        details: { removed: params.id }
      };
    }
  });
  const projectList = defineTool({
    name: "lifeos_project_list",
    label: "List Life OS projects",
    description: "List this agent's projects (id, display name, path, which one is default) by scanning the agent's projects/ directories. Use the returned id wherever a project id is required.",
    promptSnippet: "List this agent's projects",
    parameters: Type.Object({}),
    async execute() {
      const projects = await listAgentProjects(ctx.agentId);
      if (projects.length === 0) {
        return { content: [{ type: "text", text: "No projects yet." }], details: { projects: [] } };
      }
      const text = projects.map((project) => `${project.id} \xB7 ${project.name}${project.isDefault ? " (default)" : ""}${project.path === void 0 ? "" : ` \xB7 ${project.path}`}`).join("\n");
      return { content: [{ type: "text", text }], details: { projects } };
    }
  });
  const MEMORY_SCOPES = ["agent_project", "project", "agent", "user"];
  const firstLine = (text) => text.split("\n")[0]?.slice(0, 120) ?? "";
  const memorySearch = defineTool({
    name: "lifeos_memory_search",
    label: "Search Life OS memories",
    description: "Search this agent's memories. With no scope, searches and merges in this order: agent's project memory (this agent + this project) \u2192 project shared memory (this project) \u2192 agent memory (this agent, across projects) \u2192 user memory. Cross-project: pass a GLOBAL projectId together with scope=project \u2014 only that project's shared memory is readable; another agent's private project memory is never readable. Results include id + scope so they can be deleted later.",
    promptSnippet: "Search memories (project / agent / user) for this agent",
    promptGuidelines: [
      "Search memories when the user refers to something decided or learned before, or asks what you remember.",
      "Default: only the current project. Do not search other projects unless the user explicitly asks; then use scope=project with that project's global projectId."
    ],
    parameters: Type.Object({
      query: Type.String({ description: "What to look for (natural language is fine)." }),
      scope: Type.Optional(Type.Union(MEMORY_SCOPES.map((value) => Type.Literal(value)), {
        description: "Restrict to one memory layer. Omit = merged default order (agent's project memory \u2192 project shared \u2192 agent \u2192 user)."
      })),
      projectId: Type.Optional(Type.String({ description: "Global project id. Only allowed with scope=project, for reading another project's shared memory." })),
      limit: Type.Optional(Type.Number({ description: "Max results (default 10)." }))
    }),
    async execute(_toolCallId, params) {
      const limit = params.limit ?? 10;
      if (params.scope === void 0) {
        const roles = defaultReadOrder({ agentId: ctx.agentId, projectId: ctx.projectId });
        const hits2 = await searchMemoryScopes(roles, params.query, { limit });
        if (hits2.length === 0) return { content: [{ type: "text", text: "No memories found." }], details: { hits: [] } };
        const text2 = hits2.map((hit) => `${roleLabel(hit.role)} \xB7 ${hit.score.toFixed(2)} \xB7 ${hit.id} \xB7 ${firstLine(hit.text)}`).join("\n");
        return { content: [{ type: "text", text: text2 }], details: { hits: hits2 } };
      }
      const resolved = resolveMemoryRole({
        agentId: ctx.agentId,
        currentProjectId: ctx.projectId,
        scope: params.scope,
        ...params.projectId !== void 0 ? { targetProjectId: params.projectId } : {},
        action: "search"
      });
      if ("error" in resolved) throw new Error(resolved.error);
      const hits = await searchMemory(resolved.role, params.query, { limit });
      if (hits.length === 0) return { content: [{ type: "text", text: "No memories found." }], details: { hits: [] } };
      const text = hits.map((hit) => `${roleLabel(resolved.role)} \xB7 ${hit.score.toFixed(2)} \xB7 ${hit.id} \xB7 ${firstLine(hit.text)}`).join("\n");
      return { content: [{ type: "text", text }], details: { hits } };
    }
  });
  const memoryRecord = defineTool({
    name: "lifeos_memory_record",
    label: "Record a Life OS memory",
    description: "Record one fact the user asked to remember. scope is REQUIRED and decides where it goes: agent_project = this agent in this project (private), project = shared with all agents in this project, agent = this agent across projects, user = this user across projects. Write only the layer the user's instruction implies; do not auto-record whole conversations and do not share/promote by yourself. Never store secrets (API keys, passwords, tokens, cookies).",
    promptSnippet: "Record a fact the user asked to remember (scope required)",
    promptGuidelines: [
      "Only record facts the user explicitly asked to keep (preferences, decisions, project conventions, lessons). Do not record every turn.",
      "Choose the layer from the user's words: project conventions \u2192 project; user preferences \u2192 user; cross-project lessons \u2192 agent; this project's gotchas \u2192 agent_project."
    ],
    parameters: Type.Object({
      content: Type.String({ description: "The fact to remember, one or two sentences." }),
      scope: Type.Union(MEMORY_SCOPES.map((value) => Type.Literal(value)), {
        description: "Required. agent_project (private, this project) | project (shared in this project) | agent (this agent, cross-project) | user (this user, cross-project)."
      }),
      projectId: Type.Optional(Type.String({ description: "Global project id; defaults to the current project. Cannot be used to write into another project." }))
    }),
    async execute(_toolCallId, params) {
      const resolved = resolveMemoryRole({
        agentId: ctx.agentId,
        currentProjectId: ctx.projectId,
        scope: params.scope,
        ...params.projectId !== void 0 ? { targetProjectId: params.projectId } : {},
        action: "record"
      });
      if ("error" in resolved) throw new Error(resolved.error);
      const result = await recordMemory(resolved.role, { userText: params.content, agentText: "" });
      return {
        content: [{ type: "text", text: `Recorded (${roleLabel(resolved.role)}) id=${result.traceId}` }],
        details: { id: result.traceId, scope: params.scope, episodeId: result.episodeId }
      };
    }
  });
  const memoryDelete = defineTool({
    name: "lifeos_memory_delete",
    label: "Delete a Life OS memory",
    description: "Permanently delete one memory by id + scope (hard delete, irreversible, idempotent). Call it ONLY when the user explicitly asks to delete that memory; never as cleanup. There is no edit or undo: to correct a memory, delete it and record a new one. Never bulk-delete on your own; if the user asks for bulk deletion, list the items and counts first and wait for confirmation.",
    promptSnippet: "Delete one memory (hard delete; only on explicit user request)",
    promptGuidelines: [
      "Confirm the exact id and scope with the user before deleting; deletion is permanent.",
      "Do not delete memories to 'clean up' or to resolve contradictions \u2014 record a corrected memory instead (or ask the user)."
    ],
    annotations: { destructiveHint: true, readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    parameters: Type.Object({
      id: Type.String({ description: "Memory id from lifeos_memory_search." }),
      scope: Type.Union(MEMORY_SCOPES.map((value) => Type.Literal(value)), {
        description: "The layer the memory lives in (same as returned by search)."
      }),
      projectId: Type.Optional(Type.String({ description: "Global project id; defaults to the current project." }))
    }),
    async execute(_toolCallId, params) {
      const resolved = resolveMemoryRole({
        agentId: ctx.agentId,
        currentProjectId: ctx.projectId,
        scope: params.scope,
        ...params.projectId !== void 0 ? { targetProjectId: params.projectId } : {},
        action: "delete"
      });
      if ("error" in resolved) throw new Error(resolved.error);
      const deleted = await deleteMemory(resolved.role, params.id);
      if (!deleted) throw new Error("No memory with that id in this scope (it may already be deleted).");
      return { content: [{ type: "text", text: `Deleted (${roleLabel(resolved.role)}) id=${params.id}` }], details: { id: params.id, scope: params.scope } };
    }
  });
  const peerErrorText = (code, target, available, sessionId) => {
    if (code === "self") return "You cannot message yourself. Pick another Life OS agent.";
    if (code === "archived") return `Agent "${target}" is archived; unarchive it first or pick another agent.`;
    if (code === "session_not_found") {
      return `No peer conversation with session id "${sessionId ?? "(unknown)"}"${available !== void 0 && available.length > 0 ? `. Known sessions with this agent: ${available.join(", ")}` : " (none with this agent yet)"}.`;
    }
    if (code === "session_not_in_lane") {
      return `That session exists but belongs to a different task lane. Sessions in the current lane: ${available?.join(", ") ?? "(none)"}.`;
    }
    return `No Life OS agent with id "${target}". Use lifeos_agent_list to see the available agents.`;
  };
  const currentTaskId = () => ctx.taskId;
  const ask = defineTool({
    name: "lifeos_ask",
    label: "Ask another Life OS agent (waits for the answer)",
    description: "Ask another Life OS agent and WAIT for its answer. The target agent answers in its own full session (its own identity, harness rules, task and tools), so treat it as a colleague, not a function. Conversations are reused per (task, agent): asking again inside the same task continues the same conversation, while a different task gets its own conversation. Pass newSession:true to start a fresh conversation with the same agent; pass sessionId to continue a specific one. The result is a STATE SNAPSHOT: state/phase/lastReply/next tell you whether it finished, is still running, or failed, and what to do next. A timeout is NOT a failure \u2014 it returns the same snapshot with state still running.",
    promptSnippet: "Ask another agent and wait; returns a state snapshot (lane = task + agent)",
    promptGuidelines: [
      "Prefer lifeos_ask for questions you need answered before replying; prefer lifeos_send for work that takes a long time.",
      "Write the message as you would to a colleague: state the goal, the constraints, and what you need back.",
      "Check `state` before using `lastReply`: only `idle` means it answered; `running` means it is still working.",
      "If the target replies that it needs clarification, decide yourself: answer it or ask the user \u2014 do not loop blindly."
    ],
    parameters: Type.Object({
      agent: Type.String({ description: "Target Life OS agent id (e.g. 'coder')." }),
      message: Type.String({ description: "What to ask. Include the context the other agent cannot guess." }),
      timeoutMs: Type.Optional(Type.Number({ description: "How long to wait before handing control back (default 10 minutes). Timing out does not cancel the target's turn." })),
      sessionId: Type.Optional(Type.String({ description: "Continue this specific conversation. Omit to continue the most recent one for the current task." })),
      newSession: Type.Optional(Type.Boolean({ description: "Start a NEW conversation with this agent instead of continuing the current task's one." }))
    }),
    async execute(_toolCallId, params) {
      const taskId = currentTaskId();
      const resolved = await resolvePeer(ctx.agentId, params.agent);
      if (!resolved.ok) throw new Error(peerErrorText(resolved.code, params.agent));
      const peer = await peerConversation(ctx.agentId, params.agent, ctx.projectId, resolveHome(), {
        ...taskId !== void 0 ? { taskId } : {},
        ...params.sessionId !== void 0 ? { sessionId: params.sessionId } : {},
        ...params.newSession === true ? { newSession: true } : {}
      });
      if (!peer.ok) throw new Error(peerErrorText(peer.code, params.agent, peer.available, params.sessionId));
      const { sessionId } = peer.conversation;
      const ordinal = await laneCount(ctx.agentId, peer.conversation.agentId, ctx.projectId, taskId).catch(() => 1);
      namePeerSession(
        await getSession(peer.conversation.agentId, sessionId, resolveHome()),
        resolved.name,
        peer.conversation.created ? ordinal : Math.max(1, ordinal)
      );
      const before = await peerSnapshot(peer.conversation.agentId, sessionId, taskId);
      if (before.state === "running") {
        return {
          content: [{ type: "text", text: snapshotText(params.agent, before, "\u5B83\u6B63\u5728\u8DD1\uFF0C\u8FD9\u6761\u6D88\u606F**\u6CA1\u6709**\u53D1\u51FA\u53BB\u2014\u2014\u5148\u770B\u5B83\u7684\u72B6\u6001\u3002") }],
          details: { agent: params.agent, conversationCreated: false, timedOut: false, skipped: "target_running", ...before }
        };
      }
      const timeoutMs = params.timeoutMs ?? ASK_DEFAULT_TIMEOUT_MS;
      const messagesBeforeSend = before.messages;
      const turn = runTurn2(peer.conversation.agentId, sessionId, params.message, {
        origin: { kind: "agent", agentId: ctx.agentId, name: resolved.name, via: "lifeos_ask" }
      });
      let timer;
      const timeout = new Promise((resolve10) => {
        timer = setTimeout(() => resolve10("timeout"), timeoutMs);
      });
      let timedOut = false;
      try {
        const outcome = await Promise.race([turn.then((result) => result.ok ? "done" : "busy"), timeout]);
        timedOut = outcome === "timeout";
      } finally {
        if (timer !== void 0) clearTimeout(timer);
      }
      const snapshot2 = await peerSnapshot(peer.conversation.agentId, sessionId, taskId, messagesBeforeSend);
      const notAccepted = snapshot2.myMessageAccepted === false ? "\u26A0\uFE0F \u6211\u8FD9\u6761\u6D88\u606F**\u6CA1\u6709**\u8FDB\u5165\u5BF9\u65B9\u4F1A\u8BDD\uFF08\u6D88\u606F\u6570\u6CA1\u53D8\uFF09\u2014\u2014\u4E0D\u8981\u91CD\u590D\u53D1\u9001\uFF0C\u5148\u67E5\u5B83\u7684\u72B6\u6001\u3002" : void 0;
      const hint = notAccepted ?? (timedOut ? `\u7B49\u4E86 ${Math.round(timeoutMs / 1e3)}s \u5B83\u8FD8\u6CA1\u7ED3\u675F\uFF08\u5BF9\u65B9\u56DE\u5408\u4ECD\u5728\u8DD1\uFF0C**\u6CA1\u6709**\u53D6\u6D88\uFF09` : void 0);
      return {
        content: [{ type: "text", text: snapshotText(params.agent, snapshot2, hint) }],
        details: { agent: params.agent, conversationCreated: peer.conversation.created, timedOut, ...snapshot2 }
      };
    }
  });
  const send = defineTool({
    name: "lifeos_send",
    label: "Hand work to another Life OS agent (does not wait)",
    description: "Hand a task to another Life OS agent and return immediately; this turn ends and the other agent keeps working in its own session (visible in the session list). When it finishes, a completion message is delivered INTO THIS conversation automatically \u2014 do not poll or sleep. Conversations are reused per (task, agent), exactly like lifeos_ask; pass newSession:true for a fresh one.",
    promptSnippet: "Hand work to another agent without waiting; its completion comes back into this conversation",
    promptGuidelines: [
      "After lifeos_send, tell the user what you handed off and to whom \u2014 do not claim the work is done.",
      "Never sleep or poll for the result in the same turn; the completion arrives as a message in this conversation."
    ],
    parameters: Type.Object({
      agent: Type.String({ description: "Target Life OS agent id (e.g. 'coder')." }),
      message: Type.String({ description: "The task, with everything the other agent needs to start." }),
      sessionId: Type.Optional(Type.String({ description: "Continue this specific conversation. Omit to continue the most recent one for the current task." })),
      newSession: Type.Optional(Type.Boolean({ description: "Start a NEW conversation with this agent instead of continuing the current task's one." }))
    }),
    async execute(_toolCallId, params) {
      const taskId = currentTaskId();
      const resolved = await resolvePeer(ctx.agentId, params.agent);
      if (!resolved.ok) throw new Error(peerErrorText(resolved.code, params.agent));
      const peer = await peerConversation(ctx.agentId, params.agent, ctx.projectId, resolveHome(), {
        ...taskId !== void 0 ? { taskId } : {},
        ...params.sessionId !== void 0 ? { sessionId: params.sessionId } : {},
        ...params.newSession === true ? { newSession: true } : {}
      });
      if (!peer.ok) throw new Error(peerErrorText(peer.code, params.agent, peer.available, params.sessionId));
      const { sessionId } = peer.conversation;
      const ordinal = await laneCount(ctx.agentId, peer.conversation.agentId, ctx.projectId, taskId).catch(() => 1);
      namePeerSession(
        await getSession(peer.conversation.agentId, sessionId, resolveHome()),
        resolved.name,
        peer.conversation.created ? ordinal : Math.max(1, ordinal)
      );
      const initiatorSessionId = ctx.sessionId;
      if (initiatorSessionId !== void 0) {
        registerPendingPeer(peer.conversation.agentId, sessionId, {
          initiatorAgentId: ctx.agentId,
          initiatorSessionId,
          peerName: resolved.name,
          ...taskId !== void 0 ? { initiatorTaskId: taskId } : {},
          projectId: ctx.projectId
        });
      }
      const before = await peerSnapshot(peer.conversation.agentId, sessionId, taskId);
      const queued = before.state === "running";
      const origin = { kind: "agent", agentId: ctx.agentId, name: resolved.name, via: "lifeos_send" };
      let queuedNow = queued;
      if (queued) {
        const verdict = await queueSessionInput(peer.conversation.agentId, sessionId, params.message, "followUp", origin);
        if ("code" in verdict && verdict.code !== "session_idle") {
          throw new Error(`Could not queue the message for ${params.agent}: ${verdict.code === "error" ? verdict.message : verdict.code}`);
        }
      } else {
        const slot = reserveTurn(peer.conversation.agentId, sessionId);
        if (slot === void 0) {
          const verdict = await queueSessionInput(peer.conversation.agentId, sessionId, params.message, "followUp", origin);
          if ("code" in verdict && verdict.code !== "session_idle") {
            throw new Error(`Could not queue the message for ${params.agent}: ${verdict.code === "error" ? verdict.message : verdict.code}`);
          }
          queuedNow = true;
        } else {
          const turn = runTurn2(peer.conversation.agentId, sessionId, params.message, { origin, reserved: slot });
          void turn.then((result) => {
            if (result.ok) return;
            slot.release();
            throw new Error(`runTurn reported busy after a successful reservation (${params.agent} / ${sessionId})`);
          }).catch((error) => {
            void log.error("agent-tools", "lifeos_send", "\u540E\u53F0\u56DE\u5408\u542F\u52A8\u5931\u8D25", {
              details: { agent: peer.conversation.agentId, sessionId, message: error instanceof Error ? error.message : String(error) }
            });
          });
        }
      }
      return {
        content: [{
          type: "text",
          text: `Handed off to ${params.agent} (session ${sessionId})${queuedNow ? " \u2014 it was already running, so the message is queued after its current turn" : ""}. Its completion will be delivered into this conversation; do not poll.`
        }],
        details: {
          agent: params.agent,
          sessionId,
          conversationCreated: peer.conversation.created,
          queued: queuedNow,
          completionWillArriveIn: initiatorSessionId ?? null,
          ...taskId !== void 0 ? { taskId } : {}
        }
      };
    }
  });
  const mediaCatalog = defineTool({
    name: "lifeos_media_catalog",
    label: "Search the Life OS media library",
    description: "Search the local media library for avatar candidates or emoji/sticker images. Returns ids, packs, keywords, source and license \u2014 never the image bytes, so nothing is added to the model context. Use it when you need to pick an avatar or find the shortcode of a feeling to send.",
    promptSnippet: "Search avatar/emoji assets by keyword (no image bytes)",
    promptGuidelines: [
      "Prefer this over reading image files: reading an image costs ~4800 chars of context each, this costs a few lines of text.",
      "For an avatar, search kind=avatar, then set it with lifeos_media_avatar_set using the returned id \u2014 never read the image first.",
      "For a feeling, search kind=emoji and reply with the asset id wrapped in colons (e.g. :blush:) \u2014 the UI renders the image."
    ],
    parameters: Type.Object({
      kind: Type.Optional(Type.String({ description: "avatar | emoji. Omit for both." })),
      query: Type.Optional(Type.String({ description: "Keywords, Chinese or English (e.g. \u732B / calm / \u5F00\u5FC3). Space-separated terms are ANDed." })),
      pack: Type.Optional(Type.String({ description: "Restrict to one asset pack (e.g. dicebear-shapes)." })),
      limit: Type.Optional(Type.Number({ description: "Max results (default 20)." }))
    }),
    async execute(_toolCallId, params) {
      const kind = params.kind;
      if (kind !== void 0 && kind !== "avatar" && kind !== "emoji") throw new Error("kind must be avatar or emoji");
      const catalog = await readCatalog(resolveHome());
      const items = searchEntries(catalog, {
        ...params.query !== void 0 ? { query: params.query } : {},
        ...kind !== void 0 ? { kind } : {},
        ...params.pack !== void 0 ? { pack: params.pack } : {},
        ...params.limit !== void 0 ? { limit: params.limit } : {}
      });
      if (items.length === 0) {
        return {
          content: [{ type: "text", text: `No media matched. Library currently holds ${catalog.entries.length} entries \u2014 ask the user to seed it with \`pnpm media:seed\` if that is unexpected.` }],
          details: { items: [], total: catalog.entries.length }
        };
      }
      const lines = items.map((entry) => `- ${entry.id} [${entry.kind}/${entry.pack}] ${entry.keywords.slice(0, 8).join(", ")} (${entry.license})`);
      return {
        content: [{ type: "text", text: `Media matches (${items.length}/${catalog.entries.length}):
${lines.join("\n")}` }],
        details: { items, total: catalog.entries.length }
      };
    }
  });
  const mediaAvatarSet = defineTool({
    name: "lifeos_media_avatar_set",
    label: "Set an agent avatar from the media library",
    description: "Set an agent's avatar to an image already in the local media library. Writes agents/<id>/avatar/avatar.<ext>, updates agent.json and broadcasts agents_changed so every open tab swaps the image immediately. The image bytes never enter the model context. Defaults to your own agent when agentId is omitted.",
    promptSnippet: "Set an agent avatar from a library asset id",
    promptGuidelines: [
      "Find the asset with lifeos_media_catalog first; do not read the image itself.",
      "Omit agentId to change your own avatar; pass another agent id only when the user asked for it."
    ],
    annotations: { destructiveHint: false, readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    parameters: Type.Object({
      mediaId: Type.String({ description: "Asset id from lifeos_media_catalog (e.g. 'calm-otter')." }),
      agentId: Type.Optional(Type.String({ description: "Target agent id; defaults to the current agent." }))
    }),
    async execute(_toolCallId, params) {
      if (!isMediaId(params.mediaId)) throw new Error(`Invalid media id: ${params.mediaId}`);
      const catalog = await readCatalog(resolveHome());
      const entry = findEntry(catalog, params.mediaId);
      if (entry === void 0) throw new Error(`No media ${params.mediaId}. Use lifeos_media_catalog to find an id.`);
      if (entry.kind !== "avatar") throw new Error(`${params.mediaId} is an ${entry.kind} asset, not an avatar.`);
      const buffer = await readMediaBytes(resolveHome(), entry);
      if (buffer === void 0) throw new Error(`Media ${params.mediaId} is registered but its file is missing; re-seed the library.`);
      const target = params.agentId !== void 0 && params.agentId !== "" ? params.agentId : ctx.agentId;
      const written = await setAgentAvatar(target, buffer);
      if (!written.ok) throw new Error(written.message);
      return {
        content: [{ type: "text", text: `Avatar of ${target} is now ${entry.id} (${entry.keywords.slice(0, 4).join(", ")}).` }],
        details: { agentId: target, mediaId: entry.id, avatar: written.avatar }
      };
    }
  });
  const agentList = defineTool({
    name: "lifeos_agent_list",
    label: "List Life OS agents",
    description: "List the Life OS agents you can talk to (id, name, description, archived). Use it before lifeos_ask / lifeos_send when you are not sure the target id exists.",
    promptSnippet: "List the Life OS agents (id + name) you can message",
    promptGuidelines: ["Use the `id` field as the `agent` argument of lifeos_ask / lifeos_send, not the display name."],
    parameters: Type.Object({}),
    async execute() {
      const items = await listPeerAgents(ctx.agentId);
      const lines = items.map((item) => `- ${item.id} \u2014 ${item.name}${item.archived ? " (archived)" : ""}${item.description !== void 0 ? `\uFF1A${item.description}` : ""}`);
      return {
        content: [{ type: "text", text: lines.length > 0 ? `Agents you can message (use the id):
${lines.join("\n")}` : "No other agents exist yet." }],
        details: { items }
      };
    }
  });
  const askList = defineTool({
    name: "lifeos_ask_list",
    label: "List your peer conversations",
    description: "List the conversations you already have with other agents. Shows sessionId, peer id/name, the task that owns the lane, message count, last activity and whether it is running. Use it to find the sessionId to continue a specific conversation, or to see what you already discussed.",
    promptSnippet: "List your existing agent-to-agent conversations (with sessionIds)",
    promptGuidelines: ["Pass `agent` to narrow to one target; pass `includeAllTasks` to see conversations started from other tasks too."],
    parameters: Type.Object({
      agent: Type.Optional(Type.String({ description: "Only list conversations with this agent id." })),
      includeAllTasks: Type.Optional(Type.Boolean({ description: "Include conversations started from other tasks (default: only the current task's lane)." }))
    }),
    async execute(_toolCallId, params) {
      const taskId = currentTaskId();
      const targets = params.agent !== void 0 ? [{ id: params.agent, name: params.agent }] : (await listPeerAgents(ctx.agentId)).map((item) => ({ id: item.id, name: item.name }));
      const rows = [];
      const lines = [];
      for (const target of targets) {
        const sessions = await listPeerSessions(ctx.agentId, target.id, ctx.projectId);
        for (const entry of sessions) {
          const laneTask = entry.marker.initiatorTaskId;
          const sameLane = laneTask === void 0 || taskId === void 0 || laneTask === taskId;
          if (params.includeAllTasks !== true && !sameLane) continue;
          const title = await peerSessionTitle(target.id, entry.sessionId);
          rows.push({
            sessionId: entry.sessionId,
            peerAgentId: target.id,
            peerName: target.name,
            initiatorTaskId: laneTask ?? null,
            title: title ?? null,
            messages: entry.messages,
            updatedAt: new Date(entry.updatedAtMs).toISOString(),
            running: entry.running,
            sameLane
          });
          lines.push(
            `- ${entry.sessionId} \xB7 ${target.name}${laneTask !== void 0 ? ` \xB7 task ${laneTask}` : ""}${title !== void 0 ? ` \xB7 ${title}` : ""} \xB7 ${entry.messages} msgs${entry.running ? " \xB7 running" : ""}`
          );
        }
      }
      return {
        content: [{
          type: "text",
          text: lines.length > 0 ? `Your peer conversations${params.includeAllTasks === true ? " (all tasks)" : ` (task ${taskId ?? "(none)"})`}:
${lines.join("\n")}` : "No peer conversations for this selection yet."
        }],
        details: { items: rows }
      };
    }
  });
  const reviewState = defineTool({
    name: "lifeos_review_state",
    label: "Read Life OS review state",
    description: "Overview of the review mode for a task: where the reviewed sources are (project worktree + task documents), how many files changed with +/- counts, and how many comment threads exist per state and per waiting side. Start here when the user says 'review my task', 'what did I annotate', or 'what do I still owe you'. Then use lifeos_review_comments for full text, lifeos_review_comment_reply to answer a thread, lifeos_review_comment_resolve to close one you raised.",
    promptSnippet: "Read the review state of a task (sources, changes, comment counts)",
    promptGuidelines: [
      "Call lifeos_review_state first when review mode comes up; it tells you where the diff is and what is waiting for you.",
      "It only summarises: use lifeos_review_comments for the full comment text and replies.",
      "Threads the user raised can only be closed by the user: reply in them instead of resolving."
    ],
    parameters: Type.Object({
      taskId: Type.String({ description: "Task number (e.g. '0010'); the full directory name is also accepted." })
    }),
    async execute(_toolCallId, params) {
      const taskDir = await resolveTaskDir(ctx, params.taskId.trim());
      if (taskDir === void 0) throw new Error(`No task ${params.taskId} in this project. Use lifeos_task_list to see the available tasks.`);
      const overview = await reviewOverviewOf(taskDir, params.taskId.trim());
      return {
        content: [{ type: "text", text: formatReviewOverview(overview) }],
        details: { overview }
      };
    }
  });
  const reviewOpen = defineTool({
    name: "lifeos_review_open",
    label: "Open the review panel for a task",
    description: "Open the review panel on a task's changes so the user can look at them. The panel shows both sources of that task: the project worktree (code) and the task's own documents under ~/.lifeos. Use it when the user says 'show me what I changed', or after you finish a piece of work and want them to review it.",
    promptSnippet: "Open the review panel on a task's changes",
    promptGuidelines: [
      "Call lifeos_review_open with the task id (e.g. '0010') after delivering work the user should look at.",
      "The panel is per task; it always shows both the worktree and the task documents \u2014 you do not pick a path.",
      "Do not also paste the diff into the chat: the panel is the place to read it."
    ],
    parameters: Type.Object({
      taskId: Type.String({ description: "Task number (e.g. '0010'); the full directory name is also accepted." })
    }),
    async execute(_toolCallId, params) {
      const taskDir = await resolveTaskDir(ctx, params.taskId.trim());
      if (taskDir === void 0) throw new Error(`No task ${params.taskId} in this project. Use lifeos_task_list to see the available tasks.`);
      const taskId = /^(\d{4})/.exec(taskDir.split("/").pop() ?? "")?.[1] ?? params.taskId.trim();
      broadcast({ type: "review_open", taskId, taskDir, agentId: ctx.agentId, projectId: ctx.projectId });
      return {
        content: [{ type: "text", text: `Asked the UI to open the review panel for task ${taskId} (${taskDir}).` }],
        details: { taskId, taskDir }
      };
    }
  });
  const reviewComments = defineTool({
    name: "lifeos_review_comments",
    label: "Read Life OS review comments",
    description: "Read the review comments (threads) left on a task's diff. Comments are bound to the task (not to any conversation), so any agent can read them. Returns author, location (path + line range), tone marks, state, awaiting, the root body and every reply (who said what, and when). Use it when the user says 'look at my review comments' / 'check what I annotated', and to find the threads you still owe an answer to.",
    promptSnippet: "Read the review comment threads on a task's diff",
    promptGuidelines: [
      "Use lifeos_review_comments when the user refers to review comments/annotations they or another agent left.",
      "Pass taskId (e.g. 0010). The current task's id is usually what they mean; if unsure, ask or call lifeos_task_list.",
      "Pass pendingForMe:true to get only the unresolved threads that wait for you (or for nobody yet) \u2014 that is your review TODO list."
    ],
    parameters: Type.Object({
      taskId: Type.String({ description: "Task number (e.g. '0010'); the full directory name is also accepted." }),
      pendingForMe: Type.Optional(Type.Boolean({ description: "Only unresolved threads that wait for this agent (or nobody yet). This is the review TODO list." })),
      state: Type.Optional(Type.String({ description: "Filter by state: draft / open / resolved." }))
    }),
    async execute(_toolCallId, params) {
      const taskDir = await resolveTaskDir(ctx, params.taskId.trim());
      if (taskDir === void 0) throw new Error(`No task ${params.taskId} in this project. Use lifeos_task_list to see the available tasks.`);
      const all = await readComments(taskDir);
      let comments = all;
      if (params.state === "draft" || params.state === "open" || params.state === "resolved") {
        comments = comments.filter((c) => c.state === params.state);
      }
      if (params.pendingForMe === true) {
        comments = pendingFor(comments, "agent");
      }
      if (comments.length === 0) {
        return { content: [{ type: "text", text: `No review comments on task ${params.taskId} match.` }], details: { comments: [] } };
      }
      const lines = comments.map((c) => {
        const where = c.anchor.start === c.anchor.end ? `L${c.anchor.start}` : `L${c.anchor.start}-L${c.anchor.end}`;
        const tone = c.marks.length > 0 ? ` [${c.marks.join(",")}]` : "";
        const body = c.body === "" ? "(no text)" : c.body;
        const head = `- ${c.id} ${c.anchor.path}:${where} (${c.anchor.side})${tone} by ${c.author.kind}:${c.author.id} \xB7 ${c.state}${c.awaiting === null ? "" : ` \xB7 waiting for ${c.awaiting}`}`;
        const replies = c.replies.map((r) => `    \u21B3 ${r.author.kind}:${r.author.id}: ${r.body}`);
        return [head, `  ${body}`, ...replies].join("\n");
      });
      return {
        content: [{ type: "text", text: `${comments.length} review thread(s) on task ${params.taskId}:
${lines.join("\n")}` }],
        details: { comments }
      };
    }
  });
  const reviewCommentAdd = defineTool({
    name: "lifeos_review_comment_add",
    label: "Add a Life OS review comment",
    description: "Add a review comment on a task's diff at a file/line range. The author is this agent (the user sees which agent wrote it). Bound to the task, not to this conversation. Tone marks are optional: query / critic / praise / agree / archive / todo.",
    promptSnippet: "Add a review comment on a task's diff at file:line",
    promptGuidelines: [
      "Review comments are for pointing at specific code: always give path + line range (side is old/new).",
      "Do not paraphrase the user; write what YOU think about that code, and pick a tone mark."
    ],
    parameters: Type.Object({
      taskId: Type.String({ description: "Task number (e.g. '0010'); the full directory name is also accepted." }),
      source: Type.String({ description: "'worktree' (project code) or 'lifeos' (the task's own documents)." }),
      path: Type.String({ description: "File path relative to the source root, e.g. 'README.md'." }),
      side: Type.String({ description: "Which side of the diff: 'old' (removed) or 'new' (added/context)." }),
      start: Type.Number({ description: "First line (1-based)." }),
      end: Type.Number({ description: "Last line (1-based; same as start for a single line)." }),
      body: Type.String({ description: "The comment text." }),
      marks: Type.Optional(Type.Array(Type.String(), { description: "Optional tone marks." }))
    }),
    async execute(_toolCallId, params) {
      const taskDir = await resolveTaskDir(ctx, params.taskId.trim());
      if (taskDir === void 0) throw new Error(`No task ${params.taskId} in this project. Use lifeos_task_list to see the available tasks.`);
      if (params.source !== "worktree" && params.source !== "lifeos") throw new Error("source must be 'worktree' or 'lifeos'");
      if (params.side !== "old" && params.side !== "new") throw new Error("side must be 'old' or 'new'");
      if (!Number.isFinite(params.start) || !Number.isFinite(params.end) || params.start < 1 || params.end < 1) {
        throw new Error("start/end must be 1-based line numbers (>= 1)");
      }
      const saved = await upsertComment(taskDir, {
        taskId: params.taskId.trim(),
        author: { kind: "agent", id: ctx.agentId },
        anchor: {
          source: params.source,
          path: params.path,
          side: params.side,
          start: params.start,
          end: params.end
        },
        body: params.body,
        marks: params.marks ?? [],
        state: "open",
        origin: { kind: "agent-tool", ...ctx.sessionId !== void 0 ? { sessionId: ctx.sessionId } : {} }
      });
      return {
        content: [{ type: "text", text: `Added review comment ${saved.id} on ${saved.anchor.path}:L${saved.anchor.start}${saved.anchor.end === saved.anchor.start ? "" : `-L${saved.anchor.end}`}.` }],
        details: { comment: saved }
      };
    }
  });
  const reviewCommentReply = defineTool({
    name: "lifeos_review_comment_reply",
    label: "Reply to a Life OS review comment",
    description: "Reply inside an existing review thread (the comment id comes from lifeos_review_comments). The reply is written with this agent as author, and the thread's `awaiting` flips to the other side: after an agent replies, the user is expected to read and close it. Resolved threads cannot be replied to \u2014 reopen first.",
    promptSnippet: "Reply inside a review thread (say how you closed it)",
    promptGuidelines: [
      "After you act on a review comment, reply in its thread to say what you changed and where (file:line or commit/subject) \u2014 the user reads that before closing.",
      "Do not open a new comment to answer an existing one: use lifeos_review_comment_reply with the thread id.",
      "You cannot close a comment the user opened (only its author or the user can); leave it for the user."
    ],
    parameters: Type.Object({
      taskId: Type.String({ description: "Task number (e.g. '0010'); the full directory name is also accepted." }),
      id: Type.String({ description: "Thread (comment) id, from lifeos_review_comments." }),
      body: Type.String({ description: "The reply text: what you did, and where." })
    }),
    async execute(_toolCallId, params) {
      const taskDir = await resolveTaskDir(ctx, params.taskId.trim());
      if (taskDir === void 0) throw new Error(`No task ${params.taskId} in this project. Use lifeos_task_list to see the available tasks.`);
      const updated = await addReply(taskDir, params.id.trim(), { author: { kind: "agent", id: ctx.agentId }, body: params.body });
      return {
        content: [{ type: "text", text: `Replied in thread ${updated.id} (${updated.replies.length} repl${updated.replies.length === 1 ? "y" : "ies"}). Waiting for: ${updated.awaiting ?? "nobody"}.` }],
        details: { comment: updated }
      };
    }
  });
  const reviewCommentResolve = defineTool({
    name: "lifeos_review_comment_resolve",
    label: "Close or reopen a Life OS review comment",
    description: "Close (resolved=true) or reopen (resolved=false) a review thread. Permission: only the comment's author or the user can close it \u2014 an agent cannot close a comment the user raised (reply in it instead).",
    promptSnippet: "Close or reopen a review thread (author or user only)",
    promptGuidelines: [
      "Close only threads you raised yourself. For threads the user raised, reply and let the user close them.",
      "If the server answers 403, tell the user plainly that only they can close it."
    ],
    parameters: Type.Object({
      taskId: Type.String({ description: "Task number (e.g. '0010'); the full directory name is also accepted." }),
      id: Type.String({ description: "Thread (comment) id, from lifeos_review_comments." }),
      resolved: Type.Optional(Type.Boolean({ description: "true = close (default), false = reopen." }))
    }),
    async execute(_toolCallId, params) {
      const taskDir = await resolveTaskDir(ctx, params.taskId.trim());
      if (taskDir === void 0) throw new Error(`No task ${params.taskId} in this project. Use lifeos_task_list to see the available tasks.`);
      const target = params.resolved === false ? "open" : "resolved";
      const updated = await setCommentState(taskDir, params.id.trim(), target, { kind: "agent", id: ctx.agentId });
      if (updated === void 0) throw new Error(`No review comment ${params.id} on task ${params.taskId}.`);
      return {
        content: [{ type: "text", text: `Thread ${updated.id} is now ${updated.state}.` }],
        details: { comment: updated }
      };
    }
  });
  return [create, remove, taskCreate, taskList, taskEnter, projectAdd, projectRemove, projectList, memorySearch, memoryRecord, memoryDelete, ask, send, agentList, askList, reviewState, reviewOpen, reviewComments, reviewCommentAdd, reviewCommentReply, reviewCommentResolve, mediaCatalog, mediaAvatarSet];
}

// src/write-guard.ts
init_home();
import { execFile as execFile4 } from "node:child_process";
import { readFile as readFile16 } from "node:fs/promises";
import { basename as basename6, dirname as dirname4, isAbsolute as isAbsolute2, join as join21, resolve as resolve8, sep as sep3 } from "node:path";
import { promisify as promisify4 } from "node:util";
var run4 = promisify4(execFile4);
var PROGRAM_ONLY = [
  { pattern: /^config(\/|$)/, why: "config/ \u53EA\u7531\u7A0B\u5E8F\u5199\uFF1Amodels.json \u542B\u660E\u6587 apiKey\uFF0C\u5199\u574F\u4F1A\u8BA9\u6240\u6709 Agent \u65E0\u6CD5\u8C03\u6A21\u578B\uFF08\u914D\u6A21\u578B\u8D70 PUT /api/agents/<id>/config\uFF09" },
  { pattern: /projects\/[^/]+\/sessions(\/|$)/, why: "sessions/ \u662F\u4F1A\u8BDD\u539F\u59CB\u8BB0\u5F55\uFF08JSONL\uFF09\uFF0CAgent \u5199\u5B83\u4F1A\u6C61\u67D3\u5BF9\u8BDD\u6B63\u6587" },
  // **中间层必须允许**（e2e 2026-11-19 抓出）：`.gitignore:23` 是 `**/memory/**/data/` 形态，
  // 真实布局是 `memory/user/default/data/memos.db-wal`——写成 `memory/(data|daemon|...)` 只匹配紧邻层，
  // 会把真实布局漏掉（第一版就是这么错的）。四个名字统一放宽，与 .gitignore 的 `**` 语义对齐。
  { pattern: /memory\/(.*\/)?(data|daemon|skills|logs)(\/|$)/, why: "memory \u7684 data/daemon/skills/logs \u662F\u8BB0\u5FC6\u5E93\u7684\u8FD0\u884C\u65F6\u5B58\u50A8\uFF0C\u5199\u574F = \u8BB0\u5FC6\u4E22\u5931" },
  // `.gitignore:43` 根级 `.lifeos-worktree.json`：工作区的**注册标记**，只由建工作区的动作写。
  // 它本身不构成 mount（`worktreeMountOf` 只看目录名），所以"不加固也无害"；
  // 但它正好是"伪造工作区"那条路的**第一步**——守卫在工具执行前跑，拒掉这一次就等于
  // 让"先造 marker 再写假树"永远走不通（鸡生不出蛋）。
  { pattern: /^\.lifeos-worktree\.json$/, why: "\u5DE5\u4F5C\u533A\u6CE8\u518C\u6807\u8BB0\uFF0C\u53EA\u7531\u5EFA\u5DE5\u4F5C\u533A\u7684\u52A8\u4F5C\u5199" }
];
function programOnlyOf(relative3) {
  if (relative3 === void 0) return void 0;
  for (const entry of PROGRAM_ONLY) if (entry.pattern.test(relative3)) return entry.why;
  return void 0;
}
async function fakeWorktreeOf(home2, scope, taskId, target) {
  const mount = worktreeMountOf(target);
  if (mount === void 0) return void 0;
  if (await isRegisteredWorktree(mount.path)) return void 0;
  return fakeWorktreeReason(home2, scope, taskId, target, mount.path);
}
function worktreeScopeOf(target) {
  const mount = worktreeMountOf(target);
  if (mount === void 0) return { mount: void 0 };
  if (mount.kind !== HOME_DIR) return { mount: mount.path };
  const owner = ownerOfHomeMount(mount.path);
  if (owner === void 0) return { mount: mount.path };
  const rel = target.slice(mount.path.length).split(sep3).filter((part) => part !== "");
  if (rel.length === 0) return { mount: mount.path };
  if (rel[0] === "agents") {
    const agent = rel[1];
    if (agent === void 0) return { mount: mount.path };
    if (agent !== owner.agentId) {
      return { mount: mount.path, reason: `\u8FD9\u91CC\u662F\u300C${owner.agentId}\u300D\u7684\u5DE5\u4F5C\u533A\uFF0C\u4E0D\u542B Agent\u300C${agent}\u300D\u7684\u6587\u4EF6` };
    }
    const tasksAt = rel.indexOf("tasks");
    if (rel[2] === "projects" && tasksAt !== -1) {
      const pid = rel[3];
      const dir = rel[tasksAt + 1];
      if (pid !== void 0 && pid !== owner.projectId) {
        return { mount: mount.path, reason: `\u8FD9\u91CC\u53EA\u68C0\u51FA\u300C${owner.projectId}\u300D\u7684 Task\uFF0C\u4E0D\u542B\u5176\u5B83 project` };
      }
      if (dir !== void 0 && dir !== owner.dirName) {
        return { mount: mount.path, reason: `\u672C Task \u7684\u5DE5\u4F5C\u533A\u4E0D\u542B\u5176\u4ED6 Task\uFF08\u300C${dir}\u300D\uFF09\uFF1B\u8981\u6539\u5B83\u8BF7\u5728\u8BE5 Task \u91CC\u505A` };
      }
    }
  }
  return { mount: mount.path };
}
function scopeReasonOf(target, reason) {
  return `\u62D2\u7EDD\u5199\u5165 ${target}
\u539F\u56E0\uFF1A${reason}\u3002
\u5728\u8FD9\u79CD\u4F4D\u7F6E\u5199\u6587\u4EF6\u4E0D\u4F1A\u8FDB\u4EFB\u4F55\u68C0\u89C6\u6E90\uFF08\u5DE5\u4F5C\u533A\u662F sparse \u68C0\u51FA\uFF0Cgit add -A \u4E5F\u4F1A\u62D2\u7EDD\uFF09\uFF0C
\u770B\u8D77\u6765\u5199\u6210\u529F\u4E86\uFF0C\u5408\u5E76\u540E\u5374\u662F\u65E7\u503C\u3002\u8981\u6539\u522B\u7684 Task\uFF0C\u8BF7\u5728\u90A3\u4E2A Task \u91CC\u505A\u3002`;
}
function ownerOfHomeMount(mount) {
  const parts = dirname4(mount).split(sep3);
  const n = parts.length;
  if (n < 5) return void 0;
  if (parts[n - 2] !== "tasks" || parts[n - 4] !== "projects") return void 0;
  const dirName = parts[n - 1];
  const projectId = parts[n - 3];
  const agentId = parts[n - 5];
  if (dirName === void 0 || projectId === void 0 || agentId === void 0) return void 0;
  return { agentId, projectId, dirName };
}
function isUnder(parent, child) {
  if (child === parent) return true;
  const withSep = parent.endsWith(sep3) ? parent : `${parent}${sep3}`;
  return child.startsWith(withSep);
}
function cleanArg(token) {
  const trimmed = token.trim();
  if (trimmed.length >= 2 && (trimmed.startsWith('"') && trimmed.endsWith('"') || trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
function resolveTarget(raw, cwd, home2) {
  const trimmed = cleanArg(raw);
  const expanded = trimmed === "~" ? home2 : trimmed.startsWith("~/") ? join21(home2, trimmed.slice(2)) : trimmed;
  return isAbsolute2(expanded) ? resolve8(expanded) : resolve8(cwd, expanded);
}
var TRACKED_TTL_MS = 3e4;
var trackedCache = /* @__PURE__ */ new Map();
var ignoreCache = /* @__PURE__ */ new Map();
var writeGuardStats = { checkIgnoreCalls: 0, cacheResets: 0 };
function resetWriteGuardCaches() {
  trackedCache.clear();
  ignoreCache.clear();
  writeGuardStats.checkIgnoreCalls = 0;
  writeGuardStats.cacheResets += 1;
}
var git4 = async (home2, args) => (await run4("git", ["-C", home2, "-c", "core.quotePath=false", ...args], { timeout: 6e4, maxBuffer: 64 * 1024 * 1024 })).stdout;
async function trackedFilesOf(home2) {
  const cached = trackedCache.get(home2);
  if (cached !== void 0 && Date.now() - cached.at < TRACKED_TTL_MS && cached.value instanceof Set) return cached.value;
  const out = await git4(home2, ["ls-files", "-z"]).catch(() => "");
  const set = new Set(out.split("\0").filter((path) => path !== ""));
  trackedCache.set(home2, { at: Date.now(), value: set });
  return set;
}
function repoRelative(home2, target) {
  if (!isUnder(home2, target)) return void 0;
  return target.slice(home2.length).replace(/^[\\/]/, "").split(sep3).join("/");
}
async function gitInvisible(home2, target) {
  const relative3 = repoRelative(home2, target);
  if (relative3 === void 0) return false;
  const tracked = await trackedFilesOf(home2);
  if (tracked.has(relative3)) return false;
  const cached = ignoreCache.get(target);
  if (cached !== void 0 && Date.now() - cached.at < TRACKED_TTL_MS && typeof cached.value === "boolean") return cached.value;
  writeGuardStats.checkIgnoreCalls += 1;
  const ignored = await run4("git", ["-C", home2, "check-ignore", "-q", target], { timeout: 3e4 }).then(() => true, () => false);
  ignoreCache.set(target, { at: Date.now(), value: ignored });
  return ignored;
}
var taskContextCache = /* @__PURE__ */ new Map();
async function taskDocContextOf(home2, scope, taskId) {
  const key = `${home2}\0${scope.agentId}\0${scope.projectId}\0${taskId}`;
  const cached = taskContextCache.get(key);
  if (cached !== void 0 && Date.now() - cached.at < TRACKED_TTL_MS) return cached.value;
  const taskDir = await resolveTaskDir({ agentId: scope.agentId, projectId: scope.projectId }, taskId);
  const value = taskDir === void 0 ? void 0 : { taskDir, docRoot: await taskDocRootOf(taskDir, scope, basename6(taskDir)) };
  taskContextCache.set(key, { at: Date.now(), value });
  return value;
}
async function decideWrite(input) {
  const { home: home2, scope, taskId, target } = input;
  if (taskId !== void 0) {
    const context = await taskDocContextOf(home2, scope, taskId);
    if (context !== void 0) {
      if (isUnder(context.docRoot, target)) {
        const fake = await fakeWorktreeOf(home2, scope, taskId, target);
        if (fake !== void 0) return { allow: false, reason: fake };
        return { allow: true };
      }
      if (isUnder(join21(context.taskDir, REPO_DIR), target)) {
        const fake = await fakeWorktreeOf(home2, scope, taskId, target);
        if (fake !== void 0) return { allow: false, reason: fake };
        return { allow: true };
      }
    }
  }
  const relative3 = repoRelative(home2, target);
  const programOnly = programOnlyOf(relative3);
  if (programOnly !== void 0) {
    const isConfig = /^config(\/|$)/.test(relative3 ?? "");
    return {
      allow: false,
      reason: `\u62D2\u7EDD\u5199\u5165 ${target}
\u539F\u56E0\uFF1A${programOnly}\u3002` + (isConfig ? "\n\u914D\u6A21\u578B\u8BF7\u7528 PUT /api/agents/<id>/config\u3002" : "")
    };
  }
  if (await gitInvisible(home2, target)) {
    const fake = await fakeWorktreeOf(home2, scope, taskId, target);
    if (fake !== void 0) return { allow: false, reason: fake };
    const scoped = worktreeScopeOf(target);
    if (scoped.mount !== void 0 && scoped.reason !== void 0) {
      return { allow: false, reason: `${scopeReasonOf(target, scoped.reason)}` };
    }
    return { allow: true };
  }
  return {
    allow: false,
    reason: await denyReason(home2, scope, taskId, target)
  };
}
async function fakeWorktreeReason(home2, scope, taskId, target, mount) {
  const hint = taskId === void 0 ? void 0 : await taskDocContextOf(home2, scope, taskId);
  return `\u62D2\u7EDD\u5199\u5165 ${target}
\u539F\u56E0\uFF1A${mount} \u4E0D\u662F\u4E00\u4E2A\u6CE8\u518C\u8FC7\u7684\u5DE5\u4F5C\u533A\uFF08\u7F3A .lifeos-worktree.json \u6216 .git\uFF09\u3002
\u5728\u5DE5\u4F5C\u533A\u8DEF\u5F84\u4E0B\u5199\u6587\u4EF6\u4F1A\u9020\u51FA\u4E00\u4EFD"\u5047\u5DE5\u4F5C\u533A"\u2014\u2014\u6CA1\u6709\u5206\u652F\u3001\u6CA1\u6709\u68C0\u89C6\u6E90\uFF0C
\u800C\u88C5\u914D\u5668\u53EA\u5224 task.md \u5728\u4E0D\u5728\uFF0C\u4F1A\u9759\u9ED8\u628A\u8BFB\u6839\u5207\u8FC7\u53BB\uFF0C\u4ECE\u6B64\u8FD9\u4E2A Task \u7684\u6539\u52A8\u7ED5\u8FC7\u68C0\u89C6\u3002
` + (hint === void 0 ? "\u5F53\u524D\u4F1A\u8BDD\u6CA1\u6709 Task \u6307\u9488\u3002" : `\u672C Task \u7684\u6587\u6863\u8BF7\u5199\u5728\uFF1A${hint.docRoot}`);
}
async function denyReason(home2, scope, taskId, target) {
  const hint = taskId === void 0 ? void 0 : await taskDocContextOf(home2, scope, taskId);
  const where = hint === void 0 ? "\u5F53\u524D\u4F1A\u8BDD\u6CA1\u6709 Task \u6307\u9488" : `\u672C Task \u7684\u6587\u6863\u8BF7\u5199\u5728\u5DE5\u4F5C\u533A\uFF1A${hint.docRoot}`;
  return `\u62D2\u7EDD\u5199\u5165 ${target}
\u539F\u56E0\uFF1ATask \u7684\u6587\u6863\u4E0E\u5171\u4EAB\u5C42\u53EA\u7531**\u5408\u5E76**\u5199\u5165\u4E3B\u533A\uFF1B\u76F4\u63A5\u5199\u4F1A\u7ED5\u8FC7\u68C0\u89C6\uFF0C
\u800C\u4E14\u4E0E\u5DE5\u4F5C\u533A\u5206\u652F\u5E76\u53D1\u65F6\u4F1A\u88AB git \u9759\u9ED8\u51B2\u6389\uFF08\u4E3B\u533A\u672A\u63D0\u4EA4\u7684\u6539\u52A8 merge \u4E0D\u8BBE\u9632\uFF09\u3002
${where}`;
}
var GIT_READ_ONLY = /* @__PURE__ */ new Set([
  "status",
  "log",
  "diff",
  "show",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "rev-list",
  "merge-base",
  "cat-file",
  "describe",
  "blame",
  "for-each-ref",
  "show-ref",
  "shortlog",
  "name-rev",
  "symbolic-ref",
  "diff-tree",
  "diff-files",
  "diff-index",
  "help",
  "--version",
  "grep",
  "check-ignore",
  "var"
]);
var WRITE_COMMANDS = /* @__PURE__ */ new Set([
  "rm",
  "rmdir",
  "mkdir",
  "touch",
  "mv",
  "cp",
  "ln",
  "install",
  "truncate",
  "dd",
  "tee",
  "chmod",
  "chown",
  "patch"
]);
var INTERPRETER = /^(python3?|node|perl|ruby|php|deno|bun)$/;
function quotedPaths(segment) {
  const out = [];
  for (const match of segment.matchAll(/"([^"]+)"|'([^']+)'/g)) {
    const text = match[1] ?? match[2] ?? "";
    if (text.includes("/") || /\.(md|txt|json|ts|tsx|js|mjs|py|sh|yml|yaml)$/.test(text)) out.push(text);
  }
  return out;
}
function literalAssignments(segment) {
  const out = /* @__PURE__ */ new Map();
  for (const match of segment.matchAll(/(?:^|[\s;])([A-Za-z_][A-Za-z0-9_]*)=("([^"]*)"|'([^']*)'|([^\s;|&]+))/g)) {
    const name = match[1];
    const value = match[3] ?? match[4] ?? match[5];
    if (name !== void 0 && value !== void 0 && (value.includes("/") || value.startsWith("~"))) out.set(name, value);
  }
  return out;
}
function expandVariables(text, vars) {
  return text.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (whole, braced, bare) => vars.get(braced ?? bare ?? "") ?? whole
  );
}
function segmentsOf(command) {
  return command.split(/&&|\|\||;|\n|\|/).map((part) => part.trim()).filter((part) => part !== "");
}
function redirectTargets(segment) {
  const out = [];
  for (const match of segment.matchAll(/\d?>>?\s*("[^"]+"|'[^']+'|[^\s;&|]+)/g)) {
    const raw = match[1];
    if (raw === void 0) continue;
    const value = raw.replace(/^["']|["']$/g, "");
    if (value !== "" && value !== "/dev/null" && !value.startsWith("&")) out.push(value);
  }
  return out;
}
function gitVerdict(segment) {
  const tokens = segment.trim().split(/\s+/);
  const at = tokens.indexOf("git");
  if (at === -1) return { writes: false };
  let index = at + 1;
  let repo;
  while (index < tokens.length) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (token === "-C" && next !== void 0) {
      repo = cleanArg(next);
      index += 2;
      continue;
    }
    if (token !== void 0 && token.startsWith("-")) {
      index += 1;
      continue;
    }
    break;
  }
  const sub = tokens[index];
  if (sub === void 0) return { writes: false, ...repo !== void 0 ? { repo } : {} };
  if (GIT_READ_ONLY.has(sub)) return { writes: false, ...repo !== void 0 ? { repo } : {} };
  if (sub === "config") {
    const read = tokens.some((token) => token === "--get" || token === "--list" || token === "-l" || token === "--get-regexp");
    return { writes: !read, ...repo !== void 0 ? { repo } : {} };
  }
  if (sub === "worktree" && tokens.includes("list")) return { writes: false, ...repo !== void 0 ? { repo } : {} };
  if (sub === "stash" && tokens[index + 1] === "list") return { writes: false, ...repo !== void 0 ? { repo } : {} };
  if (sub === "branch") {
    const write2 = tokens.some((token) => ["-d", "-D", "-m", "-M", "-c", "-C", "--delete", "--move", "--copy", "--set-upstream-to", "--unset-upstream"].includes(token));
    return { writes: write2, ...repo !== void 0 ? { repo } : {} };
  }
  if (sub === "tag") return { writes: false, ...repo !== void 0 ? { repo } : {} };
  return { writes: true, ...repo !== void 0 ? { repo } : {} };
}
function isInsideWorktree(target) {
  const parts = resolve8(target).split(sep3);
  for (let i = 0; i + 1 < parts.length; i += 1) {
    if (/^\d{4}-/.test(parts[i] ?? "") && [HOME_DIR, REPO_DIR, "worktree"].includes(parts[i + 1] ?? "")) return true;
  }
  return false;
}
async function decideBash(input) {
  const depth = input.depth ?? 0;
  if (depth > 3) return { allow: true };
  const vars = /* @__PURE__ */ new Map();
  let cwd = input.cwd;
  for (const rawSegment of segmentsOf(input.command)) {
    const segment = expandVariables(rawSegment, vars);
    for (const [name, value] of literalAssignments(segment)) vars.set(name, value);
    const cd = /^cd\s+("[^"]+"|'[^']+'|\S+)\s*$/.exec(segment);
    if (cd !== null) {
      cwd = resolveTarget((cd[1] ?? "").replace(/^["']|["']$/g, ""), cwd, input.home);
      continue;
    }
    if (/(^|\s)git(\s|$)/.test(segment)) {
      const verdict = gitVerdict(segment);
      if (verdict.writes) {
        const repo = resolveTarget(verdict.repo ?? ".", cwd, input.home);
        if (!isInsideWorktree(repo)) {
          return {
            allow: false,
            reason: `\u62D2\u7EDD\u6267\u884C\uFF1A${segment}
\u539F\u56E0\uFF1Agit \u5199\u64CD\u4F5C\u4F1A\u8BA9\u4E3B\u533A\u504F\u79BB"\u53EA\u7531\u5408\u5E76\u5199\u5165"\uFF08\u4E3B\u533A\u672A\u63D0\u4EA4\u7684\u6539\u52A8 merge \u65F6\u4E0D\u8BBE\u9632\uFF0C\u4F1A\u88AB\u9759\u9ED8\u51B2\u6389\uFF09\u3002
\u8981\u5728 Task \u7684\u5206\u652F\u4E0A\u505A\u4E8B\uFF0C\u8BF7\u5148 \`cd\` \u8FDB\u8BE5 Task \u7684 repo/ \u6216 home/ \u5DE5\u4F5C\u533A\u518D\u6267\u884C\u3002`
          };
        }
      }
    }
    const firstToken = segment.split(/\s+/)[0] ?? "";
    if (["bash", "sh", "zsh", "source", "."].includes(firstToken)) {
      const scriptArg = segment.split(/\s+/).slice(1).find((token) => !token.startsWith("-"));
      if (scriptArg !== void 0) {
        const scriptPath = resolveTarget(scriptArg, cwd, input.home);
        const body = await readFile16(scriptPath, "utf8").catch(() => void 0);
        if (body !== void 0) {
          const inner = await decideBash({ ...input, command: body, cwd: dirname4(scriptPath), depth: depth + 1 });
          if (!inner.allow) return inner;
        }
      }
      continue;
    }
    const targets = [];
    if (INTERPRETER.test(firstToken) && segment.split(/\s+/).some((token) => token === "-c" || token === "-e" || token === "--eval")) {
      targets.push(...quotedPaths(segment));
    }
    targets.push(...redirectTargets(segment));
    if (WRITE_COMMANDS.has(firstToken)) {
      const args = segment.split(/\s+/).slice(1).filter((token) => !token.startsWith("-")).map((token) => cleanArg(token));
      if (["mv", "cp", "ln", "install"].includes(firstToken)) {
        const dest = args.at(-1);
        if (dest !== void 0) targets.push(dest);
      } else {
        targets.push(...args);
      }
    }
    if (/(^|\s)sed\s+(-[a-zA-Z]*i|--in-place)/.test(segment) || /(^|\s)perl\s+-[a-zA-Z]*i/.test(segment)) {
      const last = segment.split(/\s+/).at(-1);
      if (last !== void 0) targets.push(last);
    }
    for (const match of segment.matchAll(/of=("[^"]+"|'[^']+'|\S+)/g)) {
      const raw = match[1]?.replace(/^["']|["']$/g, "");
      if (raw !== void 0) targets.push(raw);
    }
    const heredoc = /<<-?\s*'?([A-Za-z_][A-Za-z0-9_]*)'?/.exec(segment);
    for (const raw of targets) {
      if (raw === "" || raw.includes("$") || raw.startsWith("-")) continue;
      const target = resolveTarget(raw, cwd, input.home);
      const verdict = await decideWrite({ home: input.home, scope: input.scope, taskId: input.taskId, target });
      if (!verdict.allow) {
        return {
          allow: false,
          reason: `\u62D2\u7EDD\u6267\u884C\uFF1A${segment}
\uFF08\u5B83\u4F1A\u5199 ${target}\uFF09
${verdict.reason}`
        };
      }
    }
    void heredoc;
  }
  return { allow: true };
}
var WRITE_TOOLS = /* @__PURE__ */ new Set(["write", "edit"]);
var BASH_TOOLS = /* @__PURE__ */ new Set(["bash", "powershell"]);
function createLifeOsWriteGuardExtension(input) {
  const scope = { agentId: input.agentId, projectId: input.projectId };
  return {
    name: "lifeos-write-guard",
    hidden: true,
    factory: (pi) => {
      pi.on("tool_call", async (event, ctx) => {
        const typed = event;
        const toolName = typeof typed.toolName === "string" ? typed.toolName : "";
        const home2 = resolveHome();
        const taskId = input.getTaskId();
        if (WRITE_TOOLS.has(toolName)) {
          const raw = typed.input?.path;
          if (typeof raw !== "string" || raw.trim() === "") return;
          const target = resolveTarget(raw, ctx.cwd, home2);
          const verdict = await decideWrite({ home: home2, scope, taskId, target });
          if (!verdict.allow) return { block: true, reason: verdict.reason };
          return;
        }
        if (BASH_TOOLS.has(toolName)) {
          const command = typed.input?.command;
          if (typeof command !== "string" || command.trim() === "") return;
          const verdict = await decideBash({ home: home2, scope, taskId, command, cwd: ctx.cwd });
          if (!verdict.allow) return { block: true, reason: verdict.reason };
        }
      });
    }
  };
}

// src/row-patch.ts
var ROW_PATCH_MIN_INTERVAL_MS = 1e3;
function createRowPatchPublisher(options = {}) {
  const now = options.now ?? Date.now;
  const interval = options.interval ?? ROW_PATCH_MIN_INTERVAL_MS;
  const send = options.send ?? ((agentId, sessionId, projectId, patch) => {
    publish(agentId, {
      sessionId,
      ...projectId !== void 0 ? { projectId } : {},
      type: "row",
      patch
    });
  });
  const pending2 = /* @__PURE__ */ new Map();
  const sentAt = /* @__PURE__ */ new Map();
  const lastSent = /* @__PURE__ */ new Map();
  const keyOf3 = (agentId, sessionId) => `${agentId}\0${sessionId}`;
  function flush(agentId, sessionId, projectId) {
    const key = keyOf3(agentId, sessionId);
    const entry = pending2.get(key);
    if (entry === void 0) return;
    const patch = entry.queued;
    if (entry.timer !== void 0) {
      clearTimeout(entry.timer);
      entry.timer = void 0;
    }
    pending2.delete(key);
    sentAt.set(key, now());
    if (Object.keys(patch).length === 0) return;
    if (patch.running !== void 0) lastSent.set(key, patch.running);
    send(agentId, sessionId, projectId, patch);
  }
  return {
    /**
     * 运行态变化（turn 开始 / 工具切换 / 文本块切换）。
     * 返回 true = 已立即发出；false = 排队等尾随发送。
     */
    pushRunning(agentId, sessionId, projectId, running2) {
      const key = keyOf3(agentId, sessionId);
      const previous = lastSent.get(key);
      const queued = pending2.get(key)?.queued.running;
      const candidate = queued ?? previous;
      if (candidate !== void 0 && candidate !== null && candidate.phase === running2.phase && candidate.tool === running2.tool && candidate.since === running2.since) {
        return false;
      }
      const entry = pending2.get(key) ?? { queued: {} };
      entry.queued = { ...entry.queued, running: running2 };
      pending2.set(key, entry);
      const last = sentAt.get(key) ?? 0;
      const elapsed = now() - last;
      if (last === 0 || elapsed >= interval) {
        flush(agentId, sessionId, projectId);
        return true;
      }
      if (entry.timer === void 0) {
        entry.timer = setTimeout(() => flush(agentId, sessionId, projectId), interval - elapsed);
        entry.timer.unref?.();
      }
      return false;
    },
    /** 终态（done / error）：清掉运行态 + 带 unread / failure / lastActivityAt，**立即发、不节流**。 */
    pushTerminal(agentId, sessionId, projectId, patch) {
      const key = keyOf3(agentId, sessionId);
      const entry = pending2.get(key);
      if (entry?.timer !== void 0) {
        clearTimeout(entry.timer);
        entry.timer = void 0;
      }
      pending2.delete(key);
      sentAt.set(key, now());
      lastSent.set(key, null);
      const full = { running: null, ...patch };
      send(agentId, sessionId, projectId, full);
    },
    /** 非运行态变化（重命名 / 切 Task）：低频用户动作，立即发。 */
    pushNow(agentId, sessionId, projectId, patch) {
      send(agentId, sessionId, projectId, patch);
    },
    /** 测试与收尾用：把还在排队的补丁全部发出。 */
    flushAll() {
      for (const [key, entry] of Array.from(pending2.entries())) {
        if (entry.timer !== void 0) clearTimeout(entry.timer);
        const [agentId, sessionId] = key.split("\0");
        if (agentId === void 0 || sessionId === void 0) continue;
        flush(agentId, sessionId, void 0);
      }
    },
    /** 会话被删除：丢掉它的登记。 */
    forget(agentId, sessionId) {
      const key = keyOf3(agentId, sessionId);
      const entry = pending2.get(key);
      if (entry?.timer !== void 0) clearTimeout(entry.timer);
      pending2.delete(key);
      sentAt.delete(key);
      lastSent.delete(key);
    },
    /** 诊断：还有多少会话在排队。 */
    size() {
      return pending2.size;
    }
  };
}
var shared;
function rowPatches() {
  shared ??= createRowPatchPublisher();
  return shared;
}
function phaseOfStreamEvent(event) {
  if (event.type === "thinking") return { phase: "thinking" };
  if (event.type === "delta") return { phase: "text" };
  if (event.type === "tool_start") {
    return typeof event.name === "string" && event.name !== "" ? { phase: "tool", tool: event.name } : { phase: "tool" };
  }
  return void 0;
}

// src/session-title.ts
var TITLE_MAX_CHARS = 60;
function titleFromFirstMessage(text) {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > TITLE_MAX_CHARS ? oneLine.slice(0, TITLE_MAX_CHARS) : oneLine;
}
var LEADING_FILLER = [
  // 顺序重要：长的在前（先匹配 `请用 lifeos_ask 问`，就不会被 `请用` 抢先）
  // 只删**手段/引导**部分，保留后面的动宾（`交给 coder：…` / `问 coder：…`）——
  // 动宾是会话的实质内容，删了会变成"coder：只回两个字"这种没有动作的开头。
  "\u8BF7\u7528 lifeos_ask",
  "\u8BF7\u7528 lifeos_send",
  "\u8BF7\u7528",
  "\u8BF7\u4F60",
  "\u8BF7\u5E2E\u6211",
  "\u5E2E\u6211",
  "\u9EBB\u70E6",
  "\u7528 lifeos_send",
  "\u7528 lifeos_ask",
  "\u7528",
  "\u6211\u4EEC\u9700\u8981",
  "\u6211\u4EEC\u60F3\u8981",
  "\u6211\u4EEC\u73B0\u5728",
  "\u73B0\u5728\u6211\u4EEC\u9700\u8981",
  "\u6211\u60F3\u8981",
  "\u6211\u60F3",
  "\u6211\u89C9\u5F97\u8FD8\u662F",
  "\u6211\u89C9\u5F97",
  "\u6211\u8FD9\u91CC\u6709\u4E00\u4E9B",
  "\u8FD9\u91CC\u9762",
  "\u8FD9\u91CC\u662F",
  "\u6211\u4EEC\u73B0\u5728\u5E94\u8BE5",
  "\u73B0\u5728\u6211\u4EEC",
  "\u6211\u4EEC\u6765",
  "\u6211\u4EEC\u8981",
  "\u628A\u8FD9\u4EF6\u4E8B",
  "\u5148",
  "\u90A3\u4E48",
  "\u6240\u4EE5",
  "\u7136\u540E",
  "\u53E6\u5916",
  "\u8FD8\u6709"
];
var TRAILING_PUNCT = /[。！？.!?，,；;：:、\s]+$/;
function shortTitleOf(title) {
  let text = (title ?? "").replace(/\s+/g, " ").trim();
  if (text === "") return text;
  for (const filler of LEADING_FILLER) {
    if (!text.startsWith(filler)) continue;
    const rest = text.slice(filler.length).replace(/^[，,：:、\s]+/, "");
    if (rest.length >= 4) {
      text = rest;
      break;
    }
  }
  for (const vague of ["\u628A\u8FD9\u4EF6\u4E8B", "\u8FD9\u4EF6\u4E8B", "\u8FD9\u4E2A", "\u90A3\u4E2A"]) {
    if (!text.startsWith(vague)) continue;
    const rest = text.slice(vague.length).replace(/^[，,：:、\s]+/, "");
    if (rest.length >= 6) {
      text = rest;
      break;
    }
  }
  text = text.replace(TRAILING_PUNCT, "");
  return text;
}

// src/row-activity.ts
function rowActivityOf(input) {
  if (input.runningSince !== void 0 && input.runningSince !== "") {
    const since = Date.parse(input.runningSince);
    const elapsedMs = Number.isNaN(since) ? 0 : Math.max(0, input.now - since);
    return {
      state: "running",
      running: {
        since: input.runningSince,
        elapsedMs,
        ...input.phase !== void 0 ? { phase: input.phase } : {},
        ...input.tool !== void 0 ? { tool: input.tool } : {}
      }
    };
  }
  const unseen = input.unreadSince !== void 0 && input.unreadSince !== "";
  if (input.failure !== void 0 && unseen) return { state: "failure", failure: input.failure };
  if (unseen) return { state: "unread", unread: { since: input.unreadSince } };
  return { state: "idle" };
}
var DISPLAY_TITLE_MAX_CHARS = 50;
function displayTitleOf(raw) {
  const shortened = shortTitleOf(raw);
  return shortened.length > DISPLAY_TITLE_MAX_CHARS ? shortened.slice(0, DISPLAY_TITLE_MAX_CHARS) : shortened;
}

// src/env-refs.ts
function envRefsOf(config) {
  const text = config ?? "";
  if (text.trim().startsWith("!")) return [];
  const names = [];
  let index = 0;
  while (index < text.length) {
    const dollar = text.indexOf("$", index);
    if (dollar < 0) break;
    const next = text[dollar + 1];
    if (next === "$" || next === "!") {
      index = dollar + 2;
      continue;
    }
    if (next === "{") {
      const end = text.indexOf("}", dollar + 2);
      if (end < 0) {
        index = dollar + 1;
        continue;
      }
      const name = text.slice(dollar + 2, end);
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !names.includes(name)) names.push(name);
      index = end + 1;
      continue;
    }
    index = dollar + 1;
  }
  return names;
}
function isCommandConfigValue(config) {
  return (config ?? "").trim().startsWith("!");
}
function envRefState(env, name) {
  const value = env[name];
  if (value === void 0) return { kind: "missing" };
  if (value.trim() === "") return { kind: "empty" };
  if (value.includes("\n") || value.includes("\r")) return { kind: "malformed", reason: "newline" };
  if (value !== value.trim()) return { kind: "malformed", reason: "whitespace" };
  if (/^["']|["']$/.test(value)) return { kind: "malformed", reason: "quoted" };
  return { kind: "ok" };
}

// src/env-reload.ts
import { readFile as readFile17 } from "node:fs/promises";
import { homedir as homedir2 } from "node:os";
import { join as join22 } from "node:path";
var CONFIG_FILES = [".zshenv", ".zprofile", ".zshrc", ".profile", ".bashrc"];
var EXPORT_LINE = /^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
var NEEDS_SHELL = /\$\(|`|\$\{|\$[A-Za-z_]/;
function parseShellExports(text) {
  const out = /* @__PURE__ */ new Map();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const match = EXPORT_LINE.exec(line);
    if (match === null) continue;
    const name = match[1];
    const raw = (match[2] ?? "").trim();
    if (name === void 0 || raw === "") continue;
    if (NEEDS_SHELL.test(raw)) continue;
    let value = raw;
    const quote2 = value[0];
    if ((quote2 === '"' || quote2 === "'") && value.endsWith(quote2) && value.length >= 2) {
      value = value.slice(1, -1);
    }
    if (value === "") continue;
    out.set(name, value);
  }
  return out;
}
async function reloadEnvFromShellConfigs(env = process.env, home2 = homedir2()) {
  const filled = [];
  for (const file of CONFIG_FILES) {
    const text = await readFile17(join22(home2, file), "utf8").catch(() => void 0);
    if (text === void 0) continue;
    for (const [name, value] of parseShellExports(text)) {
      const current = env[name];
      if (current !== void 0 && current.trim() !== "") continue;
      env[name] = value;
      if (!filled.includes(name)) filled.push(name);
    }
  }
  return filled;
}

// src/model-follow.ts
var same = (a, b) => a.provider === b.provider && a.id === b.id;
function decideRestoreModel(input) {
  if (input.overridden) return "keep";
  if (input.stored === void 0 || input.agentDefault === void 0) return "keep";
  return same(input.stored, input.agentDefault) ? "keep" : "follow";
}
function decideRestoreThinking(input) {
  if (input.overridden) return "keep";
  if (input.stored === void 0 || input.agentDefault === void 0) return "keep";
  return input.stored === input.agentDefault ? "keep" : "follow";
}

// src/session-views.ts
init_home();
init_atomic_file();
import { readFile as readFile18, writeFile as writeFile16 } from "node:fs/promises";
import { join as join23 } from "node:path";
function createSessionViews(options) {
  const state = /* @__PURE__ */ new Map();
  const viewWrittenAt = /* @__PURE__ */ new Map();
  const trailing = /* @__PURE__ */ new Set();
  let chain2 = Promise.resolve();
  const keyOf3 = (agentId, sessionId) => `${agentId}\0${sessionId}`;
  const entryOf = (agentId, sessionId) => {
    const key = keyOf3(agentId, sessionId);
    const existing = state.get(key);
    if (existing !== void 0) return existing;
    const created = {};
    state.set(key, created);
    return created;
  };
  const maxIso = (a, b) => a === void 0 || Date.parse(b) > Date.parse(a) ? b : a;
  function persistNow() {
    const snapshot2 = {};
    for (const [key, entry] of state) snapshot2[key] = { ...entry };
    const text = JSON.stringify(snapshot2, null, 2) + "\n";
    chain2 = chain2.then(() => options.persist(text)).catch(() => void 0);
  }
  return {
    /** 读盘并与内存合并（取较晚的时间戳）：启动前已发生的标记不会被旧文件覆盖。 */
    async load() {
      const text = await options.load();
      if (text === void 0) return;
      const parsed = JSON.parse(text);
      for (const [key, entry] of Object.entries(parsed)) {
        const current = state.get(key) ?? {};
        const projectId = entry.projectId ?? current.projectId;
        state.set(key, {
          ...projectId !== void 0 ? { projectId } : {},
          ...entry.completedAt !== void 0 ? { completedAt: maxIso(current.completedAt, entry.completedAt) } : current.completedAt !== void 0 ? { completedAt: current.completedAt } : {},
          ...entry.viewedAt !== void 0 ? { viewedAt: maxIso(current.viewedAt, entry.viewedAt) } : current.viewedAt !== void 0 ? { viewedAt: current.viewedAt } : {},
          // 终态随记录一起恢复；取**较晚**那次（与 completedAt 同一判定）
          ...entry.lastState !== void 0 && (entry.completedAt === void 0 || current.completedAt === void 0 || Date.parse(entry.completedAt) >= Date.parse(current.completedAt)) ? { lastState: entry.lastState, ...entry.failureKind !== void 0 ? { failureKind: entry.failureKind } : {} } : current.lastState !== void 0 ? { lastState: current.lastState } : {},
          ...current.lastState !== void 0 && entry.lastState === void 0 ? { lastState: current.lastState } : {},
          // 失败是独立的一份：取较晚的失败时间与较晚的已看时间
          ...entry.failureAt !== void 0 ? { failureAt: maxIso(current.failureAt, entry.failureAt) } : current.failureAt !== void 0 ? { failureAt: current.failureAt } : {},
          ...entry.failureSeenAt !== void 0 ? { failureSeenAt: maxIso(current.failureSeenAt, entry.failureSeenAt) } : current.failureSeenAt !== void 0 ? { failureSeenAt: current.failureSeenAt } : {},
          ...entry.failureDetail !== void 0 ? { failureDetail: entry.failureDetail } : current.failureDetail !== void 0 ? { failureDetail: current.failureDetail } : {}
        });
      }
    },
    /**
     * 回填缺失的 projectId（旧记录没有这个字段）：resolve 返回 undefined 的保持不变。
     * 返回回填的条数；有变化才落盘。
     */
    async backfill(resolve10) {
      let filled = 0;
      for (const [key, entry] of Array.from(state.entries())) {
        if (entry.completedAt === void 0 || entry.projectId !== void 0) continue;
        const [agentId, sessionId] = key.split("\0");
        const projectId = await resolve10(agentId ?? "", sessionId ?? "");
        if (projectId === void 0) continue;
        entry.projectId = projectId;
        filled += 1;
      }
      if (filled > 0) persistNow();
      return filled;
    },
    /**
     * 回填终态（`lastState`/`failureKind`）—— 给**旧版本写入的记录**补上（Task 0005 · P8）。
     *
     * 为什么必须有这一步：`lastState` 是本轮新加的字段，此前落盘的记录只有 `completedAt`。
     * 不做迁移的话，用户打开界面看到的是**全 0**（几十条会话都"结束过"却一个都不计），
     * 而且这个 0 会一直持续到那些会话各自重新跑一遍。
     *
     * 为什么可以推断：`completedAt` 存在 = 这条会话**确实结束过**；
     * 结束方式写在会话文件最后一条 assistant 的 `stopReason`/`errorMessage` 里
     * （调用方注入 `resolve` 去读，通常是 `classifyFailure`）。
     * 读不到（文件已删/没有 assistant）→ 返回 undefined，**这条保持缺失，不编造**。
     *
     * 只处理 `lastState === undefined` 的记录：已经有终态的一律不动（新记录是对的）。
     */
    async backfillOutcomes(resolve10) {
      let filled = 0;
      for (const [key, entry] of Array.from(state.entries())) {
        if (entry.completedAt === void 0) continue;
        const [agentId, sessionId] = key.split("\0");
        const found = await resolve10(agentId ?? "", sessionId ?? "").catch(() => void 0);
        if (found === void 0) continue;
        let changed = false;
        if (entry.lastState === void 0 && found.outcome !== void 0) {
          entry.lastState = found.outcome.state;
          if (found.outcome.state === "error" && found.outcome.failureKind !== void 0) entry.failureKind = found.outcome.failureKind;
          else delete entry.failureKind;
          changed = true;
        }
        if (entry.failureAt === void 0 && found.lastFailureAt !== void 0) {
          entry.failureAt = found.lastFailureAt;
          if (found.lastFailureKind !== void 0) entry.failureKind = found.lastFailureKind;
          if (entry.viewedAt !== void 0 && Date.parse(entry.viewedAt) >= Date.parse(found.lastFailureAt)) {
            entry.failureSeenAt = entry.viewedAt;
          }
          changed = true;
        }
        if (changed) filled += 1;
      }
      if (filled > 0) persistNow();
      return filled;
    },
    /**
     * 清理孤儿未读：只保留仍然存在的会话（exists 由调用方注入，通常是查会话文件）。
     * 为什么需要：修复前删除会话没有清未读，残留记录会让侧栏的蓝点永远去不掉（2026-10-25 实测）。
     */
    async prune(exists2) {
      let removed = 0;
      for (const [key, entry] of Array.from(state.entries())) {
        if (entry.completedAt === void 0) continue;
        const [agentId, sessionId] = key.split("\0");
        if (await exists2(agentId ?? "", sessionId ?? "")) continue;
        state.delete(key);
        viewWrittenAt.delete(key);
        removed += 1;
      }
      if (removed > 0) persistNow();
      return removed;
    },
    /** 会话被删除：连同未读记录一起遗忘（落盘）。 */
    forget(agentId, sessionId) {
      const key = keyOf3(agentId, sessionId);
      if (!state.delete(key)) return;
      viewWrittenAt.delete(key);
      persistNow();
    },
    /**
     * 记一次终态。
     *
     * `outcome` 决定 `lastState` / `failureKind`（Task 0005 · P8-1）：
     * 它们是聚合层回答"这个 Agent 有几个失败会话"的**唯一索引**，不写就得回扫会话文件。
     * 只在**这次确实更新了 completedAt** 时才写终态——旧终态不能被更早的补写覆盖。
     */
    markCompleted(agentId, sessionId, at, projectId, outcome) {
      const entry = entryOf(agentId, sessionId);
      const previous = entry.completedAt;
      entry.completedAt = maxIso(entry.completedAt, at);
      if (projectId !== void 0 && projectId !== "") entry.projectId = projectId;
      const isLatest = previous === void 0 || Date.parse(at) >= Date.parse(previous);
      if (outcome !== void 0 && isLatest) {
        entry.lastState = outcome.state;
        if (outcome.state === "error" && outcome.failureKind !== void 0) entry.failureKind = outcome.failureKind;
        else delete entry.failureKind;
      }
      if (outcome?.state === "error") {
        entry.failureAt = maxIso(entry.failureAt, at);
        if (outcome.failureKind !== void 0) entry.failureKind = outcome.failureKind;
        if (outcome.failureDetail !== void 0) entry.failureDetail = outcome.failureDetail;
      }
      persistNow();
    },
    /**
     * 全量状态条目（**不看已读**）：聚合层用它数"每个 Agent 有几个在跑/待查看/失败"。
     *
     * 与 `unread()` 的区别：`unread()` 只给"还没看"的；这里给所有有过终态的会话，
     * 因为助手列要的是"这个 Agent 有什么动静"，与"用户看没看"无关（看没看由前端按 viewedAt 判）。
     */
    states() {
      const out = [];
      for (const [key, entry] of state) {
        if (entry.completedAt === void 0) continue;
        const [agentId, sessionId] = key.split("\0");
        out.push({
          agentId: agentId ?? "",
          sessionId: sessionId ?? "",
          ...entry.projectId !== void 0 ? { projectId: entry.projectId } : {},
          completedAt: entry.completedAt,
          ...entry.lastState !== void 0 ? { lastState: entry.lastState } : {},
          ...entry.failureKind !== void 0 ? { failureKind: entry.failureKind } : {},
          ...entry.failureAt !== void 0 ? { failureAt: entry.failureAt } : {},
          ...entry.failureSeenAt !== void 0 ? { failureSeenAt: entry.failureSeenAt } : {}
          // viewedAt 不在这里暴露：本方法回答"发生了什么"，不回答"看没看"
        });
      }
      return out;
    },
    /** 某会话的最近终态（前端补丁与测试用）。 */
    outcomeOf(agentId, sessionId) {
      const entry = state.get(keyOf3(agentId, sessionId));
      if (entry?.lastState === void 0) return void 0;
      return { state: entry.lastState, ...entry.failureKind !== void 0 ? { failureKind: entry.failureKind } : {} };
    },
    markViewed(agentId, sessionId, at) {
      const entry = entryOf(agentId, sessionId);
      entry.viewedAt = maxIso(entry.viewedAt, at);
      if (entry.failureAt !== void 0) entry.failureSeenAt = maxIso(entry.failureSeenAt, at);
      const key = keyOf3(agentId, sessionId);
      const now = options.now();
      const last = viewWrittenAt.get(key);
      if (last === void 0 || now - last >= options.throttleMs) {
        viewWrittenAt.set(key, now);
        persistNow();
        return;
      }
      if (trailing.has(key)) return;
      trailing.add(key);
      const timer = setTimeout(() => {
        trailing.delete(key);
        viewWrittenAt.set(key, options.now());
        persistNow();
      }, options.throttleMs - (now - last));
      timer.unref?.();
    },
    /**
     * "有结束但用户还没看"的会话（Task 0005 · 2026-11-04 改）。
     *
     * **失败与成功分别判断**：一个会话可能失败两次、后来成功 ——
     * 若只看"最近一次终态"，那两次失败会被成功覆盖，用户永远看不到（实测过的真实情况）。
     *
     * 规则：
     *   · 失败未看（`failureAt > failureSeenAt` 或从未看过）→ 报 `error`（**优先**：更需要处理）
     *   · 成功未看（`completedAt > viewedAt` 或从未看过）→ 报 `done`
     *   · 两者都看过 → 不报
     */
    unread() {
      const out = [];
      for (const [key, entry] of state) {
        const [agentId, sessionId] = key.split("\0");
        const base = {
          agentId: agentId ?? "",
          sessionId: sessionId ?? "",
          ...entry.projectId !== void 0 ? { projectId: entry.projectId } : {}
        };
        const unseenFailure = entry.failureAt !== void 0 && (entry.failureSeenAt === void 0 || Date.parse(entry.failureAt) > Date.parse(entry.failureSeenAt));
        if (unseenFailure) {
          out.push({ ...base, completedAt: entry.failureAt, state: "error", ...entry.failureKind !== void 0 ? { failureKind: entry.failureKind } : {}, ...entry.failureDetail !== void 0 ? { failureDetail: entry.failureDetail } : {} });
          continue;
        }
        if (entry.completedAt === void 0) continue;
        const seen = entry.viewedAt !== void 0 && Date.parse(entry.viewedAt) >= Date.parse(entry.completedAt);
        if (seen) continue;
        out.push({ ...base, completedAt: entry.completedAt, ...entry.lastState !== void 0 ? { state: entry.lastState } : {} });
      }
      return out;
    },
    /** 等待已排队的写盘完成（测试与关闭前用）。 */
    flush() {
      return chain2;
    }
  };
}
var STATE_NOTE = `# state \xB7 \u8FD0\u884C\u72B6\u6001

- \u80CC\u666F\uFF1A\u670D\u52A1\u7AEF\u7684\u8FD0\u884C\u65F6\u72B6\u6001\uFF08\u5F53\u524D\u662F\u5404\u4F1A\u8BDD\u7684\u672A\u8BFB/\u5DF2\u8BFB\u65F6\u95F4\uFF09\uFF0C\u7531\u7A0B\u5E8F\u5199\u5165\uFF0C\u968F\u4F7F\u7528\u53D8\u5316\u3002
- \u5185\u5BB9\uFF1Asession-views.json\uFF08\u4F1A\u8BDD \u2192 \u5B8C\u6210\u65F6\u95F4 / \u67E5\u770B\u65F6\u95F4\uFF09\u3002\u4E0D\u662F\u7ED9\u4EBA\u8BFB\u7684\u6587\u6863\uFF0C\u4E5F\u4E0D\u5165\u5E93\uFF08~/.lifeos/.gitignore \u5DF2\u6392\u9664\uFF09\u3002
- \u4F55\u65F6\u8BFB\uFF1A\u6392\u67E5"\u4E3A\u4EC0\u4E48\u6709/\u6CA1\u6709\u672A\u8BFB\u70B9"\u65F6\u3002
- \u600E\u4E48\u7528\uFF1A\u4E0D\u8981\u624B\u6539\uFF1B\u5220\u9664\u6587\u4EF6\u7B49\u4E8E\u6E05\u7A7A\u6240\u6709\u672A\u8BFB\u8BB0\u5F55\uFF08\u4E0B\u6B21\u5B8C\u6210\u4F1A\u91CD\u65B0\u8BB0\u5F55\uFF09\u3002
`;
var instances = /* @__PURE__ */ new Map();
var loads = /* @__PURE__ */ new Map();
function sessionViewsReady() {
  sessionViewsOf();
  return loads.get(resolveHome()) ?? Promise.resolve();
}
function sessionViewsOf() {
  const home2 = resolveHome();
  const existing = instances.get(home2);
  if (existing !== void 0) return existing;
  const dir = join23(home2, "state");
  const file = join23(dir, "session-views.json");
  const created = createSessionViews({
    now: () => Date.now(),
    load: () => readFile18(file, "utf8").catch(() => void 0),
    persist: async (text) => {
      await writeTextAtomic(file, text);
      await writeFile16(join23(dir, "AGENTS.md"), STATE_NOTE, { flag: "wx", mode: 384 }).catch(() => void 0);
    },
    throttleMs: 5e3
  });
  instances.set(home2, created);
  loads.set(home2, created.load().catch(() => void 0));
  return created;
}

// src/turn-origin.ts
var TURN_ORIGIN_ENTRY = "lifeos_turn_origin";
var USER_ORIGIN = { kind: "user" };
function parseOrigin(data) {
  if (data === void 0) return void 0;
  if (data.kind === "user") return { kind: "user" };
  if (data.kind !== "agent") return void 0;
  const agentId = typeof data.agentId === "string" ? data.agentId.trim() : "";
  if (agentId === "") return void 0;
  return {
    kind: "agent",
    agentId,
    ...typeof data.name === "string" && data.name.trim() !== "" ? { name: data.name.trim() } : {},
    ...typeof data.via === "string" && data.via.trim() !== "" ? { via: data.via.trim() } : {}
  };
}
function lastOriginOf(branch) {
  for (let i = branch.length - 1; i >= 0; i -= 1) {
    const entry = branch[i];
    if (entry?.type !== "custom" || entry.customType !== TURN_ORIGIN_ENTRY) continue;
    return parseOrigin(entry.data);
  }
  return void 0;
}
function originLabel(origin) {
  return origin.kind === "user" ? "\u7528\u6237" : origin.name ?? origin.agentId;
}
function speakerSection(origin) {
  const body = origin.kind === "user" ? "\u672C\u8F6E\u6D88\u606F\u6765\u81EA\u7528\u6237\u672C\u4EBA\uFF08\u4E0D\u662F\u53E6\u4E00\u4E2A Agent\uFF09\u3002" : `\u672C\u8F6E\u6D88\u606F\u6765\u81EA ${originLabel(origin)}\uFF08\u53E6\u4E00\u4E2A Agent\uFF0C\u901A\u8FC7 ${origin.via ?? "\u5DE5\u5177"} \u53D1\u8D77\uFF1B\u4E0D\u662F\u7528\u6237\u672C\u4EBA\uFF09\u3002`;
  return `<lifeos_current_speaker>${body}</lifeos_current_speaker>`;
}

// src/agent-host.ts
import { randomBytes } from "node:crypto";

// src/turn-verdict.ts
import { readFile as readFile19 } from "node:fs/promises";

// src/turn-state.ts
var COMPLETED_STOPS = /* @__PURE__ */ new Set(["stop", "length", "error"]);
function turnOutcomeOf(input) {
  if (!input.sawAssistant) return "lost";
  if (input.lastStop === void 0 || input.lastStop === "") return "done";
  return COMPLETED_STOPS.has(input.lastStop) ? "done" : "lost";
}

// src/turn-verdict.ts
async function lastUserTurnVerdict(path) {
  const text = await readFile19(path, "utf8").catch(() => "");
  if (text.trim() === "") return null;
  const lines = text.split("\n");
  let lastUser = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = (lines[i] ?? "").trim();
    if (line === "") continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === "message" && entry.message?.role === "user") {
        lastUser = i;
        break;
      }
    } catch {
    }
  }
  if (lastUser === -1) return null;
  const turnId = `jsonl-${lastUser + 1}`;
  let lastAssistantStop;
  let sawAssistant = false;
  for (let i = lastUser + 1; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trim();
    if (line === "") continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type !== "message") continue;
      if (entry.message?.role !== "assistant") continue;
      sawAssistant = true;
      lastAssistantStop = entry.message.stopReason;
    } catch {
    }
  }
  if (!sawAssistant) return { turnId, state: turnOutcomeOf({ sawAssistant: false }) };
  return { turnId, state: turnOutcomeOf({ sawAssistant: true, ...lastAssistantStop !== void 0 ? { lastStop: lastAssistantStop } : {} }) };
}
async function readTurnVerdict(path) {
  return await lastUserTurnVerdict(path);
}

// src/agent-host.ts
var ACTIVE_TASK_ENTRY = "lifeos_active_task";
var agents = /* @__PURE__ */ new Map();
var stateKey = (agentId) => `${resolveHome()}\0${agentId}`;
function stateOf(agentId) {
  const key = stateKey(agentId);
  const existing = agents.get(key);
  if (existing !== void 0) return existing;
  const created = { sessions: /* @__PURE__ */ new Map(), pending: /* @__PURE__ */ new Map() };
  agents.set(key, created);
  return created;
}
function aggregateSlotOf(agentId, sessionId) {
  if (isRunning(agentId, sessionId)) return "running";
  const item = sessionViewsOf().unread().find((u) => u.agentId === agentId && u.sessionId === sessionId);
  if (item === void 0) return void 0;
  return item.state === "error" ? "unreadError" : item.state === "done" ? "unreadDone" : void 0;
}
function aggregateStatus() {
  const buckets = /* @__PURE__ */ new Map();
  const bucketOf = (agentId, projectId) => {
    const key = `${agentId}\0${projectId ?? ""}`;
    let entry = buckets.get(key);
    if (entry === void 0) {
      entry = { agentId, ...projectId !== void 0 && projectId !== "" ? { projectId } : {}, running: 0, unreadDone: 0, unreadError: 0 };
      buckets.set(key, entry);
    }
    return entry;
  };
  const runningKeys = /* @__PURE__ */ new Set();
  for (const entry of runningAll()) {
    runningKeys.add(`${entry.agentId}\0${entry.sessionId}`);
    bucketOf(entry.agentId, entry.projectId).running += 1;
  }
  for (const item of sessionViewsOf().unread()) {
    const key = `${item.agentId}\0${item.sessionId}`;
    if (runningKeys.has(key)) continue;
    const slot = item.state === "error" ? "unreadError" : item.state === "done" ? "unreadDone" : void 0;
    if (slot === void 0) continue;
    bucketOf(item.agentId, item.projectId)[slot] += 1;
  }
  return [...buckets.values()].filter((entry) => entry.running + entry.unreadDone + entry.unreadError > 0);
}
function globalSnapshot() {
  const running2 = runningAll().map((entry) => {
    const record = turnLedger.get(`${entry.agentId}\0${entry.sessionId}`);
    return record !== void 0 && record.state === "running" ? { ...entry, turnId: record.turnId } : entry;
  });
  const unread = sessionViewsOf().unread();
  return { running: running2, unread, turns: turnSnapshotAll(), aggregate: aggregateStatus() };
}
var ALL_TOOL_NAMES = [...["read", "bash", "edit", "write", "grep", "find", "ls", "powershell"], ...LIFEOS_TOOL_NAMES];
async function createHostedResourceLoader(input) {
  const loader = new DefaultResourceLoader({
    cwd: input.cwd,
    agentDir: input.configDir,
    settingsManager: input.settingsManager,
    noContextFiles: true,
    extensionFactories: [
      createLifeOsPromptExtension(input.getParts ?? input.parts),
      createLifeOsImageBudgetExtension(),
      createLifeOsReadPathExtension(),
      // 写入守卫（Task 0004 · P4 · L2）：Agent 的 write/edit/bash 只能落在**当前 Task 的工作区**里。
      // 挂在这里而不是文件系统层：`git merge` 不经过工具层 → "合并写入主区"自动合法，条文才落得下去。
      ...input.writeGuard !== void 0 ? [createLifeOsWriteGuardExtension(input.writeGuard)] : []
    ]
  });
  await loader.reload();
  return loader;
}
async function createHostedSession(agentId, sessionManager, mode, taskId) {
  const cwd = sessionManager.getCwd();
  const configDir = join24(resolveHome(), "config");
  const modelRuntime = await ModelRuntime.create({
    authPath: process.env.LIFEOS_AUTH_PATH?.trim() || join24(configDir, "auth.json"),
    modelsPath: process.env.LIFEOS_MODELS_PATH?.trim() || join24(configDir, "models.json")
  });
  const settingsManager = SettingsManager.create(cwd, configDir);
  const projectId = projectOfSessionDir(sessionManager.getSessionDir());
  const parts = await buildPromptParts(agentId, projectId, taskId);
  const getParts = async () => {
    const currentTaskId = activeTaskOf(sessionManager) ?? taskId;
    const base = await buildPromptParts(agentId, projectId, currentTaskId);
    const origin = currentOriginOf(sessionManager);
    return origin === void 0 ? base : { ...base, speakerSection: speakerSection(origin) };
  };
  const resourceLoader = await createHostedResourceLoader({
    cwd,
    configDir,
    settingsManager,
    parts,
    getParts,
    // 当前 Task 必须**实时读**：会话可以中途切 Task；创建时取一次会永久滞后（与 customTools 同一口径）。
    writeGuard: {
      agentId,
      projectId,
      getTaskId: () => stateOf(agentId).sessions.get(sessionManager.getSessionId())?.taskId ?? activeTaskOf(sessionManager)
    }
  });
  const resolution = await resolveModelChoice(agentId);
  let model;
  let thinkingLevel;
  let modelLabel;
  if (mode === "new" && resolution !== void 0) {
    const found = modelRuntime.getModel(resolution.choice.defaultProvider, resolution.choice.defaultModel);
    if (found !== void 0) {
      model = found;
      const sourceLabel = resolution.source === "agent" ? "Agent \u4E2A\u4EBA\u914D\u7F6E" : resolution.source === "settings" ? "\u7CFB\u7EDF settings" : "\u6A21\u578B\u6E05\u5355\u9ED8\u8BA4";
      modelLabel = `${resolution.choice.defaultProvider}/${resolution.choice.defaultModel}\uFF08\u6765\u6E90 ${sourceLabel}\uFF09`;
      if (resolution.choice.defaultThinkingLevel !== void 0) {
        thinkingLevel = resolution.choice.defaultThinkingLevel;
      }
    }
  }
  const { session } = await createAgentSession({
    sessionManager,
    cwd,
    agentDir: configDir,
    modelRuntime,
    settingsManager,
    resourceLoader,
    tools: [...ALL_TOOL_NAMES],
    // 工具绑定会话上下文（谁 / 哪个项目），模型不用传：agentId + projectId 都从会话自身推导
    customTools: createAgentTools({
      agentId,
      projectId,
      // 会话 id：稳定，创建后不变（send 的完成回流要知道"回流到哪"）
      sessionId: sessionManager.getSessionId(),
      // 当前 Task 必须**实时读**：会话可以中途切 Task（/task、lifeos_task_enter），
      // 在创建时取一次会永久滞后。用 getter 每次调用现读（Task 0015 · T1 的 lane 维度）。
      get taskId() {
        return stateOf(agentId).sessions.get(sessionManager.getSessionId())?.taskId ?? activeTaskOf(sessionManager);
      },
      // 建 Task 即进入它：会话指针指向新 Task（下一轮装配读取），与用户在界面里 /task 切换是同一件事
      // 进入即切换（协议 §7）：写会话指针，下一轮装配生效；校验与写指针共用 setSessionTask
      onEnterTask: async (taskId2) => {
        const result = await setSessionTask(agentId, sessionManager.getSessionId(), taskId2);
        if (!result.ok) throw new Error(`\u65E0\u6CD5\u8FDB\u5165 Task ${taskId2}\uFF1A${result.reason}`);
      }
    }),
    ...model !== void 0 ? { model } : {},
    ...thinkingLevel !== void 0 ? { thinkingLevel } : {}
  });
  if (mode !== "new") {
    await adoptAgentDefault(session, sessionManager, modelRuntime, agentId);
  } else {
    if (model !== void 0) {
      const actual = session.model;
      if (actual === void 0 || actual.provider !== model.provider || actual.id !== model.id) {
        await session.abort().catch(() => void 0);
        const detail = describeModelUnavailable(model, await readProvidersConfig());
        throw new Error(formatModelUnavailable(model, detail));
      }
    }
  }
  return { session, modelRuntime, modelLabel };
}
function projectOfSessionDir(dir) {
  const marker = `${sep4}projects${sep4}`;
  const index = dir.lastIndexOf(marker);
  if (index === -1) return "workspace";
  return dir.slice(index + marker.length).split(sep4)[0] ?? "workspace";
}
function sessionDir(agentId, projectId = "workspace") {
  return join24(resolveHome(), "agents", agentId, "projects", projectId, "sessions");
}
async function readSessionEntries(agentId, sessionId) {
  const found = await findSessionFile(agentId, sessionId);
  if (found === void 0) return void 0;
  const text = await readFile20(found.path, "utf8");
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const parsed = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
    }
  }
  const header = parsed[0]?.type === "session" ? parsed[0] : void 0;
  if (header === void 0) return void 0;
  return { header, entries: parsed.slice(1) };
}
async function findSessionFile(agentId, sessionId) {
  const root = join24(resolveHome(), "agents", agentId, "projects");
  const entries = await readdir14(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join24(root, entry.name, "sessions");
    const file = (await readdir14(dir).catch(() => [])).find((name) => name.endsWith(`_${sessionId}.jsonl`));
    if (file !== void 0) return { path: join24(dir, file), dir };
  }
  return void 0;
}
async function canonicalProjectId(agentId, projectId) {
  if (projectId === "workspace") return projectId;
  const manifests = await readProjectManifests(agentId);
  if (manifests.has(projectId)) return projectId;
  for (const manifest of manifests.values()) if (manifest.legacyId === projectId) return manifest.id;
  return projectId;
}
async function createSession(agentId, cwd, projectIdInput = "workspace") {
  const projectId = await canonicalProjectId(agentId, projectIdInput);
  if (projectId === "workspace") {
    await ensureAgentProjectLayer(join24(resolveHome(), "agents", agentId, "projects", "workspace"));
  }
  const task = await ensureDefaultTask({ agentId, projectId });
  const manager = SessionManager.create(cwd, sessionDir(agentId, projectId));
  const { session, modelRuntime, modelLabel } = await createHostedSession(agentId, manager, "new", task.id);
  const sessionId = manager.getSessionId();
  session.sessionManager.appendCustomEntry(ACTIVE_TASK_ENTRY, { taskId: task.id, at: (/* @__PURE__ */ new Date()).toISOString() });
  if (modelLabel !== void 0) console.log(`[assembly] \u65B0\u5EFA\u4F1A\u8BDD ${sessionId} \xB7 \u6A21\u578B ${modelLabel} \xB7 Task ${task.id}`);
  stateOf(agentId).sessions.set(sessionId, { session, modelRuntime, taskId: task.id });
  stateOf(agentId).pending.set(sessionId, { projectId, at: (/* @__PURE__ */ new Date()).toISOString(), taskId: task.id });
  return sessionId;
}
function pendingSessions(agentId) {
  const state = stateOf(agentId);
  return [...state.pending.entries()].map(([sessionId, meta]) => {
    const session = state.sessions.get(sessionId);
    const name = session?.session.sessionManager.getSessionName();
    const counts = session === void 0 ? void 0 : countsOfMessages(session);
    return {
      sessionId,
      ...meta,
      ...name !== void 0 && name !== "" ? { name } : {},
      ...counts !== void 0 ? { counts } : {}
    };
  });
}
function countsOfMessages(state) {
  const counts = { user: 0, assistant: 0, toolResult: 0, system: 0 };
  for (const message of messagesOf(state)) {
    if (message.role === "user") counts.user += 1;
    else if (message.role === "assistant") counts.assistant += 1;
    else if (message.role === "toolResult") counts.toolResult += 1;
    else if (message.role === "system") counts.system += 1;
  }
  return counts;
}
function sessionCwd(agentId, sessionId) {
  return stateOf(agentId).sessions.get(sessionId)?.session.sessionManager.getCwd();
}
async function projectIdOfSession(agentId, sessionId) {
  const pending2 = stateOf(agentId).pending.get(sessionId);
  if (pending2 !== void 0) return pending2.projectId;
  const found = await findSessionFile(agentId, sessionId);
  return found === void 0 ? void 0 : projectOfSessionDir(found.dir);
}
var ANNOTATION_ENTRY = "lifeos_annotation";
function annotationsOf(manager) {
  const byId = /* @__PURE__ */ new Map();
  const order = [];
  for (const entry of manager.getBranch()) {
    if (entry?.type !== "custom" || entry.customType !== ANNOTATION_ENTRY) continue;
    const data = entry.data;
    const op = data?.op;
    if (op === "consume") {
      const ids = data?.ids;
      const by = data?.consumedBy;
      if (!Array.isArray(ids) || typeof by !== "string" || by === "") continue;
      for (const each of ids) {
        if (typeof each !== "string") continue;
        const current = byId.get(each);
        if (current === void 0) continue;
        byId.set(each, { ...current, consumedBy: by });
      }
      continue;
    }
    const raw = data?.annotation;
    if (raw === void 0 || typeof raw.id !== "string" || raw.id === "") continue;
    if (op === "remove") {
      if (byId.delete(raw.id)) order.splice(order.indexOf(raw.id), 1);
      continue;
    }
    if (op !== "add" && op !== "update") continue;
    const anno = toStoredAnnotation(raw);
    if (anno === void 0) continue;
    if (!byId.has(anno.id)) order.push(anno.id);
    byId.set(anno.id, anno);
  }
  return order.flatMap((id) => {
    const a = byId.get(id);
    return a === void 0 ? [] : [a];
  });
}
function toStoredAnnotation(raw) {
  const str = (v) => typeof v === "string" ? v : void 0;
  const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : void 0;
  const id = str(raw.id);
  const messageId = str(raw.messageId);
  const blockIndex = num(raw.blockIndex);
  const start = num(raw.start);
  const end = num(raw.end);
  const quote2 = str(raw.quote);
  const note = str(raw.note);
  if (id === void 0 || id === "" || messageId === void 0 || messageId === "") return void 0;
  if (blockIndex === void 0 || blockIndex < 0) return void 0;
  if (start === void 0 || end === void 0 || start < 0 || end <= start) return void 0;
  if (quote2 === void 0 || note === void 0) return void 0;
  const marksRaw = raw.marks;
  const marks = Array.isArray(marksRaw) ? marksRaw.filter((m) => typeof m === "string" && m !== "") : [];
  if (marks.length === 0) return void 0;
  const authorRaw = raw.author;
  const kind = authorRaw?.kind === "agent" ? "agent" : "user";
  const authorId = typeof authorRaw?.id === "string" ? authorRaw.id : "";
  const consumedBy = str(raw.consumedBy);
  const supersededBy = str(raw.supersededBy);
  return {
    id,
    author: { kind, id: authorId },
    messageId,
    blockIndex,
    start,
    end,
    quote: quote2,
    marks,
    note,
    ...consumedBy !== void 0 && consumedBy !== "" ? { consumedBy } : {},
    ...supersededBy !== void 0 && supersededBy !== "" ? { supersededBy } : {}
  };
}
function appendAnnotation(manager, op, annotation) {
  manager.appendCustomEntry(ANNOTATION_ENTRY, { op, annotation, at: (/* @__PURE__ */ new Date()).toISOString() });
}
function consumeAnnotations(manager, ids, consumedBy) {
  if (ids.length === 0) return;
  manager.appendCustomEntry(ANNOTATION_ENTRY, {
    op: "consume",
    ids: [...ids],
    consumedBy,
    at: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function activeTaskOf(manager) {
  const branch = manager.getBranch();
  for (let i = branch.length - 1; i >= 0; i -= 1) {
    const entry = branch[i];
    if (entry?.type !== "custom" || entry.customType !== ACTIVE_TASK_ENTRY) continue;
    const data = entry.data;
    return typeof data?.taskId === "string" && data.taskId !== "" ? data.taskId : void 0;
  }
  return void 0;
}
async function getSession(agentId, sessionId, cwd) {
  const state = stateOf(agentId);
  const existing = state.sessions.get(sessionId);
  if (existing !== void 0) return existing;
  const found = await findSessionFile(agentId, sessionId);
  if (found === void 0) return void 0;
  const manager = SessionManager.open(found.path, found.dir, cwd);
  const projectId = projectOfSessionDir(found.dir);
  let taskId = activeTaskOf(manager);
  if (taskId === void 0) {
    try {
      const task = await ensureDefaultTask({ agentId, projectId });
      taskId = task.id;
      manager.appendCustomEntry(ACTIVE_TASK_ENTRY, { taskId, at: (/* @__PURE__ */ new Date()).toISOString() });
    } catch {
    }
  }
  const { session, modelRuntime } = await createHostedSession(agentId, manager, "restored", taskId);
  const restored = { session, modelRuntime, ...taskId !== void 0 ? { taskId } : {} };
  state.sessions.set(sessionId, restored);
  state.pending.delete(sessionId);
  return restored;
}
async function ensureTurnShard(agentId, sessionId, date) {
  const live = stateOf(agentId).sessions.get(sessionId)?.session.sessionManager.getSessionDir();
  const projectId = live !== void 0 ? projectOfSessionDir(live) : await projectIdOfSession(agentId, sessionId);
  if (projectId === void 0) return void 0;
  const { file } = await ensureDailyShard({ agentId, projectId }, date);
  return { file };
}
var turnLedger = /* @__PURE__ */ new Map();
function newTurnId() {
  return `turn-${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;
}
function startTurn(agentId, sessionId, turnId) {
  turnLedger.set(`${agentId}\0${sessionId}`, { sessionId, turnId, state: "running", at: (/* @__PURE__ */ new Date()).toISOString() });
}
function finishTurn(agentId, sessionId, turnId, state) {
  turnLedger.set(`${agentId}\0${sessionId}`, { sessionId, turnId, state, at: (/* @__PURE__ */ new Date()).toISOString() });
}
function turnSnapshotAll() {
  const out = [];
  for (const [key, record] of turnLedger) {
    const sep6 = key.indexOf("\0");
    out.push({ agentId: key.slice(0, sep6), ...record });
  }
  return out;
}
function markSessionViewed(agentId, sessionId, at, projectId) {
  const before = sessionViewsOf().unread().some((item) => item.agentId === agentId && item.sessionId === sessionId);
  sessionViewsOf().markViewed(agentId, sessionId, at);
  if (!before) return;
  rowPatches().pushNow(agentId, sessionId, projectId, { unread: null });
}
function recordCompletion(agentId, sessionId, aborted, projectId, failureKind, failureDetail) {
  const at = (/* @__PURE__ */ new Date()).toISOString();
  if (!aborted) {
    sessionViewsOf().markCompleted(
      agentId,
      sessionId,
      at,
      projectId,
      failureKind !== void 0 ? { state: "error", failureKind, ...failureDetail !== void 0 ? { failureDetail } : {} } : { state: "done" }
    );
  }
  const onSession = isOnSession(agentId, sessionId);
  void log.info("agent-host", "recordCompletion", "\u56DE\u5408\u7EC8\u6001\u4E0E\u5DF2\u8BFB\u5224\u5B9A", {
    sessionId,
    agentId,
    projectId,
    details: { aborted, onSession, state: failureKind !== void 0 ? "error" : "done" }
  });
  if (onSession) markSessionViewed(agentId, sessionId, at, projectId);
  return { onSession };
}
var abortRequested = /* @__PURE__ */ new Set();
async function turnLastOf(agentId, sessionId) {
  const record = turnLedger.get(`${agentId}\0${sessionId}`);
  if (record !== void 0) {
    return { turn: record };
  }
  const found = await findSessionFile(agentId, sessionId);
  if (found === void 0) return { turn: null };
  const verdict = await readTurnVerdict(found.path);
  if (verdict === null) return { turn: null };
  return { turn: { sessionId, turnId: verdict.turnId, state: verdict.state, at: (/* @__PURE__ */ new Date()).toISOString() } };
}
async function sessionIntegrity(agentId, sessionId) {
  const found = await findSessionFile(agentId, sessionId);
  if (found === void 0) return void 0;
  const text = await readFile20(found.path, "utf8").catch(() => "");
  if (text.trim() === "") return { orphanParents: 0 };
  const entries = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
    }
  }
  const ids = /* @__PURE__ */ new Set();
  for (const entry of entries) {
    const id = entry.id;
    if (typeof id === "string" && id !== "") ids.add(id);
  }
  let orphanParents = 0;
  for (const entry of entries) {
    const parent = entry.parentId;
    if (typeof parent === "string" && parent !== "" && !ids.has(parent)) orphanParents += 1;
  }
  return { orphanParents };
}
async function sessionExists(agentId, sessionId) {
  if (stateOf(agentId).sessions.has(sessionId)) return true;
  return await findSessionFile(agentId, sessionId) !== void 0;
}
function nameSessionFromFirstMessage(agentId, sessionId, text) {
  const state = stateOf(agentId).sessions.get(sessionId);
  if (state === void 0) return false;
  const sessionManager = state.session.sessionManager;
  if (sessionManager.getSessionName()) return false;
  const title = titleFromFirstMessage(text);
  if (title === "") return false;
  sessionManager.appendSessionInfo(title);
  broadcast({ type: "agents_changed" });
  return true;
}
var PAYLOAD_TOO_LARGE2 = /payload.?too.?large|request body.{0,20}(too large|exceed)|413/i;
async function recordPayloadObservation(target, outcome) {
  const providerId = target.session.model?.provider ?? "";
  if (providerId === "") return;
  const bodyBytes = payloadEstimateOf(target).estimated;
  if (bodyBytes <= 0) return;
  await recordObservedToFile(resolveHome(), { providerId, bodyBytes, outcome }).catch(() => void 0);
}
var startingTurns = /* @__PURE__ */ new Set();
var busyKey = (agentId, sessionId) => `${resolveHome()}\0${agentId}\0${sessionId}`;
function sessionBusyOf(agentId, sessionId) {
  return startingTurns.has(busyKey(agentId, sessionId)) || isRunning(agentId, sessionId);
}
function reserveTurn(agentId, sessionId) {
  const key = busyKey(agentId, sessionId);
  if (sessionBusyOf(agentId, sessionId)) return void 0;
  startingTurns.add(key);
  let released = false;
  return {
    turnId: newTurnId(),
    release: () => {
      if (released) return;
      released = true;
      startingTurns.delete(key);
    }
  };
}
function appendTurnOrigin(manager, origin, turnId) {
  manager.appendCustomEntry(TURN_ORIGIN_ENTRY, {
    ...origin,
    ...turnId !== void 0 ? { turnId } : {},
    at: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function currentOriginOf(manager) {
  return lastOriginOf(manager.getBranch());
}
async function runTurn2(agentId, sessionId, text, options = {}) {
  const images = options.images;
  const origin = options.origin ?? USER_ORIGIN;
  const state = stateOf(agentId);
  const target = state.sessions.get(sessionId);
  if (target === void 0) {
    options.reserved?.release();
    return { ok: false, reason: "busy" };
  }
  const key = busyKey(agentId, sessionId);
  let slot;
  if (options.reserved !== void 0) {
    slot = options.reserved;
  } else {
    const acquired = reserveTurn(agentId, sessionId);
    if (acquired === void 0) return { ok: false, reason: "busy" };
    slot = acquired;
  }
  await ensureTurnShard(agentId, sessionId).catch((error) => {
    console.error(`[tasks] \u5F53\u5929\u5206\u7247\u521B\u5EFA\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`);
    void log.error("agent-host", "ensureTurnShard", "\u5F53\u5929\u5206\u7247\u521B\u5EFA\u5931\u8D25", { agentId, details: { message: error instanceof Error ? error.message : String(error) } });
  });
  const projectIdForLog = await projectIdOfSession(agentId, sessionId);
  const turnId = options.reserved?.turnId ?? newTurnId();
  startTurn(agentId, sessionId, turnId);
  bindPendingPeerTurn(agentId, sessionId, turnId);
  publish(agentId, { sessionId, projectId: projectIdForLog, type: "turn", turnId, state: "running" });
  void log.info("agent-host", "runTurn", "\u53D7\u7406\u56DE\u5408", { sessionId, turnId, agentId, projectId: projectIdForLog });
  const startedAtIso = (/* @__PURE__ */ new Date()).toISOString();
  markRunning(agentId, { sessionId, projectId: projectIdForLog, startedAt: startedAtIso });
  rowPatches().pushRunning(agentId, sessionId, projectIdForLog, { since: startedAtIso, phase: "waiting" });
  const unsubscribe = target.session.subscribe((event) => {
    const mapped = toStreamEvent(event);
    if (mapped !== void 0) {
      publish(agentId, { sessionId, ...mapped });
      const phase = phaseOfStreamEvent(mapped);
      if (phase !== void 0) {
        rowPatches().pushRunning(agentId, sessionId, projectIdForLog, {
          since: startedAtIso,
          ...phase.phase !== void 0 ? { phase: phase.phase } : {},
          ...phase.tool !== void 0 ? { tool: phase.tool } : {}
        });
      }
    }
  });
  const requestKey = `${agentId}\0${sessionId}`;
  abortRequested.delete(requestKey);
  try {
    appendTurnOrigin(target.session.sessionManager, origin, turnId);
  } catch (error) {
    void log.warn("agent-host", "runTurn", "\u5199 turn origin \u5931\u8D25\uFF08\u4E0D\u963B\u65AD\u56DE\u5408\uFF09", { sessionId, turnId, details: { message: error instanceof Error ? error.message : String(error) } });
  }
  try {
    const running2 = target.session.model;
    if (running2 !== void 0) {
      await reloadEnvFromShellConfigs().catch(() => void 0);
      if (await target.modelRuntime.checkAuth(running2.provider) === void 0) {
        const detail = describeModelUnavailable(running2, await readProvidersConfig());
        throw new Error(formatModelUnavailable(running2, detail));
      }
    }
    const attachments = images !== void 0 && images.length > 0 ? await appendAttachmentRefs(resolveHome(), text, images) : void 0;
    const promptText = attachments?.text ?? text;
    const fallbackImages = attachments !== void 0 && attachments.failed.length > 0 ? attachments.failed : void 0;
    await target.session.prompt(promptText, fallbackImages !== void 0 && fallbackImages.length > 0 ? { images: fallbackImages } : void 0);
    await recordPayloadObservation(target, "ok");
    const aborted = abortRequested.delete(requestKey);
    const settled = await outcomeOfSessionFile(agentId, sessionId).catch(() => void 0);
    const failedKind = settled?.outcome?.state === "error" ? settled.outcome.failureKind : void 0;
    const failedDetail = settled?.outcome?.state === "error" ? settled.outcome.failureDetail : void 0;
    finishTurn(agentId, sessionId, turnId, failedKind !== void 0 ? "error" : "done");
    const { onSession } = recordCompletion(agentId, sessionId, aborted, projectIdForLog, failedKind, failedDetail);
    await notifyPeerTurnFinished(agentId, sessionId, turnId, "done");
    void log.info("agent-host", "runTurn", "\u56DE\u5408\u5B8C\u6210", { sessionId, turnId, agentId, projectId: projectIdForLog, details: { aborted } });
    publish(agentId, { sessionId, projectId: projectIdForLog, type: "turn", turnId, state: "done" });
    rowPatches().pushTerminal(agentId, sessionId, projectIdForLog, {
      // 被打断不算完成；或用户就停在这个会话上（已标已读）→ 两者都**不发**未读。
      // 显式发 `unread: null` 而不是"省略这个字段"：省略会让前端保留旧值。
      ...aborted || onSession ? { unread: null } : { unread: { since: (/* @__PURE__ */ new Date()).toISOString() } },
      // 回合"正常返回"但回复本身失败（模型不可用等）→ 补丁要带 failure，
      // 否则前端只能把它当 unreadDone，数字与行上的红点对不上。
      ...failedKind !== void 0 ? { failure: { kind: failedKind, detail: failedDetail ?? "", at: (/* @__PURE__ */ new Date()).toISOString() } } : {},
      lastActivityAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (failedKind !== void 0) {
      publish(agentId, { sessionId, projectId: projectIdForLog, type: "error", message: failedDetail ?? "", kind: failedKind, turnId });
    } else {
      publish(agentId, { sessionId, projectId: projectIdForLog, type: "done", turnId, aborted });
    }
  } catch (error) {
    abortRequested.delete(requestKey);
    const message = error instanceof Error ? error.message : String(error);
    if (PAYLOAD_TOO_LARGE2.test(message)) await recordPayloadObservation(target, "too_large");
    finishTurn(agentId, sessionId, turnId, "error");
    const kind = classifyFailure({ errorMessage: message, hasContent: false }) ?? "unknown";
    const { onSession: failedOnSession } = recordCompletion(agentId, sessionId, false, projectIdForLog, kind, message);
    await notifyPeerTurnFinished(agentId, sessionId, turnId, "error");
    void log.error("agent-host", "runTurn", "\u56DE\u5408\u5931\u8D25", { sessionId, turnId, agentId, projectId: projectIdForLog, details: { message } });
    publish(agentId, { sessionId, projectId: projectIdForLog, type: "turn", turnId, state: "error" });
    rowPatches().pushTerminal(agentId, sessionId, projectIdForLog, {
      // 同成功分支：用户停在这个会话上 → 已记已读 → 不发未读
      ...failedOnSession ? { unread: null } : { unread: { since: (/* @__PURE__ */ new Date()).toISOString() } },
      failure: { kind, detail: message, at: (/* @__PURE__ */ new Date()).toISOString() },
      lastActivityAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    publish(agentId, { sessionId, projectId: projectIdForLog, type: "error", message, kind, turnId });
  } finally {
    unsubscribe();
    clearRunning(agentId, sessionId);
    slot.release();
    if (await findSessionFile(agentId, sessionId) !== void 0) state.pending.delete(sessionId);
  }
  return { ok: true, turnId };
}
var emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, totalTokens: 0 });
function addUsage(totals, usage) {
  totals.input += usage.input;
  totals.output += usage.output;
  totals.cacheRead += usage.cacheRead;
  totals.cacheWrite += usage.cacheWrite;
  totals.cost += usage.cost.total;
  totals.totalTokens += usage.totalTokens;
}
function sessionUsage(state) {
  const totals = emptyUsage();
  for (const entry of state.session.sessionManager.getEntries()) {
    if (entry.type === "message") {
      if (entry.message.role === "assistant" && entry.message.usage !== void 0) {
        addUsage(totals, entry.message.usage);
      } else if (entry.message.role === "toolResult" && entry.message.usage !== void 0) {
        addUsage(totals, entry.message.usage);
      }
    } else if ((entry.type === "usage" || entry.type === "compaction" || entry.type === "branch_summary") && entry.usage !== void 0) {
      addUsage(totals, entry.usage);
    }
  }
  return totals;
}
function sessionMeta(agentId, state) {
  const model = state.session.model;
  const context = state.session.getContextUsage();
  return {
    model: model === void 0 ? null : { provider: model.provider, id: model.id },
    thinkingLevel: state.session.thinkingLevel,
    running: isRunning(agentId, state.session.sessionManager.getSessionId()),
    modelOverridden: hasModelOverride(state.session),
    activeTaskId: state.taskId ?? null,
    usage: sessionUsage(state),
    context: context === void 0 ? null : { percent: context.percent, window: context.contextWindow }
  };
}
function payloadEstimateOf(state, projection) {
  let images = 0;
  let text = 0;
  for (const message of (projection ?? state.session.sessionManager.buildSessionProjection()).messages) {
    const content = message.content;
    if (typeof content === "string") {
      text += Buffer.byteLength(content, "utf8");
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const block = part;
      if (block.type === "image" && typeof block.data === "string") images += block.data.length;
      else if (block.type === "text" && typeof block.text === "string") {
        let textBytes = Buffer.byteLength(block.text, "utf8");
        for (const ref of parseImageRefs(block.text)) {
          const fileBytes = attachmentFileSizeCached(ref);
          if (fileBytes > 0) images += Math.ceil(fileBytes / 3) * 4;
        }
        text += textBytes;
      }
    }
  }
  return { images, text, estimated: images + text };
}
async function payloadMetaOf(state) {
  const model = state.session.model;
  const limits = await readLimits(resolveHome());
  const budget = resolveBudget({
    providerId: model?.provider ?? "",
    modelLimit: model?.inputLimits?.maxRequestBytes,
    config: limits.config,
    state: limits.state
  });
  const projection = state.session.sessionManager.buildSessionProjection();
  const estimate = payloadEstimateOf(state, projection);
  const effectiveImages = budget === void 0 ? estimate.images : planElision(imageSizesOf(projection.messages), budget).kept;
  return {
    ...estimate,
    effective: effectiveImages + estimate.text,
    limit: budget?.limit ?? null,
    source: budget?.source ?? null,
    triggerBytes: budget?.triggerBytes ?? null,
    targetBytes: budget?.targetBytes ?? null
  };
}
function sessionModelOf(manager) {
  const branch = manager.getBranch();
  for (let i = branch.length - 1; i >= 0; i -= 1) {
    const entry = branch[i];
    if (entry?.type === "model_change") return { provider: entry.provider, id: entry.modelId };
  }
  return void 0;
}
var MODEL_OVERRIDE_ENTRY = "lifeos_model_override";
var THINKING_OVERRIDE_ENTRY = "lifeos_thinking_override";
function hasOverrideIn(manager) {
  return manager.getBranch().some((entry) => {
    if (entry.type !== "custom" || entry.customType !== MODEL_OVERRIDE_ENTRY) return false;
    const data = entry.data;
    return data?.legacy !== true;
  });
}
function hasModelOverride(session) {
  return hasOverrideIn(session.sessionManager);
}
function hasThinkingOverrideIn(manager) {
  return manager.getBranch().some((entry) => entry.type === "custom" && entry.customType === THINKING_OVERRIDE_ENTRY);
}
function describeModelUnavailable(model, modelsConfig) {
  const provider = modelsConfig[model.provider];
  const rawKey = typeof provider?.apiKey === "string" ? provider.apiKey : void 0;
  const label = `${model.provider}/${model.id}`;
  if (isCommandConfigValue(rawKey)) {
    return `${label} \u7684 API key \u7531\u547D\u4EE4\u63D0\u4F9B\uFF08models.json \u91CC ! \u5F00\u5934\u7684\u914D\u7F6E\uFF09\uFF0C\u547D\u4EE4\u6267\u884C\u5931\u8D25\u6216\u6CA1\u8FD4\u56DE\u5185\u5BB9`;
  }
  const refs = envRefsOf(rawKey);
  if (refs.length === 0) {
    return rawKey === void 0 ? `${label} \u5728 models.json \u91CC\u6CA1\u6709\u914D apiKey` : `${label} \u6709 apiKey \u4F46\u65E0\u6CD5\u89E3\u6790`;
  }
  const bad = refs.map((name) => ({ name, state: envRefState(process.env, name) })).filter((item) => item.state.kind !== "ok");
  if (bad.length === 0) {
    return `${label} \u7684\u51ED\u636E\u65E0\u6CD5\u89E3\u6790\uFF08\u73AF\u5883\u53D8\u91CF ${refs.join("\u3001")} \u770B\u8D77\u6765\u662F\u8BBE\u7F6E\u4E86\u7684\uFF09`;
  }
  return bad.map(({ name, state }) => {
    if (state.kind === "missing") return `\u7F3A\u5C11\u73AF\u5883\u53D8\u91CF ${name}`;
    if (state.kind === "empty") return `\u73AF\u5883\u53D8\u91CF ${name} \u5DF2\u8BBE\u7F6E\u4F46\u4E3A\u7A7A`;
    if (state.kind !== "malformed") return `\u73AF\u5883\u53D8\u91CF ${name} \u4E0D\u53EF\u7528`;
    const why = state.reason === "quoted" ? "\u5E26\u4E86\u5F15\u53F7" : state.reason === "newline" ? "\u5E26\u4E86\u6362\u884C\u7B26" : "\u9996\u5C3E\u6709\u7A7A\u683C";
    return `\u73AF\u5883\u53D8\u91CF ${name} ${why}`;
  }).join("\uFF1B");
}
async function readProvidersConfig() {
  const path = process.env.LIFEOS_MODELS_PATH?.trim() || join24(resolveHome(), "config", "models.json");
  const text = await readFile20(path, "utf8").catch(() => "");
  if (text === "") return {};
  try {
    const data = JSON.parse(text);
    return typeof data.providers === "object" && data.providers !== null ? data.providers : {};
  } catch {
    return {};
  }
}
function formatModelUnavailable(model, detail, error) {
  const raw = error instanceof Error ? error.message.trim() : "";
  const head = `${model.provider}/${model.id} \u4E0D\u53EF\u7528\uFF1A${detail}`;
  const hint = detail.startsWith("\u7F3A\u5C11\u73AF\u5883\u53D8\u91CF") || detail.startsWith("\u73AF\u5883\u53D8\u91CF") ? "\u3002\u8BF7\u5728 ~/.zshenv \u91CC\u914D\u7F6E\u597D\u8FD9\u4E2A\u53D8\u91CF\u540E\u91CD\u542F\u540E\u7AEF" : "";
  return raw === "" ? `${head}${hint}` : `${head}${hint}
\uFF08\u539F\u59CB\u9519\u8BEF\uFF1A${raw.slice(0, 300)}\uFF09`;
}
async function adoptAgentDefault(session, manager, modelRuntime, agentId) {
  const resolution = await resolveModelChoice(agentId);
  const agentDefault = resolution === void 0 ? void 0 : { provider: resolution.choice.defaultProvider, id: resolution.choice.defaultModel };
  const overridden = hasOverrideIn(manager);
  const decision = decideRestoreModel({
    stored: sessionModelOf(manager),
    agentDefault,
    overridden
  });
  const expected = overridden ? sessionModelOf(manager) : agentDefault;
  if (expected === void 0) {
  } else {
    const wanted = modelRuntime.getModel(expected.provider, expected.id);
    if (wanted !== void 0) {
      const actual = session.model;
      const same2 = actual !== void 0 && actual.provider === wanted.provider && actual.id === wanted.id;
      if (!same2 || decision === "follow") {
        try {
          await session.setModel(wanted);
        } catch (error) {
          const detail = describeModelUnavailable(wanted, await readProvidersConfig());
          throw new Error(formatModelUnavailable(wanted, detail, error));
        }
      }
    }
  }
  const wantThinking = resolution?.choice.defaultThinkingLevel;
  const thinkingDecision = decideRestoreThinking({
    stored: session.thinkingLevel,
    agentDefault: wantThinking,
    overridden: hasThinkingOverrideIn(manager)
  });
  if (thinkingDecision === "follow" && wantThinking !== void 0) {
    try {
      session.setThinkingLevel(wantThinking);
    } catch {
    }
  }
}
function applyAgentDefaultThinking(agentId, level) {
  let applied = 0;
  for (const [sessionId, state] of stateOf(agentId).sessions) {
    if (isRunning(agentId, sessionId)) continue;
    if (hasThinkingOverrideIn(state.session.sessionManager)) continue;
    if (state.session.thinkingLevel === level) continue;
    try {
      state.session.setThinkingLevel(level);
      applied += 1;
    } catch {
    }
  }
  return applied;
}
async function applyAgentDefaultModel(agentId, provider, modelId) {
  let applied = 0;
  for (const [sessionId, state] of stateOf(agentId).sessions) {
    if (hasModelOverride(state.session)) continue;
    if (isRunning(agentId, sessionId)) continue;
    const model = state.modelRuntime.getModel(provider, modelId);
    if (model === void 0) continue;
    try {
      await state.session.setModel(model);
      applied += 1;
    } catch {
    }
  }
  return applied;
}
async function abortSession(agentId, sessionId) {
  const state = stateOf(agentId).sessions.get(sessionId);
  if (state === void 0) return false;
  abortRequested.add(`${agentId}\0${sessionId}`);
  await state.session.abort();
  return true;
}
function abortRetryOf(agentId, sessionId) {
  const state = stateOf(agentId).sessions.get(sessionId);
  if (state === void 0) return false;
  if (!state.session.isRetrying) return false;
  state.session.abortRetry();
  return true;
}
async function queueSessionInput(agentId, sessionId, text, behavior, origin = USER_ORIGIN) {
  const state = stateOf(agentId).sessions.get(sessionId);
  if (state === void 0) return { code: "session_not_found" };
  if (!isRunning(agentId, sessionId)) return { code: "session_idle" };
  try {
    try {
      appendTurnOrigin(state.session.sessionManager, origin);
    } catch (error) {
      void log.warn("agent-host", "queueSessionInput", "\u5199 turn origin \u5931\u8D25\uFF08\u4E0D\u963B\u65AD\uFF09", { sessionId, details: { message: error instanceof Error ? error.message : String(error) } });
    }
    if (behavior === "steer") await state.session.steer(text);
    else await state.session.followUp(text);
    return { queued: behavior };
  } catch (error) {
    return { code: "error", message: error instanceof Error ? error.message : String(error) };
  }
}
async function compactSession(agentId, sessionId) {
  const state = stateOf(agentId).sessions.get(sessionId);
  if (state === void 0) return { ok: false, message: "\u627E\u4E0D\u5230\u8FD9\u4E2A\u4F1A\u8BDD" };
  try {
    const result = await state.session.compact();
    return { ok: true, summary: result.summary };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
async function setSessionTask(agentId, sessionId, taskId) {
  const state = stateOf(agentId).sessions.get(sessionId);
  if (state === void 0) return { ok: false, reason: "session_not_found" };
  const projectId = projectOfSessionDir(state.session.sessionManager.getSessionDir());
  const tasks = await listTasks({ agentId, projectId });
  if (!tasks.some((task2) => task2.id === taskId)) return { ok: false, reason: "task_not_found" };
  state.session.sessionManager.appendCustomEntry(ACTIVE_TASK_ENTRY, { taskId, at: (/* @__PURE__ */ new Date()).toISOString() });
  state.taskId = taskId;
  const task = tasks.find((item) => item.id === taskId);
  if (task !== void 0) {
    rowPatches().pushNow(agentId, sessionId, projectId, {
      task: { id: task.id, title: task.title, status: task.status, type: task.type }
    });
  }
  return { ok: true, taskId };
}
var THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
async function setSessionModel(agentId, sessionId, provider, modelId) {
  const state = stateOf(agentId).sessions.get(sessionId);
  if (state === void 0) return { ok: false, reason: "session_not_found" };
  const model = state.modelRuntime.getModel(provider, modelId);
  if (model === void 0) return { ok: false, reason: "model_not_found" };
  try {
    await state.session.setModel(model);
    state.session.sessionManager.appendCustomEntry(MODEL_OVERRIDE_ENTRY, { provider, modelId, at: (/* @__PURE__ */ new Date()).toISOString() });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: "rejected", message: error instanceof Error ? error.message : String(error) };
  }
}
function setSessionThinking(agentId, sessionId, level) {
  const state = stateOf(agentId).sessions.get(sessionId);
  if (state === void 0) return { ok: false };
  state.session.setThinkingLevel(level);
  state.session.sessionManager.appendCustomEntry(THINKING_OVERRIDE_ENTRY, { level, at: (/* @__PURE__ */ new Date()).toISOString() });
  return { ok: true, level: state.session.thinkingLevel };
}
function imageSizesOf(messages) {
  const sizes = [];
  for (const message of messages) {
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const part = block;
      if (part.type === "image" && typeof part.data === "string") {
        sizes.push(part.data.length);
        continue;
      }
      if (part.type === "text" && typeof part.text === "string") {
        for (const ref of parseImageRefs(part.text)) {
          const fileBytes = attachmentFileSizeCached(ref);
          if (fileBytes > 0) sizes.push(Math.ceil(fileBytes / 3) * 4);
        }
      }
    }
  }
  return sizes;
}
async function outcomeOfSessionFile(agentId, sessionId) {
  const found = await findSessionFile(agentId, sessionId);
  if (found === void 0) return void 0;
  const text = await readFile20(found.path, "utf8").catch(() => void 0);
  if (text === void 0) return void 0;
  let last;
  let lastFailureAt;
  let lastFailureKind;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
      const raw = entry.message;
      const content = Array.isArray(raw.content) ? raw.content : [];
      const hasContent = content.some((block) => {
        const b = block;
        return b.type === "text" ? (b.text ?? "").trim() !== "" : true;
      });
      last = {
        ...typeof raw.stopReason === "string" ? { stopReason: raw.stopReason } : {},
        ...typeof raw.errorMessage === "string" && raw.errorMessage.trim() !== "" ? { errorMessage: raw.errorMessage.trim() } : {},
        hasContent
      };
      if (raw.stopReason === "error") {
        const kind2 = classifyFailure(last);
        if (kind2 !== void 0 && kind2 !== "aborted" && typeof entry.timestamp === "string") {
          lastFailureAt = entry.timestamp;
          lastFailureKind = kind2;
        }
      }
    } catch {
    }
  }
  if (last === void 0) return void 0;
  const kind = classifyFailure(last);
  const outcome = kind === "aborted" ? void 0 : kind === void 0 ? { state: "done" } : { state: "error", failureKind: kind };
  return { ...outcome !== void 0 ? { outcome } : {}, ...lastFailureAt !== void 0 ? { lastFailureAt } : {}, ...lastFailureKind !== void 0 ? { lastFailureKind } : {} };
}
var viewsPruned = /* @__PURE__ */ new Set();
async function pruneSessionViewsOnce() {
  const home2 = resolveHome();
  if (viewsPruned.has(home2)) return;
  viewsPruned.add(home2);
  await sessionViewsReady();
  await sessionViewsOf().backfill((agentId, sessionId) => projectIdOfSession(agentId, sessionId)).catch(() => void 0);
  const filled = await sessionViewsOf().backfillOutcomes((agentId, sessionId) => outcomeOfSessionFile(agentId, sessionId)).catch(() => 0);
  if (filled > 0) void log.info("agent-host", "pruneSessionViewsOnce", "\u56DE\u586B\u65E7\u8BB0\u5F55\u7684\u7EC8\u6001", { details: { filled } });
  await sessionViewsOf().prune((agentId, sessionId) => sessionExists(agentId, sessionId)).catch(() => void 0);
}
async function deleteSession(agentId, sessionId) {
  const state = stateOf(agentId);
  if (isRunning(agentId, sessionId)) return "running";
  const found = await findSessionFile(agentId, sessionId);
  if (found === void 0 && !state.sessions.has(sessionId)) return "not_found";
  if (found !== void 0) await rm8(found.path, { force: true });
  void gcAttachments(resolveHome()).then((result) => {
    if (result.removed > 0) {
      void log.info("agent-host", "gcAttachments", "\u6E05\u7406\u5B64\u513F\u9644\u4EF6", {
        details: { removed: result.removed, removedBytes: result.removedBytes, kept: result.kept, scannedRefs: result.scannedRefs }
      });
    }
  }).catch(() => void 0);
  const slot = aggregateSlotOf(agentId, sessionId);
  const projectId = found !== void 0 ? projectOfSessionDir(found.dir) : void 0;
  sessionViewsOf().forget(agentId, sessionId);
  state.sessions.delete(sessionId);
  state.pending.delete(sessionId);
  rowPatches().pushNow(agentId, sessionId, projectId, { removed: true, ...slot !== void 0 ? { was: slot } : {} });
  return "deleted";
}
async function renameSession(agentId, sessionId, name, cwd) {
  const loaded = stateOf(agentId).sessions.get(sessionId);
  if (loaded !== void 0) {
    loaded.session.sessionManager.appendSessionInfo(name);
    pushTitlePatch(agentId, sessionId, projectOfSessionDir(loaded.session.sessionManager.getSessionDir()), name);
    return true;
  }
  const found = await findSessionFile(agentId, sessionId);
  if (found === void 0) return false;
  SessionManager.open(found.path, found.dir, cwd).appendSessionInfo(name);
  pushTitlePatch(agentId, sessionId, projectOfSessionDir(found.dir), name);
  return true;
}
function pushTitlePatch(agentId, sessionId, projectId, raw) {
  rowPatches().pushNow(agentId, sessionId, projectId, {
    title: { raw, display: displayTitleOf(raw) }
  });
}
function sessionImageBytesOf(state) {
  let total = 0;
  for (const message of state.session.sessionManager.buildSessionProjection().messages) {
    if (message.role !== "user") continue;
    for (const part of Array.isArray(message.content) ? message.content : []) {
      const image = part;
      if (image.type === "image" && typeof image.data === "string") {
        const padding = image.data.endsWith("==") ? 2 : image.data.endsWith("=") ? 1 : 0;
        total += Math.max(0, Math.floor(image.data.length * 3 / 4) - padding);
        continue;
      }
      if (image.type === "text" && typeof image.text === "string") {
        for (const ref of parseImageRefs(image.text)) total += attachmentFileSizeCached(ref);
      }
    }
  }
  return total;
}
function messagesOf(state, options = {}) {
  const out = [];
  const projection = state.session.sessionManager.buildSessionProjection();
  let pendingSpeaker;
  const items = projection.entries.flatMap((entry, entryIndex) => {
    const source = entry.sourceEntry;
    if (source.type === "custom" && source.customType === TURN_ORIGIN_ENTRY) {
      const parsed2 = parseOrigin(source.data);
      pendingSpeaker = parsed2;
      return [];
    }
    const raw = entry.sourceEntry.timestamp;
    const parsed = typeof raw === "string" ? Date.parse(raw) : Number.NaN;
    const at = Number.isNaN(parsed) ? void 0 : parsed;
    const rawId = entry.sourceEntry.id;
    let id = typeof rawId === "string" && rawId !== "" ? rawId : "";
    if (id === "") {
      id = `entry-${entryIndex}`;
      void log.warn("agent-host", "messagesOf", "session entry \u7F3A\u5C11 id\uFF0C\u5DF2\u964D\u7EA7\u4E3A\u5360\u4F4D", { details: { entryIndex } });
    }
    return entry.messages.map((message) => {
      const speaker = message.role === "user" && pendingSpeaker !== void 0 ? pendingSpeaker : void 0;
      if (speaker !== void 0) pendingSpeaker = void 0;
      return { message, at, id, speaker };
    });
  });
  for (const { message, at, id, speaker } of items) {
    if (message.role === "compactionSummary") {
      const summaryMessage = message;
      out.push({
        role: "assistant",
        text: "",
        id,
        blocks: [{
          type: "compaction",
          summary: typeof summaryMessage.summary === "string" ? summaryMessage.summary : "",
          tokensBefore: typeof summaryMessage.tokensBefore === "number" ? summaryMessage.tokensBefore : 0
        }],
        ...at !== void 0 ? { at } : {}
      });
    } else if (message.role === "user") {
      const text = textOf(message);
      const blocks = [];
      if (text !== "") blocks.push({ type: "text", text });
      for (const part of Array.isArray(message.content) ? message.content : []) {
        const image = part;
        if (image.type === "image" && typeof image.data === "string" && typeof image.mimeType === "string") {
          blocks.push({ type: "image", data: image.data, mimeType: image.mimeType });
        }
      }
      for (const refBlock of imageRefBlocksOf(message)) blocks.push(refBlock);
      out.push({
        role: "user",
        text,
        blocks,
        id,
        ...at !== void 0 ? { at } : {},
        // 老会话（本任务之前产生）没有 origin：回落成用户，不猜（Task 0014 · 完成标准 11）
        speaker: speaker ?? USER_ORIGIN
      });
    } else if (message.role === "assistant") {
      const blocks = [];
      for (const part of message.content) {
        if (part.type === "text") blocks.push({ type: "text", text: part.text });
        else if (part.type === "thinking") {
          blocks.push(options.deferThinking === true && part.thinking.trim() !== "" ? { type: "thinking", text: "", deferred: true } : { type: "thinking", text: part.thinking });
        } else if (part.type === "toolCall") blocks.push({ type: "toolCall", id: part.id, name: part.name, arguments: part.arguments });
      }
      const text = blocks.flatMap((block) => block.type === "text" ? [block.text] : []).join("");
      const raw = message;
      const errorText = typeof raw.errorMessage === "string" && raw.errorMessage.trim() !== "" ? raw.errorMessage.trim() : void 0;
      const kind = classifyFailure({ ...raw.stopReason !== void 0 ? { stopReason: raw.stopReason } : {}, ...errorText !== void 0 ? { errorMessage: errorText } : {}, hasContent: blocks.length > 0 || text.trim() !== "" });
      const durationMs = typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs) && raw.durationMs > 0 ? Math.round(raw.durationMs) : void 0;
      const input = typeof raw.usage?.input === "number" ? raw.usage.input : 0;
      const output = typeof raw.usage?.output === "number" ? raw.usage.output : 0;
      const tokens = input + output > 0 ? input + output : void 0;
      out.push({
        role: "assistant",
        text,
        blocks,
        id,
        ...at !== void 0 ? { at } : {},
        ...kind !== void 0 ? { failure: kind } : {},
        ...errorText !== void 0 ? { error: errorText } : {},
        ...durationMs !== void 0 ? { durationMs } : {},
        ...tokens !== void 0 ? { tokens } : {},
        ...typeof raw.stopReason === "string" && raw.stopReason !== "" ? { stopReason: raw.stopReason } : {}
      });
    } else if (message.role === "toolResult") {
      const result = textOf(message);
      const callId = message.toolCallId;
      if (callId === void 0) continue;
      for (let i = out.length - 1; i >= 0; i--) {
        const item = out[i];
        if (item === void 0 || item.role !== "assistant") continue;
        const call = item.blocks.find((block) => block.type === "toolCall" && block.id === callId);
        if (call === void 0) continue;
        call.result = result;
        call.isError = message.isError;
        const resultAt = message.timestamp;
        if (typeof resultAt === "number" && Number.isFinite(resultAt) && resultAt > 0) call.resultAt = resultAt;
        const images = toolResultImageRefs(message, call.result);
        if (images.length > 0) call.images = images;
        const details = message.details;
        if (typeof details === "object" && details !== null) {
          const sessionId = details.sessionId;
          if (typeof sessionId === "string" && sessionId !== "") call.peerSessionId = sessionId;
        }
        break;
      }
    }
  }
  if (state.session.isStreaming) {
    const last = out[out.length - 1];
    if (last !== void 0 && last.role === "assistant") last.streaming = true;
  }
  return out;
}
function textOf(message) {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => part.type === "text" ? [part.text ?? ""] : []).join("");
}

// src/event-socket.ts
init_logging();
var HIGH_WATER_BYTES = 512 * 1024;
var PING_MS = 1e4;
var WRITE_TIMEOUT_MS = 1e4;
var CLOSE_OVERLOAD = 1013;
var CLOSE_GOING_AWAY = 1001;
function attachEventSocket(server2, options = {}) {
  const pingMs = options.pingMs ?? PING_MS;
  const highWaterBytes = options.highWaterBytes ?? HIGH_WATER_BYTES;
  const snapshotGate = options.snapshotGate;
  const wss = new WebSocketServer({ noServer: true });
  const onUpgrade = (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/api/events") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      void serve(ws, { pingMs, highWaterBytes, snapshotGate }).catch((error) => {
        log.warn("event-socket", "serve", "ws \u8FDE\u63A5\u5F02\u5E38\u7ED3\u675F", { details: { reason: error instanceof Error ? error.message : String(error) } });
      });
    });
  };
  server2.on("upgrade", onUpgrade);
  return {
    close() {
      server2.off("upgrade", onUpgrade);
      wss.close();
    }
  };
}
async function serve(ws, options) {
  const { pingMs, highWaterBytes, snapshotGate } = options;
  await pruneSessionViewsOnce();
  const connectionId = randomUUID2();
  let finished = () => void 0;
  const finishedPromise = new Promise((resolve10) => {
    finished = resolve10;
  });
  const sink = createBoundedSink({
    write: (event) => writeFrame(ws, { t: event.type, seq: event.seq, d: event }),
    limitBytes: highWaterBytes
  });
  const bus = subscribeBus({
    id: connectionId,
    offer: (event) => sink.offer(event),
    // 过载：关闭连接让客户端重连（**绝不静默丢事件**，`specs/code/backend/code.md` 2.12）
    overflowed: () => {
      try {
        ws.close(CLOSE_OVERLOAD, "overload");
      } catch {
      }
      finished();
    }
  });
  const snapshot2 = { connectionId, seq: bus.seq, ...globalSnapshot() };
  const ping = setInterval(() => {
    void writeFrame(ws, { t: "ping", seq: eventsSeq(), d: {} }).catch(() => finished());
  }, pingMs);
  ws.on("close", () => finished());
  ws.on("error", () => finished());
  ws.on("message", () => void 0);
  try {
    if (snapshotGate !== void 0) await snapshotGate();
    await writeFrame(ws, { t: "snapshot", seq: bus.seq, d: snapshot2 }).catch(() => void 0);
    if (ws.readyState === ws.OPEN) {
      bus.ready();
      log.info("event-socket", void 0, "ws \u4E8B\u4EF6\u901A\u9053\u5DF2\u8FDE\u63A5", { details: { connectionId } });
    }
    await finishedPromise;
  } finally {
    clearInterval(ping);
    bus.close();
    sink.close();
    try {
      ws.close(CLOSE_GOING_AWAY);
    } catch {
    }
  }
}
function writeFrame(ws, frame) {
  return new Promise((resolve10, reject) => {
    if (ws.readyState !== ws.OPEN) {
      reject(new Error("closed"));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("write-timeout"));
    }, WRITE_TIMEOUT_MS);
    ws.send(JSON.stringify(frame), (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error !== void 0 && error !== null) reject(error);
      else resolve10();
    });
  });
}

// src/http-proxy.ts
var PROXY_ENV_KEYS = ["https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY", "all_proxy", "ALL_PROXY"];
function proxyUrlOf(env = process.env) {
  for (const key of PROXY_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value !== void 0 && value !== "") return value;
  }
  return void 0;
}
async function installProxyIfConfigured(env = process.env) {
  const proxy = proxyUrlOf(env);
  if (proxy === void 0) return { installed: false, reason: "no-proxy-env" };
  if (installedWith === proxy) return { installed: true, proxy };
  const undici = await import("undici");
  const pick = (...keys) => {
    for (const key of keys) {
      const value = env[key]?.trim();
      if (value !== void 0 && value !== "") return value;
    }
    return void 0;
  };
  const httpProxy = pick("http_proxy", "HTTP_PROXY", "all_proxy", "ALL_PROXY");
  const httpsProxy = pick("https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY");
  const noProxy = pick("no_proxy", "NO_PROXY");
  undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent({
    ...httpProxy !== void 0 ? { httpProxy } : {},
    ...httpsProxy !== void 0 ? { httpsProxy } : {},
    ...noProxy !== void 0 ? { noProxy } : {}
  }));
  undici.install?.();
  installedWith = proxy;
  return { installed: true, proxy };
}
var installedWith;

// src/main.ts
init_home();

// src/server.ts
init_atomic_file();
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { mkdir as mkdir17, readFile as readFile26, readdir as readdir19, stat as stat18 } from "node:fs/promises";

// src/session-rows.ts
init_home();
import { readdir as readdir15, readFile as readFile21, stat as stat14 } from "node:fs/promises";
import { join as join25 } from "node:path";
var emptyCounts = () => ({ user: 0, assistant: 0, toolResult: 0, system: 0, total: 0 });
function textOfContent2(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => part.type === "text" ? [part.text ?? ""] : []).join("");
}
var scanCache = /* @__PURE__ */ new Map();
async function scanSessionFile(path) {
  const info = await stat14(path).catch(() => void 0);
  const fingerprint = info === void 0 ? void 0 : `${info.size}:${info.mtimeMs}`;
  if (fingerprint !== void 0) {
    const cached = scanCache.get(path);
    if (cached !== void 0 && cached.fingerprint === fingerprint) return cached.value;
  }
  const content = await readFile21(path, "utf8").catch(() => void 0);
  if (content === void 0) {
    scanCache.delete(path);
    return void 0;
  }
  const lines = content.split("\n").filter((line) => line.trim() !== "");
  let sessionId = "";
  let displayName = "";
  let firstUserText = "";
  let activeTaskId;
  let peerAgentId;
  let createdAt;
  let firstMessageAt;
  let lastMessageAt;
  const counts = emptyCounts();
  let failing;
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === "session" && typeof entry.id === "string") {
      sessionId = entry.id;
      if (typeof entry.timestamp === "string") createdAt = entry.timestamp;
      continue;
    }
    if (entry.type === "session_info" && typeof entry.name === "string" && entry.name.trim() !== "") {
      displayName = entry.name;
      continue;
    }
    if (entry.type === "custom") {
      if (entry.customType === "lifeos_active_task" && typeof entry.data?.taskId === "string") activeTaskId = entry.data.taskId;
      if (entry.customType === PEER_ENTRY && typeof entry.data?.peerAgentId === "string") peerAgentId = entry.data.peerAgentId;
      continue;
    }
    if (entry.type !== "message") continue;
    const role = entry.message?.role;
    if (role === "user") counts.user += 1;
    else if (role === "assistant") counts.assistant += 1;
    else if (role === "toolResult") counts.toolResult += 1;
    else if (role === "system") counts.system += 1;
    counts.total += 1;
    const at = typeof entry.timestamp === "string" ? entry.timestamp : void 0;
    if (at !== void 0) {
      firstMessageAt ??= at;
      if (role === "user" || role === "assistant") lastMessageAt = at;
    }
    if (role === "user" && firstUserText === "") firstUserText = textOfContent2(entry.message?.content);
    if (role === "assistant") {
      const stopReason = entry.message?.stopReason;
      const errorMessage = typeof entry.message?.errorMessage === "string" ? entry.message.errorMessage.trim() : "";
      if (stopReason === "error") {
        const kind = classifyFailure({ stopReason: "error", ...errorMessage !== "" ? { errorMessage } : {}, hasContent: false }) ?? "unknown";
        failing = { kind, detail: errorMessage, ...at !== void 0 ? { at } : {} };
      } else {
        failing = void 0;
      }
    } else if (role === "user") {
      failing = void 0;
    }
  }
  if (sessionId === "") return void 0;
  const scanned = {
    sessionId,
    rawTitle: displayName !== "" ? displayName : firstUserText,
    counts,
    ...createdAt !== void 0 ? { createdAt } : {},
    ...firstMessageAt !== void 0 ? { firstMessageAt } : {},
    ...lastMessageAt !== void 0 ? { lastMessageAt } : {},
    fileModifiedAt: (info?.mtime ?? /* @__PURE__ */ new Date(0)).toISOString(),
    ...activeTaskId !== void 0 ? { activeTaskId } : {},
    ...peerAgentId !== void 0 ? { peerAgentId } : {},
    ...failing !== void 0 ? { failure: failing } : {}
  };
  if (fingerprint !== void 0) scanCache.set(path, { fingerprint, value: scanned });
  return scanned;
}
async function taskIndexOf(agentId, projectId) {
  const tasks = await listTasks({ agentId, projectId }).catch(() => []);
  const map = /* @__PURE__ */ new Map();
  for (const task of tasks) map.set(task.id, { id: task.id, title: task.title, status: task.status, type: task.type });
  return map;
}
async function projectOf(projectId) {
  const manifest = await readGlobalProject(projectId).catch(() => void 0);
  if (manifest === void 0) return void 0;
  const fallback = (manifest.path ?? "").split(/[\\/]/).filter((part) => part !== "").at(-1) ?? manifest.id;
  const name = manifest.name.trim() !== "" ? manifest.name : fallback;
  const icon = manifest.icon;
  return {
    id: manifest.id,
    name,
    ...typeof icon === "string" && icon.trim() !== "" ? { icon: icon.trim() } : {}
  };
}
async function peerOf(peerAgentId, cache) {
  const cached = cache.get(peerAgentId);
  if (cached !== void 0) return cached;
  const def = await readAgent(peerAgentId).catch(() => void 0);
  const avatar = def?.avatar;
  const peer = {
    kind: "agent",
    id: peerAgentId,
    name: def?.name ?? peerAgentId,
    // 对端被删/归档：有 id 就是信息，不编名字
    ...avatar !== void 0 ? { avatar } : {}
  };
  cache.set(peerAgentId, peer);
  return peer;
}
async function scanProject(agentId, projectId) {
  const dir = join25(resolveHome(), "agents", agentId, "projects", projectId, "sessions");
  const names = await readdir15(dir).catch(() => []);
  const scanned = (await Promise.all(
    names.filter((name) => name.endsWith(".jsonl")).map((name) => scanSessionFile(join25(dir, name)))
  )).filter((item) => item !== void 0);
  const fileIds = new Set(scanned.map((item) => item.sessionId));
  for (const pending2 of pendingSessions(agentId)) {
    if (pending2.projectId !== projectId || fileIds.has(pending2.sessionId)) continue;
    if (pending2.name === void 0 || pending2.name === "") continue;
    const pendingCounts = pending2.counts;
    scanned.push({
      sessionId: pending2.sessionId,
      rawTitle: pending2.name,
      counts: pendingCounts !== void 0 ? { ...pendingCounts, total: pendingCounts.user + pendingCounts.assistant + pendingCounts.toolResult + pendingCounts.system } : emptyCounts(),
      createdAt: pending2.at,
      fileModifiedAt: pending2.at,
      ...pending2.taskId !== void 0 ? { activeTaskId: pending2.taskId } : {}
    });
  }
  return scanned;
}
async function sessionRowsOf(agentId, projectId, options = {}) {
  const now = options.now ?? Date.now();
  const project = await projectOf(projectId);
  const tasks = await taskIndexOf(agentId, projectId);
  const running2 = new Map(runningOf(agentId).map((entry) => [entry.sessionId, entry]));
  const unread = new Map(
    // 未读带 `state`：失败与成功分别判断（Task 0005 · 2026-11-04）。
    // 绝不能只用 `completedAt` —— 一个会话可能失败多次后成功，那样失败会被成功覆盖。
    sessionViewsOf().unread().map((item) => [`${item.agentId}\0${item.sessionId}`, item])
  );
  const peerCache = /* @__PURE__ */ new Map();
  const scanned = await scanProject(agentId, projectId);
  const fileIds = new Set(scanned.map((item) => item.sessionId));
  for (const pending2 of pendingSessions(agentId)) {
    if (pending2.projectId !== projectId || fileIds.has(pending2.sessionId)) continue;
    if (pending2.name === void 0 || pending2.name === "") continue;
    const pendingCounts = pending2.counts;
    scanned.push({
      sessionId: pending2.sessionId,
      rawTitle: pending2.name,
      counts: pendingCounts !== void 0 ? { ...pendingCounts, total: pendingCounts.user + pendingCounts.assistant + pendingCounts.toolResult + pendingCounts.system } : emptyCounts(),
      createdAt: pending2.at,
      fileModifiedAt: pending2.at,
      ...pending2.taskId !== void 0 ? { activeTaskId: pending2.taskId } : {}
    });
  }
  if (project === void 0) return [];
  const rows = [];
  for (const item of scanned) {
    const runningEntry = running2.get(item.sessionId);
    const unreadItem = unread.get(`${agentId}\0${item.sessionId}`);
    rows.push({
      sessionId: item.sessionId,
      title: { raw: item.rawTitle, display: displayTitleOf(item.rawTitle) },
      project,
      task: item.activeTaskId !== void 0 ? tasks.get(item.activeTaskId) ?? null : null,
      peer: item.peerAgentId !== void 0 ? await peerOf(item.peerAgentId, peerCache) : null,
      counts: item.counts,
      time: {
        createdAt: item.createdAt ?? item.fileModifiedAt,
        ...item.firstMessageAt !== void 0 ? { firstMessageAt: item.firstMessageAt } : {},
        ...item.lastMessageAt !== void 0 ? { lastMessageAt: item.lastMessageAt } : {},
        lastActivityAt: item.lastMessageAt ?? item.createdAt ?? item.fileModifiedAt,
        fileModifiedAt: item.fileModifiedAt
      },
      activity: rowActivityOf({
        ...runningEntry !== void 0 ? { runningSince: runningEntry.startedAt } : {},
        ...unreadItem !== void 0 ? { unreadSince: unreadItem.completedAt } : {},
        // 失败：**索引优先**。索引里"有未看的失败"时，即使会话文件最后一条是成功（`item.failure` 为空），
        // 也要显示红点 —— 否则数字说有一条失败、行上却没有，用户会找不到它。
        ...item.failure !== void 0 ? { failure: { kind: item.failure.kind, detail: item.failure.detail, ...item.failure.at !== void 0 ? { at: item.failure.at } : {} } } : unreadItem?.state === "error" ? { failure: { kind: unreadItem.failureKind ?? "unknown", detail: unreadItem.failureDetail ?? "" } } : {},
        now
      }),
      isDefault: item.sessionId === options.defaultSessionId
    });
  }
  return rows.sort((a, b) => a.time.lastActivityAt < b.time.lastActivityAt ? 1 : -1);
}
async function sessionsByTask(agentId, projectId) {
  const scanned = await scanProject(agentId, projectId);
  const runningSet = new Set(runningOf(agentId).map((entry) => entry.sessionId));
  const grouped = /* @__PURE__ */ new Map();
  for (const item of scanned) {
    if (item.activeTaskId === void 0) continue;
    const list = grouped.get(item.activeTaskId) ?? [];
    list.push({
      sessionId: item.sessionId,
      ...item.rawTitle !== "" ? { title: item.rawTitle } : {},
      lastActivityAt: item.lastMessageAt ?? item.createdAt ?? item.fileModifiedAt,
      running: runningSet.has(item.sessionId)
    });
    grouped.set(item.activeTaskId, list);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.lastActivityAt < b.lastActivityAt ? 1 : -1);
  }
  return grouped;
}

// src/server.ts
import { basename as basename8, join as join32 } from "node:path";

// src/review-viewed.ts
init_atomic_file();
init_home();
import { createHash as createHash4 } from "node:crypto";
import { mkdir as mkdir15, readFile as readFile22, rm as rm9, writeFile as writeFile18 } from "node:fs/promises";
import { join as join26 } from "node:path";
var VIEWED_SCHEMA_VERSION = 1;
var VIEWED_DIR = join26("state", "review-viewed");
var MAX_VIEWED_PER_TASK = 500;
var VIEWED_NOTE = `# review-viewed \xB7 \u68C0\u89C6\u300C\u5DF2\u770B\u300D\u8FDB\u5EA6

- \u80CC\u666F\uFF1A\u68C0\u89C6\u6A21\u5F0F\u91CC\u7528\u6237\u5BF9\u6BCF\u4E2A\u6587\u4EF6\u70B9\u300C\u5DF2\u770B\u300D\uFF08GitHub Files changed / difit \u540C\u6B3E\u5FC3\u667A\uFF09\u3002
- \u5185\u5BB9\uFF1A<slug>.json\uFF0C\u6BCF\u884C\u4E00\u4E2A Task\u3002\u7ED3\u6784 \`{ version, taskId, records: [{ path, viewedAt, hash }] }\`\u3002
- \u5173\u952E\uFF1A\u8BB0\u5F55\u5E26 diff **\u5185\u5BB9\u54C8\u5E0C**\u2014\u2014\u6587\u4EF6\u6539\u4E86\u4E4B\u540E\u72B6\u6001\u81EA\u52A8\u53D8\u6210"\u53D8\u4E86\uFF0C\u9700\u8981\u91CD\u770B"\uFF0C\u4E0D\u4F1A\u9A97\u4EBA\u3002
- \u4F55\u65F6\u8BFB\uFF1A\u6392\u67E5"\u5DF2\u770B\u8FDB\u5EA6\u4E3A\u4EC0\u4E48\u4E0D\u663E\u793A / \u4E3A\u4EC0\u4E48\u6587\u4EF6\u6539\u4E86\u8FD8\u663E\u793A\u5DF2\u770B"\u3002
- \u600E\u4E48\u7528\uFF1A\u4E0D\u8981\u624B\u6539\uFF08\u539F\u5B50\u66FF\u6362\uFF0C\u624B\u6539\u4F1A\u88AB\u8986\u76D6\uFF09\uFF1B\u5220\u6389\u67D0\u4E2A\u6587\u4EF6 = \u6E05\u7A7A\u8BE5 Task \u7684\u8FDB\u5EA6\u3002\u4E0D\u5165\u5E93\u3002
`;
var isString2 = (v) => typeof v === "string";
function viewedSlugOf(taskDir) {
  const base = taskDir.replace(/\/+$/, "").split("/").pop() ?? "task";
  const readable = base.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const hash = createHash4("sha1").update(taskDir).digest("hex").slice(0, 8);
  return `${readable === "" ? "task" : readable}-${hash}`.slice(0, 64);
}
function viewedFileOf(taskDir) {
  return join26(resolveHome(), VIEWED_DIR, `${viewedSlugOf(taskDir)}.json`);
}
function toViewedRecord(raw) {
  if (typeof raw !== "object" || raw === null) return void 0;
  const r = raw;
  if (!isString2(r.path) || r.path === "") return void 0;
  if (!isString2(r.hash) || r.hash === "") return void 0;
  const viewedAt = isString2(r.viewedAt) && r.viewedAt !== "" ? r.viewedAt : (/* @__PURE__ */ new Date()).toISOString();
  return { path: r.path, viewedAt, hash: r.hash };
}
async function readViewed(taskDir) {
  let text;
  try {
    text = await readFile22(viewedFileOf(taskDir), "utf8");
  } catch {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const shape = parsed;
  if (shape.version !== VIEWED_SCHEMA_VERSION || !Array.isArray(shape.records)) return [];
  return shape.records.map(toViewedRecord).filter((record) => record !== void 0);
}
var chains2 = /* @__PURE__ */ new Map();
function serialize2(key, work) {
  const prev = chains2.get(key) ?? Promise.resolve();
  const next = prev.then(work, work).catch(() => void 0);
  chains2.set(key, next);
  return next;
}
async function writeViewed(taskDir, taskId, records) {
  const valid = records.map(toViewedRecord).filter((record) => record !== void 0);
  const trimmed = valid.length <= MAX_VIEWED_PER_TASK ? valid : [...valid].sort((a, b) => a.viewedAt.localeCompare(b.viewedAt)).slice(valid.length - MAX_VIEWED_PER_TASK);
  const file = viewedFileOf(taskDir);
  const dir = join26(file, "..");
  const body = { version: VIEWED_SCHEMA_VERSION, taskId, records: trimmed };
  await serialize2(file, async () => {
    await mkdir15(dir, { recursive: true, mode: 448 });
    await writeTextAtomic(file, JSON.stringify(body, null, 2) + "\n");
    await writeFile18(join26(dir, "AGENTS.md"), VIEWED_NOTE, { flag: "wx", mode: 384 }).catch(() => void 0);
  });
}
async function setFileViewed(taskDir, taskId, path, hash, viewed, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const all = await readViewed(taskDir);
  const rest = all.filter((record) => record.path !== path);
  const next = viewed ? [...rest, { path, hash, viewedAt: now }] : rest;
  await writeViewed(taskDir, taskId, next);
  return next;
}
async function setFilesViewed(taskDir, taskId, entries, viewed, now = (/* @__PURE__ */ new Date()).toISOString()) {
  const all = await readViewed(taskDir);
  const touched = new Set(entries.map((entry) => entry.path));
  const rest = all.filter((record) => !touched.has(record.path));
  const next = viewed ? [...rest, ...entries.map((entry) => ({ path: entry.path, hash: entry.hash, viewedAt: now }))] : rest;
  await writeViewed(taskDir, taskId, next);
  return next;
}
async function clearViewed(taskDir) {
  await rm9(viewedFileOf(taskDir), { force: true });
}

// src/review-candidates.ts
import { readdir as readdir16 } from "node:fs/promises";
import { dirname as dirname5, join as join27, relative as relative2, sep as sep5 } from "node:path";
init_home();
import { stat as stat15 } from "node:fs/promises";
import { execFile as execFile5 } from "node:child_process";
import { promisify as promisify5 } from "node:util";
var run5 = promisify5(execFile5);
var CANDIDATE_CONCURRENCY = 16;
var git5 = async (cwd, args) => {
  try {
    const { stdout } = await run5("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], {
      timeout: 15e3,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, LC_ALL: "C" }
    });
    return stdout;
  } catch {
    return "";
  }
};
var isDir = async (path) => {
  try {
    return (await stat15(path)).isDirectory();
  } catch {
    return false;
  }
};
var hasGitMarker = async (path) => {
  try {
    const info = await stat15(path);
    return info.isDirectory() || info.isFile();
  } catch {
    return false;
  }
};
async function findWorktree(taskDir) {
  for (const convention of [join27(taskDir, "repo"), join27(taskDir, "evidence", "worktree")]) {
    if (await isDir(convention)) return convention;
  }
  const entries = await readdir16(taskDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "home" || entry.name === "repo" || entry.name === "evidence") continue;
    const candidate = join27(taskDir, entry.name);
    if (await hasGitMarker(join27(candidate, ".git"))) return candidate;
  }
  return void 0;
}
var homeWorktreeOf = (taskDir) => join27(taskDir, "home");
async function worktreeChanged(worktree) {
  const dirty = await git5(worktree, ["status", "--porcelain", "-uall"]);
  if (dirty.trim() !== "") return true;
  for (const base of ["main", "master"]) {
    const mergeBase = (await git5(worktree, ["merge-base", base, "HEAD"])).trim();
    if (mergeBase === "") continue;
    const ahead = (await git5(worktree, ["rev-list", "-n", "1", `${mergeBase}..HEAD`])).trim();
    if (ahead !== "") return true;
  }
  return false;
}
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (; ; ) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      out[index] = await worker(items[index]);
    }
  });
  await Promise.all(lanes);
  return out;
}
async function docChangesByTask() {
  const home2 = resolveHome();
  const raw = await git5(home2, ["status", "--porcelain", "-z", "-uall"]);
  const out = /* @__PURE__ */ new Map();
  const parts = raw.split("\0");
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    if (entry === void 0 || entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    if (xy.includes("R") || xy.includes("C")) i += 1;
    const match = /^agents\/([^/]+)\/projects\/([^/]+)\/tasks\/(\d{4})-(.+?)\//.exec(path);
    if (match === null) continue;
    const key = `${match[1]}/${match[2]}/${match[3]}`;
    const afterTask = path.slice(`agents/${match[1]}/projects/${match[2]}/tasks/${match[3]}-${match[4]}/`.length);
    const isDaily = afterTask.startsWith("daily/");
    const current = out.get(key);
    if (current === void 0) {
      out.set(key, { count: 1, onlyDaily: isDaily });
    } else {
      current.count += 1;
      current.onlyDaily = current.onlyDaily && isDaily;
    }
  }
  return out;
}
async function listCandidates(agentId, projectId) {
  const startedAt = Date.now();
  const tasks = await listTasks({ agentId, projectId });
  const docs = await docChangesByTask();
  const items = await mapLimit(tasks, CANDIDATE_CONCURRENCY, async (task) => {
    const worktree = await findWorktree(task.path);
    const changed = worktree === void 0 ? false : await worktreeChanged(worktree);
    const homeWorktree = homeWorktreeOf(task.path);
    const homeDirty = await isDir(homeWorktree) ? (await git5(homeWorktree, ["status", "--porcelain", "-uall"])).trim().split("\n").filter((line) => line !== "").length : 0;
    const docInfo = docs.get(`${agentId}/${projectId}/${task.id}`);
    const docChangedFiles = Math.max(docInfo?.count ?? 0, homeDirty);
    const docOnlyDaily = docInfo?.onlyDaily === true && homeDirty === 0;
    const comments = await readComments(task.path);
    let available;
    if (comments.length > 0) {
      available = /* @__PURE__ */ new Set();
      try {
        const diff = await computeReviewDiff(task.path);
        for (const group of diff.items ?? []) {
          const kind = group.source.kind;
          for (const file of group.files) available.add(`${kind}\0${file.path}`);
        }
      } catch {
      }
    }
    const countable = available !== void 0 ? comments.filter((c) => isCountable(c, available)) : comments;
    return {
      taskId: task.id,
      dirName: task.dirName,
      title: task.title,
      type: task.type,
      status: task.status,
      taskDir: task.path,
      hasWorktree: worktree !== void 0,
      worktreeChanged: changed,
      docChangedFiles,
      docOnlyDaily,
      substantive: changed || docChangedFiles > 0 && !docOnlyDaily,
      commentsTotal: countable.length,
      openComments: countable.filter((comment) => comment.state !== "resolved").length,
      pendingForUser: pendingFor(countable, "user", available).length
    };
  });
  const ranked = [...items].sort((a, b) => {
    const rank = (item) => item.substantive ? 0 : item.docChangedFiles > 0 ? 1 : 2;
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return Number(b.taskId) - Number(a.taskId);
  });
  return { items: ranked, elapsedMs: Date.now() - startedAt, truncated: false };
}

// src/task-merge.ts
import { execFile as execFile6 } from "node:child_process";
import { promises as fs } from "node:fs";
import { join as join28 } from "node:path";
import { promisify as promisify6 } from "node:util";
var run6 = promisify6(execFile6);
async function git6(cwd, args) {
  const { stdout } = await run6("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], {
    timeout: 12e4,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" }
  });
  return stdout;
}
async function isDir2(path) {
  const info = await fs.stat(path).catch(() => void 0);
  return info?.isDirectory() === true;
}
async function repoOf(worktree) {
  try {
    const common = (await git6(worktree, ["rev-parse", "--git-common-dir"])).trim();
    const abs = common.startsWith("/") ? common : join28(worktree, common);
    return join28(abs, "..");
  } catch {
    return void 0;
  }
}
async function mergeWorktree(kind, worktree) {
  const repo = await repoOf(worktree);
  if (repo === void 0) return { kind, worktree, status: "failed", message: "\u8BFB\u4E0D\u5230\u8FD9\u4E2A\u5DE5\u4F5C\u533A\u6240\u5C5E\u7684\u4ED3" };
  const branch = (await git6(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")).trim();
  if (branch === "" || branch === "HEAD") return { kind, worktree, status: "failed", message: "\u5DE5\u4F5C\u533A\u6CA1\u6709\u5206\u652F\uFF08detached HEAD\uFF09\uFF0C\u4E0D\u77E5\u9053\u8BE5\u5408\u4EC0\u4E48" };
  const worktreeDirty = (await git6(worktree, ["status", "--porcelain"]).catch(() => "")).trim();
  if (worktreeDirty !== "") {
    await git6(worktree, ["add", "-A"]);
    await git6(worktree, [
      "-c",
      "user.name=Life OS",
      "-c",
      "user.email=lifeos@localhost",
      "commit",
      "-q",
      "-m",
      "chore: \u5408\u5165\u524D\u5B58\u6863\uFF08\u81EA\u52A8\uFF09"
    ]);
  }
  const dirty = (await git6(repo, ["status", "--porcelain"]).catch(() => "")).trim();
  if (dirty !== "") {
    return { kind, worktree, branch, status: "dirty", message: "\u4E3B\u533A\u6709\u672A\u63D0\u4EA4\u7684\u6539\u52A8\uFF0C\u5148\u5904\u7406\u518D\u5408\u5E76\uFF08git \u4F1A\u62D2\u7EDD\uFF0C\u786C\u5408\u4F1A\u628A\u5B83\u4EEC\u5377\u8FDB\u53BB\uFF09" };
  }
  try {
    await git6(repo, ["merge", "--no-ff", "--no-edit", branch]);
  } catch (error) {
    const conflicts = (await git6(repo, ["diff", "--name-only", "--diff-filter=U"]).catch(() => "")).split("\n").map((line) => line.trim()).filter((line) => line !== "");
    await git6(repo, ["merge", "--abort"]).catch(() => void 0);
    const detail = error instanceof Error ? error.message.split("\n")[0] ?? "" : String(error);
    return {
      kind,
      worktree,
      branch,
      status: conflicts.length > 0 ? "conflict" : "failed",
      message: conflicts.length > 0 ? `\u5408\u5E76\u4E0D\u6210\u529F\uFF1A${conflicts.length} \u4E2A\u6587\u4EF6\u51B2\u7A81\uFF0C\u5DF2\u56DE\u6EDA\uFF08\u4ED3\u6062\u590D\u539F\u6837\uFF09\uFF1B\u8BF7\u4EBA\u5DE5\u89E3\u51B2\u7A81\u540E\u518D\u5408\u5E76` : `\u5408\u5E76\u4E0D\u6210\u529F\uFF1A${detail.slice(0, 200)}`,
      ...conflicts.length > 0 ? { conflicts } : {}
    };
  }
  await removeWorktree(repo, worktree);
  return { kind, worktree, branch, status: "merged", message: "\u5DF2\u5408\u5165 main \u5E76\u5220\u9664\u5DE5\u4F5C\u533A" };
}
async function mergeTask(taskDir) {
  const steps = [];
  const home2 = join28(taskDir, HOME_DIR);
  const project = join28(taskDir, REPO_DIR);
  if (await isDir2(project)) steps.push(await mergeWorktree("project", project));
  else steps.push({ kind: "project", status: "skipped", message: "\u8FD9\u4E2A Task \u6CA1\u6709\u9879\u76EE\u5DE5\u4F5C\u533A\uFF08repo/\uFF09" });
  if (await isDir2(home2)) steps.push(await mergeWorktree("home", home2));
  else steps.push({ kind: "home", status: "skipped", message: "\u8FD9\u4E2A Task \u6CA1\u6709\u5BB6\u76EE\u5F55\u5DE5\u4F5C\u533A\uFF08home/\uFF09" });
  const ok = steps.every((step) => step.status === "merged" || step.status === "skipped");
  resetWriteGuardCaches();
  return { ok, steps };
}

// src/attachment-references.ts
import { readdir as readdir17, readFile as readFile23, stat as stat16 } from "node:fs/promises";
import { join as join29, resolve as resolve9 } from "node:path";
var REFERENCE_TTL_MS = 5 * 60 * 1e3;
var snapshot;
async function listSessionFiles(home2) {
  const out = [];
  const agentsDir = join29(home2, "agents");
  const agents2 = await readdir17(agentsDir, { withFileTypes: true }).catch(() => []);
  for (const agent of agents2) {
    if (!agent.isDirectory()) continue;
    const projectsDir = join29(agentsDir, agent.name, "projects");
    const projects = await readdir17(projectsDir, { withFileTypes: true }).catch(() => []);
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      const sessionsDir = join29(projectsDir, project.name, "sessions");
      const files = await readdir17(sessionsDir, { withFileTypes: true }).catch(() => []);
      for (const file of files) {
        if (file.isFile() && file.name.endsWith(".jsonl")) out.push(join29(sessionsDir, file.name));
      }
    }
  }
  return out;
}
async function referencedImagePaths(home2) {
  const files = await listSessionFiles(home2);
  let newest = 0;
  for (const file of files) {
    const info = await stat16(file).catch(() => void 0);
    if (info !== void 0 && info.mtimeMs > newest) newest = info.mtimeMs;
  }
  const signature = `${files.length}:${Math.round(newest)}`;
  if (snapshot !== void 0 && snapshot.signature === signature && Date.now() - snapshot.at < REFERENCE_TTL_MS) {
    return snapshot.paths;
  }
  const paths = /* @__PURE__ */ new Set();
  for (const file of files) {
    const text = await readFile23(file, "utf8").catch(() => "");
    if (text === "") continue;
    for (const line of text.split("\n")) {
      if (!line.includes("\u56FE\u7247 ") && !line.includes("screenshot ")) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const message = entry.message;
      const content = message?.content;
      const texts = [];
      if (typeof content === "string") texts.push(content);
      else if (Array.isArray(content)) {
        for (const block of content) {
          const part = block;
          if (part !== null && part.type === "text" && typeof part.text === "string") texts.push(part.text);
        }
      }
      for (const text2 of texts) {
        for (const ref of parseImageRefs(text2)) paths.add(resolve9(ref));
      }
    }
  }
  snapshot = { at: Date.now(), paths, signature };
  return paths;
}

// src/rail-ticks.ts
var RAIL_PREVIEW_CHARS = 100;
function truncateByCodePoint(text, limit) {
  if (limit <= 0) return "";
  if (text.length <= limit) return text;
  const points = Array.from(text);
  return points.length <= limit ? text : points.slice(0, limit).join("");
}
function railTicksOf(messages) {
  const ticks = [];
  let pendingReply;
  let inTurn = false;
  let turnHost;
  const flush = () => {
    if (pendingReply !== void 0) ticks.push(pendingReply);
    pendingReply = void 0;
  };
  for (const message of messages) {
    const text = message.text ?? "";
    if (message.role === "user") {
      flush();
      inTurn = true;
      turnHost = void 0;
      if (message.id === void 0 || message.id === "") continue;
      ticks.push({
        id: message.id,
        role: "user",
        chars: text.length,
        preview: truncateByCodePoint(text.trim(), RAIL_PREVIEW_CHARS)
      });
      continue;
    }
    if (message.role !== "assistant") continue;
    if (!inTurn) continue;
    if (turnHost === void 0 && message.id !== void 0 && message.id !== "") turnHost = message.id;
    if (message.streaming === true) continue;
    if (text.trim() === "") continue;
    if (message.id === void 0 || message.id === "") continue;
    pendingReply = {
      id: message.id,
      role: "assistant",
      chars: text.length,
      preview: truncateByCodePoint(text.trim(), RAIL_PREVIEW_CHARS),
      ...turnHost !== void 0 && turnHost !== message.id ? { host: turnHost } : {}
    };
  }
  flush();
  return ticks;
}

// src/profile.ts
import { mkdir as mkdir16, readFile as readFile24, readdir as readdir18, rename as rename8, rm as rm10, stat as stat17, writeFile as writeFile19 } from "node:fs/promises";
import { execFile as execFile7 } from "node:child_process";
import { promisify as promisify7 } from "node:util";
import { basename as basename7, join as join30 } from "node:path";
var run7 = promisify7(execFile7);
var USERS_RELATIVE_DIR = "users";
var AVATAR_PREFIX = "avatar";
var PROFILE_RELATIVE_PATH = "config/profile.json";
var PROFILE_AVATAR_DIR = "config";
var MAX_PROFILE_NAME = 32;
var usersRoot = (home2) => join30(home2, USERS_RELATIVE_DIR);
var userDir = (home2, id) => join30(usersRoot(home2), id);
var userJson = (home2, id) => join30(userDir(home2, id), "user.json");
async function defaultProfileName() {
  const env = process.env;
  const fromEnv = env.USER ?? env.LOGNAME;
  try {
    const { stdout } = await run7("id", ["-F"], { timeout: 2e3 });
    const full = stdout.trim();
    if (full !== "") return full.slice(0, MAX_PROFILE_NAME);
  } catch {
  }
  return (fromEnv !== void 0 && fromEnv.trim() !== "" ? fromEnv.trim() : "\u6211").slice(0, MAX_PROFILE_NAME);
}
function normalizeName(value) {
  if (typeof value !== "string") return void 0;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed === "") return void 0;
  return trimmed.slice(0, MAX_PROFILE_NAME);
}
function sniffAvatarMime(bytes) {
  const b = bytes;
  if (b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71) return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  const RIFF = (i) => b[i] === 82 && b[i + 1] === 73 && b[i + 2] === 70 && b[i + 3] === 70;
  const WEBP = (i) => b[i] === 87 && b[i + 1] === 69 && b[i + 2] === 66 && b[i + 3] === 80;
  if (RIFF(0) && WEBP(8)) return "image/webp";
  return void 0;
}
var EXT_OF_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
};
var parseAvatar = (value) => {
  if (typeof value !== "object" || value === null) return void 0;
  const record = value;
  if (record.kind !== "image" || typeof record.file !== "string" || record.file === "") return void 0;
  if (basename7(record.file) !== record.file) return void 0;
  return { kind: "image", file: record.file, revision: typeof record.revision === "number" ? record.revision : 0 };
};
function parseProfile(raw, fallbackName, fallbackId) {
  const record = raw ?? {};
  const name = normalizeName(record.name) ?? fallbackName;
  const generated = entityId(name, "url");
  const id = typeof record.id === "string" && record.id !== "" ? record.id : fallbackId ?? (generated.ok ? generated.id : "user");
  const avatar = parseAvatar(record.avatar);
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : void 0;
  return {
    id,
    name,
    ...avatar !== void 0 ? { avatar } : {},
    ...createdAt !== void 0 ? { createdAt } : {}
  };
}
async function listUserIds(home2) {
  const entries = await readdir18(usersRoot(home2), { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).map((entry) => entry.name).sort();
}
async function readUserEntity(home2, id) {
  const text = await readFile24(userJson(home2, id), "utf8").catch(() => void 0);
  if (text === void 0) return void 0;
  try {
    return parseProfile(JSON.parse(text), id, id);
  } catch {
    return void 0;
  }
}
async function writeUserEntity(home2, profile) {
  const dir = userDir(home2, profile.id);
  await mkdir16(dir, { recursive: true, mode: 448 });
  const path = userJson(home2, profile.id);
  const body = JSON.stringify({ schemaVersion: 1, ...profile }, null, 2);
  const tmp = `${path}.tmp`;
  await writeFile19(tmp, `${body}
`, { encoding: "utf8", mode: 384 });
  await rename8(tmp, path);
}
async function readProfile(home2) {
  const fallbackName = await defaultProfileName();
  const ids = await listUserIds(home2);
  const first = ids[0];
  if (first !== void 0) {
    const entity = await readUserEntity(home2, first);
    if (entity !== void 0) return entity;
  }
  const legacyText = await readFile24(join30(home2, PROFILE_RELATIVE_PATH), "utf8").catch(() => void 0);
  if (legacyText !== void 0) {
    try {
      return parseProfile(JSON.parse(legacyText), fallbackName);
    } catch {
    }
  }
  return parseProfile({}, fallbackName);
}
async function writeProfile(home2, profile) {
  const existingIds = await listUserIds(home2);
  const generated = entityId(profile.name, "url");
  const id = profile.id !== void 0 && profile.id !== "" ? profile.id : existingIds[0] ?? (generated.ok ? generated.id : void 0);
  if (id === void 0 || typeof id !== "string") {
    throw new Error(generated.ok ? "\u65E0\u6CD5\u786E\u5B9A\u7528\u6237 id" : generated.message);
  }
  const next = {
    id,
    name: profile.name,
    ...profile.avatar !== void 0 ? { avatar: profile.avatar } : {},
    createdAt: profile.createdAt ?? (/* @__PURE__ */ new Date()).toISOString()
  };
  await writeUserEntity(home2, next);
  return next;
}
async function storeProfileAvatar(home2, base64) {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength === 0) return void 0;
  const mime = sniffAvatarMime(new Uint8Array(bytes));
  if (mime === void 0) return void 0;
  const profile = await readProfile(home2);
  const dir = userDir(home2, profile.id);
  await mkdir16(dir, { recursive: true, mode: 448 });
  const revision = Date.now();
  const file = `${AVATAR_PREFIX}-${revision}.${EXT_OF_MIME[mime]}`;
  const path = join30(dir, file);
  const tmp = `${path}.tmp`;
  await writeFile19(tmp, bytes, { mode: 384 });
  await rename8(tmp, path);
  await pruneOldAvatars(dir, file);
  return { kind: "image", file, revision };
}
async function pruneOldAvatars(dir, keep) {
  const entries = await readdir18(dir).catch(() => []);
  for (const entry of entries) {
    if (entry === keep) continue;
    if (!/^avatar-\d+\.(png|jpg|webp)$/.test(entry)) continue;
    await rm10(join30(dir, entry), { force: true }).catch(() => void 0);
  }
}
function avatarPath(home2, profile) {
  const file = profile.avatar?.file ?? "";
  if (file.startsWith("profile-avatar-")) return join30(home2, PROFILE_AVATAR_DIR, file);
  return join30(userDir(home2, profile.id), file);
}
async function readProfileAvatar(home2, profile) {
  if (profile.avatar === void 0) return void 0;
  return readFile24(avatarPath(home2, profile)).catch(() => void 0);
}
var MAX_AVATAR_BYTES = 1024 * 1024;
async function avatarExists(home2, profile) {
  if (profile.avatar === void 0) return false;
  const info = await stat17(avatarPath(home2, profile)).catch(() => void 0);
  return info !== void 0 && info.isFile();
}

// src/ui-prefs.ts
init_atomic_file();
init_home();
import { readFile as readFile25 } from "node:fs/promises";
import { join as join31 } from "node:path";
function uiPrefsPath(home2 = resolveHome()) {
  return join31(home2, "config", "ui.json");
}
async function readUiPrefs(home2 = resolveHome()) {
  try {
    const raw = await readFile25(uiPrefsPath(home2), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record = parsed;
    const out = {};
    if (record.theme !== void 0) out.theme = record.theme;
    if (record.display !== void 0) out.display = record.display;
    if (record.badges !== void 0) out.badges = record.badges;
    if (record.selection !== void 0) out.selection = record.selection;
    return out;
  } catch {
    return {};
  }
}
async function writeUiPrefs(patch, home2 = resolveHome()) {
  const current = await readUiPrefs(home2);
  const next = { ...current };
  if (patch.theme !== void 0) next.theme = patch.theme;
  if (patch.display !== void 0) next.display = patch.display;
  if (patch.badges !== void 0) next.badges = patch.badges;
  if (patch.selection !== void 0) next.selection = patch.selection;
  await writeTextAtomic(uiPrefsPath(home2), `${JSON.stringify(next, null, 2)}
`);
  return next;
}

// src/server.ts
init_home();
init_logging();

// src/static.ts
var IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
var REVALIDATE_CACHE = "no-cache";
function isHashedAsset(path) {
  return path.startsWith("/assets/");
}
function looksLikeFile(path) {
  return /\.[A-Za-z0-9]+$/.test(path);
}
function cacheControlOf(path) {
  return isHashedAsset(path) ? IMMUTABLE_CACHE : REVALIDATE_CACHE;
}

// src/server.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { bodyLimit } from "hono/body-limit";

// src/image-input.ts
var MAX_IMAGE_BYTES = 10 * 1024 * 1024;
var MAX_IMAGES_PER_MESSAGE = 10;
var MAX_SESSION_IMAGE_BYTES = 16 * 1024 * 1024;
var IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/avif"
];
function startsWith(bytes, offset, pattern) {
  if (bytes.length < offset + pattern.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    if (bytes[offset + i] !== pattern[i]) return false;
  }
  return true;
}
function ascii(bytes, offset, length) {
  if (bytes.length < offset + length) return "";
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i] ?? 0);
  return out;
}
function sniffImageMime(bytes) {
  if (startsWith(bytes, 0, [137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (startsWith(bytes, 0, [255, 216, 255])) return "image/jpeg";
  if (ascii(bytes, 0, 4) === "GIF8") return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (startsWith(bytes, 0, [66, 77])) return "image/bmp";
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  return void 0;
}
function decodeBase64Image(data) {
  if (data === "" || data.length % 4 !== 0) return void 0;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return void 0;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const estimated = data.length / 4 * 3 - padding;
  if (estimated > MAX_IMAGE_BYTES) return void 0;
  const decoded = Buffer.from(data, "base64");
  return new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength);
}
function base64ByteLength(data) {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(data.length * 3 / 4) - padding);
}
function validateImages(value, sessionImageBytes = 0) {
  if (value === void 0 || value === null) return { ok: true, images: [] };
  if (!Array.isArray(value)) {
    return { ok: false, code: "invalid_request", message: "images \u5FC5\u987B\u662F\u6570\u7EC4" };
  }
  if (value.length === 0) return { ok: true, images: [] };
  if (value.length > MAX_IMAGES_PER_MESSAGE) {
    return {
      ok: false,
      code: "too_many_images",
      message: `\u4E00\u6761\u6D88\u606F\u6700\u591A ${MAX_IMAGES_PER_MESSAGE} \u5F20\u56FE\u7247`
    };
  }
  const images = [];
  let added = 0;
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, code: "invalid_request", message: "images \u7684\u6BCF\u4E00\u9879\u5FC5\u987B\u662F { data, mimeType }" };
    }
    const record = item;
    if (typeof record.data !== "string" || typeof record.mimeType !== "string") {
      return { ok: false, code: "invalid_request", message: "images \u7684\u6BCF\u4E00\u9879\u5FC5\u987B\u5305\u542B data \u4E0E mimeType \u5B57\u7B26\u4E32" };
    }
    const declared = record.mimeType;
    if (!IMAGE_MIME_TYPES.includes(declared)) {
      return {
        ok: false,
        code: "unsupported_image_type",
        message: `\u4E0D\u652F\u6301\u7684\u56FE\u7247\u7C7B\u578B\uFF1A${declared}\uFF08\u652F\u6301 ${IMAGE_MIME_TYPES.join("\u3001")}\uFF09`
      };
    }
    const bytes = decodeBase64Image(record.data);
    if (bytes === void 0 || bytes.byteLength === 0) {
      const declaredBytes = base64ByteLength(record.data);
      if (declaredBytes > MAX_IMAGE_BYTES) {
        return {
          ok: false,
          code: "image_too_large",
          message: `\u5355\u5F20\u56FE\u7247\u6700\u5927 ${MAX_IMAGE_BYTES / (1024 * 1024)}MB`
        };
      }
      return { ok: false, code: "invalid_image", message: "\u56FE\u7247\u6570\u636E\u4E0D\u662F\u5408\u6CD5\u7684 base64" };
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        code: "image_too_large",
        message: `\u5355\u5F20\u56FE\u7247\u6700\u5927 ${MAX_IMAGE_BYTES / (1024 * 1024)}MB`
      };
    }
    const sniffed = sniffImageMime(bytes);
    if (sniffed === void 0) {
      return { ok: false, code: "invalid_image", message: "\u65E0\u6CD5\u8BC6\u522B\u7684\u56FE\u7247\u683C\u5F0F\uFF08\u6309\u6587\u4EF6\u5934\u5224\u65AD\uFF09" };
    }
    if (sniffed !== declared) {
      return {
        ok: false,
        code: "invalid_image",
        message: `\u56FE\u7247\u5B9E\u9645\u683C\u5F0F\u662F ${sniffed}\uFF0C\u4E0E\u58F0\u660E\u7684 ${declared} \u4E0D\u4E00\u81F4`
      };
    }
    added += bytes.byteLength;
    images.push({ type: "image", data: record.data, mimeType: sniffed });
  }
  if (sessionImageBytes + added > MAX_SESSION_IMAGE_BYTES) {
    return {
      ok: false,
      code: "session_image_budget_exceeded",
      message: `\u672C\u4F1A\u8BDD\u56FE\u7247\u603B\u5927\u5C0F\u5DF2\u8FBE\u4E0A\u9650 ${MAX_SESSION_IMAGE_BYTES / (1024 * 1024)}MB\uFF0C\u8BF7\u65B0\u5EFA\u4F1A\u8BDD\u7EE7\u7EED\u53D1\u56FE`
    };
  }
  return { ok: true, images };
}
function declaredImageSupport(input) {
  if (!Array.isArray(input)) return void 0;
  return input.includes("image");
}

// src/server.ts
var STREAM_HIGH_WATER_BYTES = 512 * 1024;
var STREAM_PING_MS = 1e4;
var agentsRoot2 = () => join32(resolveHome(), "agents");
async function cwdOfSession(agent, sessionId) {
  const pid = await projectIdOfSession(agent.id, sessionId);
  if (pid !== void 0) {
    const project = await resolveProject(agent, pid);
    return project === void 0 || project.id === "workspace" ? resolveHome() : project.path ?? resolveHome();
  }
  return sessionCwd(agent.id, sessionId) ?? resolveHome();
}
var agentProjectsRoot2 = (agentId) => join32(agentsRoot2(), agentId, "projects");
async function resolveProject(agent, pid) {
  if (pid === "workspace") return { id: "workspace", name: "workspace" };
  const manifest = await readProjectManifest(agent.id, pid);
  if (manifest !== void 0) return { id: manifest.id, name: basename8(manifest.path) || manifest.name, path: manifest.path };
  for (const entry of (await readProjectManifests(agent.id)).values()) {
    if (entry.id === pid || entry.legacyId === pid) return { id: entry.id, name: basename8(entry.path) || entry.name, path: entry.path };
  }
  const info = await stat18(join32(agentProjectsRoot2(agent.id), pid)).catch(() => void 0);
  if (info?.isDirectory() === true) return { id: pid, name: pid, path: join32(agentProjectsRoot2(agent.id), pid) };
  return void 0;
}
var SENSITIVE_KEY = /^(api[-_]?key|authorization|access[-_]?token|secret|password)$/i;
function stripSecrets(value) {
  if (Array.isArray(value)) return value.map((item) => stripSecrets(item));
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) if (!SENSITIVE_KEY.test(key)) out[key] = stripSecrets(val);
    return out;
  }
  return value;
}
var identityPath = (id) => join32(agentsRoot2(), id, "identity.md");
async function readModelsConfig() {
  return readFile26(join32(resolveHome(), "config", "models.json"), "utf8").then((text) => JSON.parse(text).providers ?? {}, () => ({}));
}
async function declaredModelImageSupport(choice) {
  if (choice === void 0) return void 0;
  const providers = await readModelsConfig();
  const provider = providers[choice.defaultProvider];
  if (provider === void 0 || !Array.isArray(provider.models)) return void 0;
  const model = provider.models.find((item) => item.id === choice.defaultModel);
  if (model === void 0) return void 0;
  return declaredImageSupport(model.input);
}
async function readModelsProviders() {
  const providers = await readModelsConfig();
  const out = {};
  for (const [id, value] of Object.entries(providers)) {
    const models = value?.models ?? [];
    out[id] = models.flatMap((model) => typeof model.id === "string" ? [model.id] : []);
  }
  return out;
}
var agentConfigPath = (id) => join32(agentsRoot2(), id, "projects", "workspace", "config.json");
function problem(code, message, status) {
  return { body: { error: { code, message } }, status };
}
function createApp() {
  const app = new Hono();
  app.onError((error, c) => {
    const requestId = String(c.get("requestId") ?? "-");
    console.error(`[http] \u672A\u5904\u7406\u5F02\u5E38 ${c.req.method} ${c.req.path} #${requestId}:`, error);
    void log.error("http", "unhandled", "\u672A\u5904\u7406\u7684\u5F02\u5E38", {
      details: {
        requestId,
        method: c.req.method,
        path: c.req.path,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : void 0
      }
    });
    const body = { error: { code: "internal_error", message: "\u670D\u52A1\u7AEF\u5185\u90E8\u9519\u8BEF\uFF08\u5DF2\u8BB0\u5F55\u65E5\u5FD7\uFF09", requestId } };
    return c.json(body, 500);
  });
  app.use(async (c, next) => {
    const expiredFor = expireDrainIfStale();
    if (expiredFor !== void 0) {
      void log.error("session-runtime", "expireDrainIfStale", "\u6392\u7A7A\u8D85\u65F6\uFF1A\u91CD\u542F\u6CA1\u6709\u53D1\u751F\uFF0C\u5DF2\u6062\u590D\u53D7\u7406", {
        details: { expectedBy: "dev-supervisor", drainedForMs: expiredFor, ttlMs: 6e4 }
      });
    }
    const requestId = randomUUID3().slice(0, 8);
    const startedAt = Date.now();
    await next();
    const status = c.res.status;
    const path = new URL(c.req.url).pathname;
    void log.info("http", void 0, "request", { details: { method: c.req.method, path, status, millis: Date.now() - startedAt, requestId } });
  });
  app.post("/api/agents", async (c) => {
    const body = await c.req.json().catch(() => void 0);
    if (body === void 0 || typeof body.name !== "string" || body.name.trim() === "") {
      const error = problem("invalid_request", "\u9700\u8981 name \u5B57\u6BB5\uFF08\u975E\u7A7A\u5B57\u7B26\u4E32\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const created = await createAgent({
      name: body.name,
      ...typeof body.description === "string" ? { description: body.description } : {}
    });
    if ("code" in created) {
      const error = problem(created.code, created.message, created.status);
      return c.json(error.body, error.status);
    }
    return c.json({ agent: created }, created.created ? 201 : 200);
  });
  app.delete("/api/agents/:id", async (c) => {
    const result = await archiveAgent(c.req.param("id"));
    if ("code" in result) {
      const error = problem(result.code, result.message, result.status);
      return c.json(error.body, error.status);
    }
    return c.json(result, 200);
  });
  app.get("/api/agents", async (c) => {
    const entries = await readdir19(agentsRoot2(), { withFileTypes: true }).catch(() => []);
    const items = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const agent = await readAgent(entry.name);
      if (agent !== void 0 && agent.archivedAt === void 0) items.push(agent);
    }
    return c.json({ items });
  });
  app.get("/api/agents/:id", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0 || agent.archivedAt !== void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    return c.json(agent);
  });
  const rowsOf = (agent, projectId) => sessionRowsOf(agent.id, projectId, {
    ...agent.defaultSessionId !== void 0 ? { defaultSessionId: agent.defaultSessionId } : {}
  });
  app.get("/api/agents/:id/sessions", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    return c.json({ items: await rowsOf(agent, agent.defaultProjectId ?? "workspace") });
  });
  app.get("/api/agents/:id/rows", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    return c.json({ items: await rowsOf(agent, agent.defaultProjectId ?? "workspace") });
  });
  app.get("/api/agents/:id/projects/:pid/rows", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const pid = c.req.param("pid");
    if (await resolveProject(agent, pid) === void 0) {
      const error = problem("project_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A project\uFF08\u672A\u6CE8\u518C\u6216\u672A\u7ED1\u5B9A\uFF09", 404);
      return c.json(error.body, error.status);
    }
    return c.json({ items: await rowsOf(agent, pid) });
  });
  app.get("/api/agents/:id/projects", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    return c.json({ items: await listAgentProjects(agent.id) });
  });
  app.get("/api/agents/:id/groups", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const projects = await listAgentProjects(agent.id);
    const items = await Promise.all(projects.map(async (project) => ({
      project,
      sessions: await rowsOf(agent, project.id)
    })));
    return c.json({ items });
  });
  app.get("/api/agents/:id/projects/:pid/sessions", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const pid = c.req.param("pid");
    if (await resolveProject(agent, pid) === void 0) {
      const error = problem("project_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A project\uFF08\u672A\u6CE8\u518C\u6216\u672A\u7ED1\u5B9A\uFF09", 404);
      return c.json(error.body, error.status);
    }
    return c.json({ items: await rowsOf(agent, pid) });
  });
  app.get("/api/agents/:id/sessions/:sessionId/entries", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const sessionId = c.req.param("sessionId");
    const raw = await readSessionEntries(agent.id, sessionId);
    if (raw === void 0) {
      const error = problem("session_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A\u4F1A\u8BDD", 404);
      return c.json(error.body, error.status);
    }
    const offset = Math.max(0, Number(c.req.query("offset") ?? "0") || 0);
    const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") ?? "200") || 200));
    const entries = raw.entries.slice(offset, offset + limit);
    const labels = {};
    for (const entry of raw.entries) {
      if (entry.type !== "label") continue;
      const targetId = entry.targetId;
      const label = entry.label;
      if (typeof targetId !== "string") continue;
      if (typeof label === "string" && label !== "") labels[targetId] = label;
      else delete labels[targetId];
    }
    const leafId = raw.entries.length > 0 ? raw.entries[raw.entries.length - 1]?.id : void 0;
    return c.json({
      sessionId,
      header: raw.header,
      total: raw.entries.length,
      offset,
      limit,
      hasMore: offset + entries.length < raw.entries.length,
      leafId: typeof leafId === "string" ? leafId : void 0,
      labels,
      entries
    });
  });
  app.post("/api/agents/:id/projects", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const body = await c.req.json().catch(() => void 0);
    if (body === void 0 || typeof body.path !== "string" || body.path.trim() === "") {
      const error = problem("invalid_request", "\u9700\u8981 path \u5B57\u6BB5\uFF08\u975E\u7A7A\u5B57\u7B26\u4E32\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const bound = await bindProject(agent.id, body.path);
    if ("code" in bound) return fsError(c, bound);
    return c.json({ project: bound.project, defaultTask: { id: bound.defaultTask.id, title: bound.defaultTask.title } }, bound.created ? 201 : 200);
  });
  app.delete("/api/agents/:id/projects/:pid", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const result = await unbindProject(agent.id, c.req.param("pid"));
    if (result !== "unbound") {
      const error = problem(result.code, result.message, result.status);
      return c.json(error.body, error.status);
    }
    return c.json({ hidden: c.req.param("pid") });
  });
  app.post("/api/agents/:id/projects/:pid/sessions", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const pid = c.req.param("pid");
    const project = await resolveProject(agent, pid);
    if (project === void 0) {
      const error = problem("project_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A project\uFF08\u672A\u6CE8\u518C\u6216\u672A\u7ED1\u5B9A\uFF09", 404);
      return c.json(error.body, error.status);
    }
    const sessionCwd2 = project.id === "workspace" ? resolveHome() : project.path;
    return c.json({ sessionId: await createSession(agent.id, sessionCwd2, pid) });
  });
  app.get("/api/agents/:id/projects/:pid/overview", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const project = await resolveProject(agent, c.req.param("pid"));
    if (project === void 0) {
      const error = problem("project_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A project", 404);
      return c.json(error.body, error.status);
    }
    const isDefault = (agent.defaultProjectId ?? "workspace") === project.id;
    return c.json(await projectOverview(agent.id, project, isDefault));
  });
  app.get("/api/agents/:id/projects/:pid/tasks", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const project = await resolveProject(agent, c.req.param("pid"));
    if (project === void 0) {
      const error = problem("project_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A project", 404);
      return c.json(error.body, error.status);
    }
    const items = await listTasks({ agentId: agent.id, projectId: project.id });
    const grouped = await sessionsByTask(agent.id, project.id);
    const withSessions = items.map((task) => ({ ...task, sessions: grouped.get(task.id) ?? [] }));
    return c.json({ items: withSessions });
  });
  app.put("/api/agents/:id/sessions/:sessionId", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const body = await c.req.json().catch(() => void 0);
    if (body === void 0 || typeof body.name !== "string" || body.name.trim() === "") {
      const error = problem("invalid_request", "\u9700\u8981 name \u5B57\u6BB5\uFF08\u975E\u7A7A\u5B57\u7B26\u4E32\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const sessionId = c.req.param("sessionId");
    if (await getSession(agent.id, sessionId, await cwdOfSession(agent, sessionId)) === void 0) {
      const error = problem("session_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A\u4F1A\u8BDD", 404);
      return c.json(error.body, error.status);
    }
    await renameSession(agent.id, sessionId, body.name.trim().slice(0, 80), await cwdOfSession(agent, sessionId));
    return c.json({ sessionId, name: body.name.trim().slice(0, 80) });
  });
  app.delete("/api/agents/:id/sessions/:sessionId", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const result = await deleteSession(agent.id, c.req.param("sessionId"));
    if (result === "not_found") {
      const error = problem("session_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A\u4F1A\u8BDD", 404);
      return c.json(error.body, error.status);
    }
    if (result === "running") {
      const error = problem("session_running", "\u4F1A\u8BDD\u6B63\u5728\u8FD0\u884C\uFF0C\u5148\u6253\u65AD\u518D\u5220\u9664", 409);
      return c.json(error.body, error.status);
    }
    return c.json({ sessionId: c.req.param("sessionId"), deleted: true });
  });
  app.post("/api/agents/:id/sessions", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    return c.json({ sessionId: await createSession(agent.id, resolveHome(), agent.defaultProjectId ?? "workspace") });
  });
  app.get("/api/agents/:id/sessions/:sessionId/annotations", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const sessionId = c.req.param("sessionId");
    const state = await getSession(agent.id, sessionId, await cwdOfSession(agent, sessionId));
    if (state === void 0) {
      const error = problem("session_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A\u4F1A\u8BDD", 404);
      return c.json(error.body, error.status);
    }
    return c.json({ annotations: annotationsOf(state.session.sessionManager) });
  });
  app.post("/api/agents/:id/sessions/:sessionId/annotations", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const body = await c.req.json().catch(() => void 0);
    const op = body?.op;
    if (op !== "add" && op !== "update" && op !== "remove" && op !== "consume") {
      const error = problem("invalid_request", "op \u5FC5\u987B\u662F add / update / remove / consume", 400);
      return c.json(error.body, error.status);
    }
    if (op === "consume") {
      const ids = body?.ids;
      const consumedBy = body?.consumedBy;
      if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string" || id === "")) {
        const error = problem("invalid_request", "consume \u9700\u8981\u975E\u7A7A\u7684 ids\uFF08\u5B57\u7B26\u4E32\u6570\u7EC4\uFF09", 400);
        return c.json(error.body, error.status);
      }
      if (typeof consumedBy !== "string" || consumedBy === "") {
        const error = problem("invalid_request", "consume \u9700\u8981 consumedBy\uFF08\u8BE5\u8F6E\u7528\u6237\u6D88\u606F id\uFF09", 400);
        return c.json(error.body, error.status);
      }
      const sessionId2 = c.req.param("sessionId");
      const state2 = await getSession(agent.id, sessionId2, await cwdOfSession(agent, sessionId2));
      if (state2 === void 0) {
        const error = problem("session_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A\u4F1A\u8BDD", 404);
        return c.json(error.body, error.status);
      }
      consumeAnnotations(state2.session.sessionManager, ids, consumedBy);
      return c.json({ ok: true, consumed: ids.length });
    }
    const raw = body?.annotation;
    if (raw === void 0 || typeof raw.id !== "string" || raw.id === "") {
      const error = problem("invalid_request", "annotation.id \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32", 400);
      return c.json(error.body, error.status);
    }
    const stored = op === "remove" ? { id: raw.id } : toStoredAnnotation(raw);
    if (stored === void 0) {
      const error = problem("invalid_request", "annotation \u5B57\u6BB5\u4E0D\u5B8C\u6574\uFF08\u9700\u8981 messageId/blockIndex/start/end/quote/marks\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const sessionId = c.req.param("sessionId");
    const state = await getSession(agent.id, sessionId, await cwdOfSession(agent, sessionId));
    if (state === void 0) {
      const error = problem("session_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A\u4F1A\u8BDD", 404);
      return c.json(error.body, error.status);
    }
    appendAnnotation(state.session.sessionManager, op, stored);
    return c.json({ ok: true });
  });
  app.get("/api/agents/:id/sessions/:sessionId", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const state = await getSession(agent.id, c.req.param("sessionId"), await cwdOfSession(agent, c.req.param("sessionId")));
    if (state === void 0) {
      const error = problem("session_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A\u4F1A\u8BDD", 404);
      return c.json(error.body, error.status);
    }
    const integrity = await sessionIntegrity(agent.id, c.req.param("sessionId"));
    if (integrity !== void 0 && integrity.orphanParents > 0) {
      void log.warn("session", "integrity", "\u4F1A\u8BDD\u5B58\u5728\u60AC\u7A7A parentId\uFF08\u5206\u652F\u53EF\u80FD\u65AD\u88C2\uFF09", {
        agentId: agent.id,
        sessionId: c.req.param("sessionId"),
        details: { orphanParents: integrity.orphanParents }
      });
    }
    const tailRaw = c.req.query("tail");
    const tail = tailRaw === void 0 ? void 0 : Math.max(1, Math.min(2e3, Number(tailRaw) || 0));
    const deferThinking = c.req.query("deferThinking") === "1";
    const all = messagesOf(state, { deferThinking });
    const before = c.req.query("before");
    let sliceEnd = all.length;
    if (before !== void 0) {
      const index = all.findIndex((message) => message.id === before);
      if (index < 0) {
        const error = problem("cursor_not_found", "\u8FD9\u4E2A\u6E38\u6807\u4E0D\u5728\u5F53\u524D\u4F1A\u8BDD\u91CC\uFF08\u53EF\u80FD\u521A\u53D1\u751F\u8FC7\u538B\u7F29\uFF09", 409);
        return c.json(error.body, error.status);
      }
      sliceEnd = index;
    }
    const limit = tail ?? 200;
    const sliceStart = before === void 0 && tail === void 0 ? 0 : Math.max(0, sliceEnd - limit);
    const messages = sliceEnd === all.length && before === void 0 && tail === void 0 ? all : all.slice(sliceStart, sliceEnd);
    const markersBeforeWindow = sliceStart === 0 ? [] : all.slice(0, sliceStart).filter((message) => (message.blocks ?? []).some((block) => block.type === "compaction"));
    return c.json({
      sessionId: c.req.param("sessionId"),
      messages: markersBeforeWindow.length === 0 ? messages : [...markersBeforeWindow, ...messages],
      // 分页元信息：`total` = 全会话条数，`tailStart` = 这次返回的**首条正文**在全会话里的下标
      //（补回队首的压缩标记不算正文，否则缓存键里的下标会跟着标记数量漂）
      total: all.length,
      tailStart: sliceStart,
      // 更早的还能不能取（B3）：`olderCursor` 传回 `?before=` 即可再取一页
      hasOlder: sliceStart > 0,
      ...messages.length > 0 && messages[0] !== void 0 ? { olderCursor: messages[0].id } : {},
      // payload 是观测（Task 0012 P1）：图片/文本字节 + 上限从哪来；limit=null 表示该 provider 未声明上限
      meta: { ...sessionMeta(agent.id, state), payload: await payloadMetaOf(state) },
      ...integrity !== void 0 ? { integrity } : {}
    });
  });
  app.get("/api/agents/:id/sessions/:sessionId/rail", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const sessionId = c.req.param("sessionId");
    const state = await getSession(agent.id, sessionId, await cwdOfSession(agent, sessionId));
    if (state === void 0) {
      const error = problem("session_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A\u4F1A\u8BDD", 404);
      return c.json(error.body, error.status);
    }
    return c.json({ items: railTicksOf(messagesOf(state, { deferThinking: true })) });
  });
  app.get("/api/agents/:id/sessions/:sessionId/entries/:entryId/thinking", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const raw = await readSessionEntries(agent.id, c.req.param("sessionId"));
    if (raw === void 0) {
      const error = problem("session_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A\u4F1A\u8BDD", 404);
      return c.json(error.body, error.status);
    }
    const entryId = c.req.param("entryId");
    const entry = raw.entries.find((candidate) => candidate.id === entryId);
    if (entry === void 0) {
      const error = problem("entry_not_found", "\u627E\u4E0D\u5230\u8FD9\u6761\u8BB0\u5F55", 404);
      return c.json(error.body, error.status);
    }
    const message = entry.message;
    if (message?.role !== "assistant" || !Array.isArray(message.content)) {
      const error = problem("not_thinking", "\u8FD9\u6761\u8BB0\u5F55\u6CA1\u6709\u601D\u8003\u5757", 400);
      return c.json(error.body, error.status);
    }
    const blockIndex = Number(c.req.query("blockIndex") ?? "0");
    if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex >= message.content.length) {
      const error = problem("invalid_request", "blockIndex \u8D8A\u754C", 400);
      return c.json(error.body, error.status);
    }
    const part = message.content[blockIndex];
    if (part.type !== "thinking") {
      const error = problem("not_thinking", "\u8FD9\u4E2A\u4E0B\u6807\u4E0D\u662F\u601D\u8003\u5757", 400);
      return c.json(error.body, error.status);
    }
    return c.json({ entryId, blockIndex, text: typeof part.thinking === "string" ? part.thinking : "" });
  });
  app.get("/api/agents/:id/sessions/:sessionId/turns/last", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    if (!await sessionExists(agent.id, c.req.param("sessionId"))) {
      const error = problem("session_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A\u4F1A\u8BDD", 404);
      return c.json(error.body, error.status);
    }
    return c.json(await turnLastOf(agent.id, c.req.param("sessionId")));
  });
  app.post("/api/logs", async (c) => {
    const raw = await c.req.text();
    if (raw.length > 16 * 1024) {
      const error = problem("invalid_request", "\u6279\u91CF\u8FC7\u5927\uFF08>16KiB\uFF09", 400);
      return c.json(error.body, error.status);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const error = problem("invalid_request", "body \u4E0D\u662F\u5408\u6CD5 JSON", 400);
      return c.json(error.body, error.status);
    }
    const events = parsed.events;
    if (!Array.isArray(events) || events.length === 0 || events.length > 50) {
      const error = problem("invalid_request", "events \u5FC5\u987B\u662F 1..50 \u6761\u7684\u6570\u7EC4", 400);
      return c.json(error.body, error.status);
    }
    const written = await appendFrontendRows(events);
    void log.info("http", void 0, "frontend-logs", { details: { written, requestId: "batch" } });
    return c.json({ written });
  });
  const messagesBodyLimit = bodyLimit({
    maxSize: MAX_SESSION_IMAGE_BYTES * 2,
    onError: (c) => {
      const error = problem("payload_too_large", `\u8BF7\u6C42\u4F53\u8D85\u8FC7 ${MAX_SESSION_IMAGE_BYTES * 2 / (1024 * 1024)}MB`, 413);
      return c.json(error.body, error.status);
    }
  });
  app.post("/api/agents/:id/sessions/:sessionId/messages", messagesBodyLimit, async (c) => {
    if (isDraining()) {
      const error = problem("backend_draining", "\u540E\u7AEF\u6B63\u5728\u7B49\u5F85\u91CD\u542F\uFF08\u5F00\u53D1\u70ED\u66F4\u65B0\uFF09\uFF1A\u6B63\u5728\u8DD1\u7684\u56DE\u5408\u7ED3\u675F\u540E\u4F1A\u81EA\u52A8\u91CD\u542F\uFF0C\u8BF7\u7A0D\u540E\u518D\u53D1", 503);
      return c.json(error.body, error.status);
    }
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const body = await c.req.json().catch(() => void 0);
    if (body === void 0 || typeof body.text !== "string" || body.text.trim() === "") {
      const error = problem("invalid_request", "\u9700\u8981 text \u5B57\u6BB5\uFF08\u975E\u7A7A\u5B57\u7B26\u4E32\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const sessionId = c.req.param("sessionId");
    const state = await getSession(agent.id, sessionId, await cwdOfSession(agent, sessionId));
    if (state === void 0) {
      const error = problem("session_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A\u4F1A\u8BDD", 404);
      return c.json(error.body, error.status);
    }
    const behavior = body.behavior === "steer" || body.behavior === "followUp" ? body.behavior : void 0;
    const images = validateImages(body.images, sessionImageBytesOf(state));
    if (!images.ok) {
      const error = problem(images.code, images.message, images.code === "too_many_images" || images.code === "session_image_budget_exceeded" ? 422 : 400);
      return c.json(error.body, error.status);
    }
    if (images.images.length > 0) {
      const choice = await resolveModelChoice(agent.id);
      const support = await declaredModelImageSupport(choice?.choice);
      if (support === false) {
        const error = problem("model_no_image_input", `\u5F53\u524D\u6A21\u578B ${choice?.choice.defaultModel ?? ""} \u672A\u58F0\u660E\u56FE\u7247\u8F93\u5165\u80FD\u529B\uFF0C\u8BF7\u6362\u4E00\u4E2A\u652F\u6301\u770B\u56FE\u7684\u6A21\u578B`, 400);
        return c.json(error.body, error.status);
      }
    }
    if (behavior !== void 0) {
      const verdict = await queueSessionInput(agent.id, sessionId, body.text, behavior);
      if ("code" in verdict) {
        if (verdict.code === "session_not_found") {
          const error2 = problem("session_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A\u4F1A\u8BDD", 404);
          return c.json(error2.body, error2.status);
        }
        if (verdict.code === "session_idle") {
          const error2 = problem("session_idle", "\u4F1A\u8BDD\u7A7A\u95F2\uFF1A\u6539\u4E3A\u65B0\u56DE\u5408\u5904\u7406\uFF08\u51B3\u7B56 b\uFF09", 409);
          return c.json(error2.body, error2.status);
        }
        if (verdict.code === "error") {
          const error2 = problem("steer_failed", verdict.message, 400);
          return c.json(error2.body, error2.status);
        }
        const error = problem("session_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A\u4F1A\u8BDD", 404);
        return c.json(error.body, error.status);
      }
      return c.json({ queued: verdict.queued }, 202);
    }
    const slot = reserveTurn(agent.id, sessionId);
    if (slot === void 0) {
      const error = problem(
        "session_running",
        "\u8FD9\u4E00\u8F6E\u8FD8\u6CA1\u7ED3\u675F\uFF0C\u65B0\u6D88\u606F\u6CA1\u6709\u53D1\u51FA\uFF1A\u7B49\u5B83\u8DD1\u5B8C\u518D\u53D1 / \u751F\u6210\u4E2D\u6309 Enter \u63D2\u8BDD\uFF08steer\uFF09/ \u70B9\u505C\u6B62\uFF08Esc\uFF09\u6253\u65AD\u540E\u91CD\u53D1",
        409
      );
      return c.json(error.body, error.status);
    }
    nameSessionFromFirstMessage(agent.id, sessionId, body.text);
    const turn = runTurn2(agent.id, sessionId, body.text, { images: images.images, reserved: slot });
    void turn.then((result) => {
      if (result.ok) return;
      slot.release();
      void log.error("http", "messages", "\u5360\u4F4D\u6210\u529F\u4F46 runTurn \u56DE\u62A5 busy", { sessionId, agentId: agent.id });
    }).catch((error) => {
      void log.error("http", "messages", "runTurn \u629B\u51FA\u672A\u6355\u83B7\u9519\u8BEF", {
        sessionId,
        agentId: agent.id,
        details: { message: error instanceof Error ? error.message : String(error) }
      });
    });
    return c.json({ accepted: true, images: images.images.length, turnId: slot.turnId }, 202);
  });
  app.post("/api/agents/:id/sessions/:sessionId/abort", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const aborted = await abortSession(agent.id, c.req.param("sessionId"));
    if (!aborted) {
      const error = problem("session_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A\u4F1A\u8BDD", 404);
      return c.json(error.body, error.status);
    }
    return c.json({ aborted: true });
  });
  app.post("/api/agents/:id/sessions/:sessionId/retry/abort", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    if (!await sessionExists(agent.id, c.req.param("sessionId"))) {
      const error = problem("session_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A\u4F1A\u8BDD", 404);
      return c.json(error.body, error.status);
    }
    if (!abortRetryOf(agent.id, c.req.param("sessionId"))) {
      const error = problem("not_retrying", "\u8FD9\u4E2A\u4F1A\u8BDD\u5F53\u524D\u6CA1\u6709\u5728\u81EA\u52A8\u91CD\u8BD5", 409);
      return c.json(error.body, error.status);
    }
    return c.json({ retryAborted: true });
  });
  app.post("/api/agents/:id/sessions/:sessionId/compact", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const result = await compactSession(agent.id, c.req.param("sessionId"));
    if (!result.ok) {
      const error = problem("compact_failed", result.message, 400);
      return c.json(error.body, error.status);
    }
    return c.json({ summary: result.summary });
  });
  app.post("/api/agents/:id/sessions/:sessionId/model", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const body = await c.req.json().catch(() => void 0);
    if (body === void 0 || typeof body.provider !== "string" || typeof body.model !== "string") {
      const error = problem("invalid_request", "\u9700\u8981 provider \u4E0E model \u5B57\u6BB5", 400);
      return c.json(error.body, error.status);
    }
    const result = await setSessionModel(agent.id, c.req.param("sessionId"), body.provider, body.model);
    if (!result.ok) {
      if (result.reason === "session_not_found") {
        const error2 = problem("session_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A\u4F1A\u8BDD", 404);
        return c.json(error2.body, error2.status);
      }
      if (result.reason === "model_not_found") {
        const error2 = problem("model_not_found", `models.json \u91CC\u6CA1\u6709 ${body.provider}/${body.model}`, 404);
        return c.json(error2.body, error2.status);
      }
      const error = problem("model_rejected", result.message, 409);
      return c.json(error.body, error.status);
    }
    return c.json({ provider: body.provider, model: body.model });
  });
  app.post("/api/agents/:id/sessions/:sessionId/thinking", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const body = await c.req.json().catch(() => void 0);
    if (body === void 0 || typeof body.level !== "string") {
      const error = problem("invalid_request", "\u9700\u8981 level \u5B57\u6BB5", 400);
      return c.json(error.body, error.status);
    }
    const level = THINKING_LEVELS.find((item) => item === body.level);
    if (level === void 0) {
      const error = problem("invalid_request", `level \u53EA\u80FD\u662F ${THINKING_LEVELS.join(" / ")}`, 400);
      return c.json(error.body, error.status);
    }
    const result = setSessionThinking(agent.id, c.req.param("sessionId"), level);
    if (!result.ok) {
      const error = problem("session_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A\u4F1A\u8BDD", 404);
      return c.json(error.body, error.status);
    }
    return c.json({ level: result.level });
  });
  app.get("/api/events", (c) => {
    if (c.req.query("transport") !== "sse") {
      c.header("Connection", "Upgrade");
      c.header("Upgrade", "websocket");
      return c.body("\u4E8B\u4EF6\u901A\u9053\u5DF2\u6539\u4E3A WebSocket\uFF1A\u8BF7\u8FDE\u63A5 ws://\u2026/api/events\uFF1B\u5982\u9700 SSE \u517C\u5BB9\u8DEF\u5F84\u8BF7\u52A0 ?transport=sse", 426);
    }
    return streamSSE(c, async (stream) => {
      await pruneSessionViewsOnce();
      const connectionId = randomUUID3();
      let finished = () => void 0;
      const finishedPromise = new Promise((resolve10) => {
        finished = resolve10;
      });
      const sink = createBoundedSink({
        write: (event) => stream.writeSSE({ event: event.type, id: String(event.seq), data: JSON.stringify(event) }),
        limitBytes: STREAM_HIGH_WATER_BYTES
      });
      const bus = subscribeBus({
        id: connectionId,
        offer: (event) => sink.offer(event),
        overflowed: () => {
          void stream.close();
          finished();
        }
        // 过载：关闭，客户端重连
      });
      const snapshot2 = { connectionId, seq: bus.seq, ...globalSnapshot() };
      const ping = setInterval(() => {
        void stream.writeSSE({ event: "ping", data: "{}" }).catch(() => finished());
      }, STREAM_PING_MS);
      try {
        await stream.writeSSE({ event: "snapshot", id: String(bus.seq), data: JSON.stringify(snapshot2) });
        bus.ready();
        stream.onAbort(() => finished());
        c.req.raw.signal.addEventListener("abort", () => finished());
        await finishedPromise;
      } finally {
        clearInterval(ping);
        bus.close();
        sink.close();
      }
    });
  });
  app.put("/api/events/focus", async (c) => {
    const body = await c.req.json().catch(() => void 0);
    if (body === void 0 || typeof body.connectionId !== "string" || typeof body.visible !== "boolean") {
      const error = problem("invalid_request", "\u9700\u8981 connectionId\uFF08\u5B57\u7B26\u4E32\uFF09\u4E0E visible\uFF08\u5E03\u5C14\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const hasTarget = typeof body.agentId === "string" && body.agentId !== "" && typeof body.sessionId === "string" && body.sessionId !== "";
    const rawWatching = body.watching;
    let watching = [];
    if (rawWatching !== void 0) {
      if (!Array.isArray(rawWatching)) {
        const error = problem("invalid_request", "watching \u5FC5\u987B\u662F\u6570\u7EC4", 400);
        return c.json(error.body, error.status);
      }
      const seen = /* @__PURE__ */ new Set();
      for (const entry of rawWatching) {
        const item = entry;
        if (typeof item.agentId !== "string" || item.agentId === "" || typeof item.sessionId !== "string" || item.sessionId === "") {
          const error = problem("invalid_request", "watching \u7684\u6BCF\u4E00\u9879\u90FD\u9700\u8981 agentId \u4E0E sessionId\uFF08\u975E\u7A7A\u5B57\u7B26\u4E32\uFF09", 400);
          return c.json(error.body, error.status);
        }
        const key = `${item.agentId}/${item.sessionId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        watching.push({ agentId: item.agentId, sessionId: item.sessionId });
      }
      if (watching.length > MAX_WATCHING) {
        const error = problem("too_many_watching", `\u540C\u65F6\u67E5\u770B\u7684\u4F1A\u8BDD\u6700\u591A ${MAX_WATCHING} \u6761`, 400);
        return c.json(error.body, error.status);
      }
    }
    const focus = hasTarget ? {
      agentId: body.agentId,
      sessionId: body.sessionId,
      visible: body.visible,
      ...watching.length > 0 ? { watching } : {}
    } : void 0;
    if (!setFocusOf(body.connectionId, focus)) {
      const error = problem("connection_not_found", "\u4E8B\u4EF6\u8FDE\u63A5\u4E0D\u5B58\u5728\uFF08\u5DF2\u65AD\u5F00\uFF09\uFF1B\u8BF7\u91CD\u8FDE\u540E\u91CD\u65B0\u4E0A\u62A5\u7126\u70B9", 404);
      return c.json(error.body, error.status);
    }
    if (focus !== void 0) {
      const projectId = await projectIdOfSession(focus.agentId, focus.sessionId);
      void log.info("server", "events/focus", "\u7126\u70B9\u4E0A\u62A5", {
        sessionId: focus.sessionId,
        agentId: focus.agentId,
        projectId,
        details: { visible: focus.visible, watching: focus.watching?.length ?? 0 }
      });
      markSessionViewed(focus.agentId, focus.sessionId, (/* @__PURE__ */ new Date()).toISOString(), projectId);
    }
    return c.json({ ok: true });
  });
  app.get("/api/runtime", (c) => c.json({
    running: globalSnapshot().running,
    draining: isDraining(),
    ...drainingForMs() !== void 0 ? { drainingForMs: drainingForMs() } : {}
  }));
  app.get("/api/ui-prefs", async (c) => c.json(await readUiPrefs()));
  app.put("/api/ui-prefs", async (c) => {
    const body = await c.req.json().catch(() => void 0);
    if (body === void 0) {
      const error = problem("invalid_request", "\u9700\u8981 JSON \u8BF7\u6C42\u4F53\uFF08\u53EF\u4EE5\u53EA\u5E26 theme / display / badges / selection\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const patch = {};
    if (body.theme !== void 0) patch.theme = body.theme;
    if (body.display !== void 0) patch.display = body.display;
    if (body.badges !== void 0) patch.badges = body.badges;
    if (body.selection !== void 0) patch.selection = body.selection;
    if (patch.theme === void 0 && patch.display === void 0 && patch.badges === void 0 && patch.selection === void 0) {
      const error = problem("invalid_request", "\u8BF7\u6C42\u4F53\u91CC\u6CA1\u6709\u53EF\u8BC6\u522B\u7684\u504F\u597D\u952E\uFF08theme / display / badges / selection\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const saved = await writeUiPrefs(patch);
    return c.json(saved);
  });
  app.post("/api/runtime/drain", (c) => {
    setDraining(true);
    return c.json({ draining: true, running: globalSnapshot().running.length });
  });
  app.put("/api/agents/:id", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const body = await c.req.json().catch(() => void 0);
    if (body === void 0) {
      const error = problem("invalid_request", "\u8BF7\u6C42\u4F53\u65E0\u6548", 400);
      return c.json(error.body, error.status);
    }
    const updated = { ...agent };
    if (body.name !== void 0) {
      if (typeof body.name !== "string" || body.name.trim() === "") {
        const error = problem("invalid_name", "name \u9700\u4E3A\u975E\u7A7A\u5B57\u7B26\u4E32", 400);
        return c.json(error.body, error.status);
      }
      updated.name = body.name.trim().slice(0, 60);
    }
    if (body.description !== void 0) updated.description = String(body.description).slice(0, 300);
    await writeAgent(updated);
    return c.json(updated);
  });
  app.get("/api/agents/:id/identity", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const text = await readFile26(identityPath(agent.id), "utf8").catch(() => "");
    return c.json({ text });
  });
  app.put("/api/agents/:id/identity", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const body = await c.req.json().catch(() => void 0);
    if (body === void 0 || typeof body.text !== "string" || body.text.length > 64 * 1024) {
      const error = problem("invalid_request", "\u9700\u8981 text \u5B57\u6BB5\uFF08\u226464KB\uFF09", 400);
      return c.json(error.body, error.status);
    }
    await writeTextAtomic(identityPath(agent.id), body.text);
    return c.json({ ok: true });
  });
  app.post("/api/agents/:id/avatar", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const body = await c.req.json().catch(() => void 0);
    if (body?.reset === true) {
      const cleared = await clearAgentAvatar(agent.id);
      if (!cleared.ok) {
        const error = problem(cleared.code, cleared.message, cleared.status);
        return c.json(error.body, error.status);
      }
      return c.json({ avatar: null });
    }
    if (body === void 0 || typeof body.data !== "string" || body.data.length === 0) {
      const error = problem("invalid_request", "\u9700\u8981 data\uFF08base64\uFF09\u6216 reset", 400);
      return c.json(error.body, error.status);
    }
    const written = await setAgentAvatar(agent.id, Buffer.from(body.data, "base64"));
    if (!written.ok) {
      const error = problem(written.code, written.message, written.status);
      return c.json(error.body, error.status);
    }
    return c.json({ avatar: written.avatar });
  });
  app.get("/api/profile", async (c) => {
    const profile = await readProfile(resolveHome());
    const hasAvatar = await avatarExists(resolveHome(), profile);
    return c.json({ id: profile.id, name: profile.name, avatar: hasAvatar ? profile.avatar ?? null : null });
  });
  app.put("/api/profile", async (c) => {
    const body = await c.req.json().catch(() => void 0);
    if (body === void 0) {
      const error = problem("invalid_request", "\u9700\u8981 JSON \u8BF7\u6C42\u4F53", 400);
      return c.json(error.body, error.status);
    }
    const current = await readProfile(resolveHome());
    const name = normalizeName(body.name);
    if (name === void 0) {
      const error = problem("invalid_request", "\u540D\u5B57\u4E0D\u80FD\u4E3A\u7A7A", 400);
      return c.json(error.body, error.status);
    }
    const written = await writeProfile(resolveHome(), { ...current, name });
    return c.json({ id: written.id, name: written.name, avatar: written.avatar ?? null });
  });
  app.post("/api/profile/avatar", async (c) => {
    const body = await c.req.json().catch(() => void 0);
    if (body === void 0 || typeof body.data !== "string" || body.data === "") {
      const error = problem("invalid_request", "\u9700\u8981 { data: <base64> }", 400);
      return c.json(error.body, error.status);
    }
    const bytes = Buffer.from(body.data, "base64");
    if (bytes.byteLength === 0) {
      const error = problem("invalid_image", "\u56FE\u7247\u6570\u636E\u4E0D\u662F\u5408\u6CD5 base64", 400);
      return c.json(error.body, error.status);
    }
    if (bytes.byteLength > MAX_AVATAR_BYTES) {
      const error = problem("avatar_too_large", `\u5934\u50CF\u6700\u5927 ${MAX_AVATAR_BYTES / (1024 * 1024)}MB`, 413);
      return c.json(error.body, error.status);
    }
    const avatar = await storeProfileAvatar(resolveHome(), body.data);
    if (avatar === void 0) {
      const error = problem("unsupported_image_type", "\u5934\u50CF\u652F\u6301 png / jpeg / webp\uFF08\u6309\u6587\u4EF6\u5934\u5224\u65AD\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const current = await readProfile(resolveHome());
    const written = await writeProfile(resolveHome(), { ...current, avatar });
    return c.json({ id: written.id, name: written.name, avatar });
  });
  app.delete("/api/profile/avatar", async (c) => {
    const current = await readProfile(resolveHome());
    const { avatar: _dropped, ...rest } = current;
    const written = await writeProfile(resolveHome(), rest);
    return c.json({ id: written.id, name: written.name, avatar: null });
  });
  app.get("/api/profile/avatar", async (c) => {
    const profile = await readProfile(resolveHome());
    const buffer = await readProfileAvatar(resolveHome(), profile);
    if (buffer === void 0) {
      const error = problem("no_avatar", "\u672A\u8BBE\u7F6E\u56FE\u7247\u5934\u50CF", 404);
      return c.json(error.body, error.status);
    }
    const file = profile.avatar?.file ?? "";
    const mime = file.endsWith(".png") ? "image/png" : file.endsWith(".webp") ? "image/webp" : "image/jpeg";
    return c.body(new Uint8Array(buffer), 200, { "Content-Type": mime, "Cache-Control": "no-store" });
  });
  app.get("/api/agents/:id/avatar", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const avatar = agent.avatar;
    if (avatar?.kind !== "image" || typeof avatar.file !== "string") {
      const error = problem("no_avatar", "\u672A\u8BBE\u7F6E\u56FE\u7247\u5934\u50CF", 404);
      return c.json(error.body, error.status);
    }
    const buffer = await readFile26(join32(agentsRoot2(), agent.id, "avatar", avatar.file)).catch(() => void 0);
    if (buffer === void 0) {
      const error = problem("no_avatar", "\u5934\u50CF\u6587\u4EF6\u4E0D\u5B58\u5728", 404);
      return c.json(error.body, error.status);
    }
    const mime = avatar.file.endsWith(".png") ? "image/png" : avatar.file.endsWith(".webp") ? "image/webp" : "image/jpeg";
    return c.body(buffer, 200, {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=31536000, immutable"
    });
  });
  app.get("/api/media/catalog", async (c) => {
    const kind = c.req.query("kind");
    if (kind !== void 0 && kind !== "avatar" && kind !== "emoji") {
      const error = problem("invalid_request", "kind \u53EA\u80FD\u662F avatar \u6216 emoji", 400);
      return c.json(error.body, error.status);
    }
    const limitRaw = c.req.query("limit");
    const limit = limitRaw === void 0 ? void 0 : Number.parseInt(limitRaw, 10);
    if (limit !== void 0 && (!Number.isFinite(limit) || limit <= 0)) {
      const error = problem("invalid_request", "limit \u5FC5\u987B\u662F\u6B63\u6570", 400);
      return c.json(error.body, error.status);
    }
    const catalog = await readCatalog(resolveHome());
    const items = searchEntries(catalog, {
      ...c.req.query("q") !== void 0 ? { query: c.req.query("q") } : {},
      ...kind !== void 0 ? { kind } : {},
      ...c.req.query("pack") !== void 0 ? { pack: c.req.query("pack") } : {},
      ...limit !== void 0 ? { limit } : {}
    });
    return c.json({ items, stats: await mediaStats(resolveHome()) });
  });
  app.get("/api/media/:id", async (c) => {
    const id = c.req.param("id");
    if (!isMediaId(id)) {
      const error = problem("invalid_media_id", "\u7D20\u6750 id \u4E0D\u5408\u6CD5", 400);
      return c.json(error.body, error.status);
    }
    const catalog = await readCatalog(resolveHome());
    const entry = findEntry(catalog, id);
    if (entry === void 0) {
      const error = problem("media_not_found", "\u627E\u4E0D\u5230\u8FD9\u4EF6\u7D20\u6750", 404);
      return c.json(error.body, error.status);
    }
    const buffer = await readMediaBytes(resolveHome(), entry);
    if (buffer === void 0) {
      const error = problem("media_file_missing", "\u7D20\u6750\u5DF2\u767B\u8BB0\u4F46\u6587\u4EF6\u4E0D\u89C1\u4E86", 404);
      return c.json(error.body, error.status);
    }
    return c.body(new Uint8Array(buffer), 200, {
      "Content-Type": entry.mime,
      "Cache-Control": "public, max-age=3600",
      "ETag": `"${entry.bytes}-${entry.addedAt}"`
    });
  });
  app.get("/api/models-config", async (c) => {
    const providers = await readModelsConfig();
    const settings = await readFile26(join32(resolveHome(), "config", "settings.json"), "utf8").then((text) => JSON.parse(text), () => null);
    const items = Object.entries(providers).map(([id, value]) => {
      const provider = value ?? {};
      return { id, baseUrl: typeof provider.baseUrl === "string" ? provider.baseUrl : "", models: Array.isArray(provider.models) ? provider.models : [] };
    });
    return c.json(stripSecrets({ providers: items, settings }));
  });
  app.get("/api/agents/:id/config", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const config = await readFile26(agentConfigPath(agent.id), "utf8").then((text) => JSON.parse(text), () => null);
    const resolved = await resolveModelChoice(agent.id);
    const effective = resolved?.choice === void 0 ? null : {
      ...resolved.choice,
      thinkingLevel: resolved.choice.defaultThinkingLevel ?? DEFAULT_PI_THINKING_LEVEL
    };
    return c.json({ config, effective, source: resolved?.source ?? null });
  });
  app.put("/api/agents/:id/config", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const body = await c.req.json().catch(() => void 0);
    if (body === void 0 || typeof body.defaultProvider !== "string" || body.defaultProvider.trim() === "" || typeof body.defaultModel !== "string" || body.defaultModel.trim() === "") {
      const error = problem("invalid_request", "\u9700\u8981 defaultProvider \u4E0E defaultModel\uFF08\u975E\u7A7A\u5B57\u7B26\u4E32\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const providerId = body.defaultProvider.trim();
    const modelId = body.defaultModel.trim();
    const providers = await readModelsProviders();
    if (providers[providerId] === void 0 || !providers[providerId].includes(modelId)) {
      const error = problem("model_not_found", `models.json \u91CC\u6CA1\u6709 ${providerId}/${modelId}`, 400);
      return c.json(error.body, error.status);
    }
    const config = {
      schemaVersion: 1,
      defaultProvider: providerId,
      defaultModel: modelId,
      ...typeof body.defaultThinkingLevel === "string" && body.defaultThinkingLevel !== "" ? { defaultThinkingLevel: body.defaultThinkingLevel } : {}
    };
    await mkdir17(join32(agentsRoot2(), agent.id, "projects", "workspace"), { recursive: true });
    await writeTextAtomic(agentConfigPath(agent.id), JSON.stringify(config, null, 2) + "\n");
    const applied = await applyAgentDefaultModel(agent.id, config.defaultProvider, config.defaultModel);
    const appliedThinking = config.defaultThinkingLevel === void 0 ? 0 : applyAgentDefaultThinking(agent.id, config.defaultThinkingLevel);
    broadcast({ type: "agents_changed" });
    return c.json({ config, applied, appliedThinking });
  });
  const fsError = (c, error) => c.json({ error: { code: error.code, message: error.message } }, error.status);
  app.get("/api/agents/:id/projects/:pid/tasks/:taskId/review-sources", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const pid = c.req.param("pid");
    const taskId = c.req.param("taskId");
    if (pid === void 0 || pid === "" || taskId === void 0 || taskId === "") {
      const error = problem("invalid_request", "\u9700\u8981 pid \u4E0E taskId", 400);
      return c.json(error.body, error.status);
    }
    const project = await resolveProject(agent, pid);
    if (project === void 0) {
      const error = problem("project_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A project", 404);
      return c.json(error.body, error.status);
    }
    const taskDir = await resolveTaskDir({ agentId: agent.id, projectId: project.id }, taskId);
    if (taskDir === void 0) {
      const error = problem("task_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A task", 404);
      return c.json(error.body, error.status);
    }
    const items = await locateSources(taskDir);
    return c.json({ taskDir, items });
  });
  app.post("/api/tasks/merge", async (c) => {
    const body = await c.req.json().catch(() => void 0);
    if (body === void 0 || typeof body.taskDir !== "string" || body.taskDir.trim() === "") {
      const error = problem("invalid_request", "\u9700\u8981 taskDir \u5B57\u6BB5\uFF08\u975E\u7A7A\u5B57\u7B26\u4E32\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const taskDir = body.taskDir.trim();
    if (!(await stat18(taskDir).catch(() => void 0))?.isDirectory()) {
      const error = problem("task_dir_not_found", `Task \u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${basename8(taskDir)}`, 404);
      return c.json(error.body, error.status);
    }
    const result = await mergeTask(taskDir);
    log.info("tasks", "merge", "\u5408\u5E76 Task \u5DE5\u4F5C\u533A", {
      details: { taskDir, ok: result.ok, steps: result.steps.map((step) => ({ kind: step.kind, status: step.status })) }
    });
    return c.json(result);
  });
  app.get("/api/agents/:id/projects/:pid/review-candidates", async (c) => {
    const agent = await readAgent(c.req.param("id"));
    if (agent === void 0) {
      const error = problem("agent_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A Agent", 404);
      return c.json(error.body, error.status);
    }
    const pid = c.req.param("pid");
    const project = await resolveProject(agent, pid);
    if (project === void 0) {
      const error = problem("project_not_found", "\u627E\u4E0D\u5230\u8FD9\u4E2A project", 404);
      return c.json(error.body, error.status);
    }
    const result = await listCandidates(agent.id, project.id);
    log.info("review-candidates", "list", "\u5217\u68C0\u89C6\u5019\u9009", {
      details: {
        agentId: agent.id,
        projectId: project.id,
        total: result.items.length,
        substantive: result.items.filter((item) => item.substantive).length,
        pendingForUser: result.items.reduce((sum, item) => sum + item.pendingForUser, 0),
        elapsedMs: result.elapsedMs
      }
    });
    return c.json({
      items: result.items.map((item) => ({
        taskId: item.taskId,
        title: item.title,
        type: item.type,
        status: item.status,
        taskDir: item.taskDir,
        hasWorktree: item.hasWorktree,
        worktreeChanged: item.worktreeChanged,
        docChangedFiles: item.docChangedFiles,
        docOnlyDaily: item.docOnlyDaily,
        substantive: item.substantive,
        commentsTotal: item.commentsTotal,
        openComments: item.openComments,
        pendingForUser: item.pendingForUser
      })),
      elapsedMs: result.elapsedMs
    });
  });
  app.post("/api/review/diff", async (c) => {
    const body = await c.req.json().catch(() => void 0);
    if (body === void 0 || typeof body.taskDir !== "string" || body.taskDir.trim() === "") {
      const error = problem("invalid_request", "\u9700\u8981 taskDir \u5B57\u6BB5\uFF08\u975E\u7A7A\u5B57\u7B26\u4E32\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const result = await computeReviewDiff(body.taskDir);
    if ("error" in result && result.error !== void 0) {
      const e = result.error;
      return c.json({ error: { code: e.code, message: e.message } }, e.status);
    }
    return c.json({ items: result.items });
  });
  app.get("/api/review/blob", async (c) => {
    const taskDir = c.req.query("taskDir");
    const source = c.req.query("source");
    const path = c.req.query("path");
    const side = c.req.query("side");
    if (taskDir === void 0 || taskDir.trim() === "" || source === void 0 || path === void 0 || side === void 0) {
      const error = problem("invalid_request", "\u9700\u8981 taskDir\u3001source\u3001path\u3001side \u56DB\u4E2A\u53C2\u6570", 400);
      return c.json(error.body, error.status);
    }
    const result = await readReviewBlob({ taskDir, source, path, side });
    if ("error" in result) {
      const e = result.error;
      return c.json({ error: { code: e.code, message: e.message } }, e.status);
    }
    return c.json(result);
  });
  app.get("/api/review/raw", async (c) => {
    const taskDir = c.req.query("taskDir");
    const source = c.req.query("source");
    const path = c.req.query("path");
    const side = c.req.query("side") ?? "new";
    if (taskDir === void 0 || taskDir.trim() === "" || source === void 0 || path === void 0) {
      const error = problem("invalid_request", "\u9700\u8981 taskDir\u3001source\u3001path \u4E09\u4E2A\u53C2\u6570\uFF08side \u9ED8\u8BA4 new\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const result = await readReviewRaw({ taskDir, source, path, side });
    if ("error" in result) {
      const e = result.error;
      return c.json({ error: { code: e.code, message: e.message } }, e.status);
    }
    return c.body(new Uint8Array(result.bytes), 200, {
      "content-type": result.contentType,
      // 私有缓存：同一 URL 在面板里会反复出现（同一文件多处引用）。
      // 但**不能长缓存**——文件内容会随编辑变化，路径不变，长缓存会显示旧图。
      "cache-control": "private, max-age=0, must-revalidate",
      "x-content-type-options": "nosniff"
    });
  });
  app.get("/api/review/comments", async (c) => {
    const taskDir = c.req.query("taskDir");
    if (taskDir === void 0 || taskDir.trim() === "") {
      const error = problem("invalid_request", "\u9700\u8981 taskDir \u67E5\u8BE2\u53C2\u6570\uFF08\u975E\u7A7A\u5B57\u7B26\u4E32\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const items = await readComments(taskDir);
    log.info("review-comments", "list", "\u8BFB\u53D6\u8BC4\u8BBA", { details: { taskDir: basename8(taskDir), count: items.length } });
    return c.json({ items });
  });
  app.post("/api/review/comments", async (c) => {
    const body = await c.req.json().catch(() => void 0);
    const taskDir = typeof body?.taskDir === "string" ? body.taskDir.trim() : "";
    if (taskDir === "") {
      const error = problem("invalid_request", "\u9700\u8981 taskDir \u5B57\u6BB5\uFF08\u975E\u7A7A\u5B57\u7B26\u4E32\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const op = body?.op;
    if (op !== "add" && op !== "update" && op !== "remove" && op !== "clear" && op !== "state" && op !== "reply" && op !== "reply-update" && op !== "reply-remove" && op !== "awaiting") {
      const error = problem("invalid_request", "op \u5FC5\u987B\u662F add / update / remove / clear / state / reply / reply-update / reply-remove / awaiting", 400);
      return c.json(error.body, error.status);
    }
    if (op === "reply" || op === "reply-update" || op === "reply-remove") {
      const id = typeof body?.id === "string" ? body.id : "";
      if (id === "") {
        const error = problem("invalid_request", `${op} \u9700\u8981 id\uFF08\u8BC4\u8BBA id\uFF09`, 400);
        return c.json(error.body, error.status);
      }
      const asActor = (raw) => {
        if (typeof raw !== "object" || raw === null) return void 0;
        const r = raw;
        if (r.kind !== "user" && r.kind !== "agent" || typeof r.id !== "string" || r.id === "") return void 0;
        return { kind: r.kind, id: r.id };
      };
      try {
        if (op === "reply-remove") {
          const replyId2 = typeof body.replyId === "string" ? String(body.replyId) : "";
          if (replyId2 === "") {
            const error = problem("invalid_request", "reply-remove \u9700\u8981 replyId", 400);
            return c.json(error.body, error.status);
          }
          const by = asActor(body.by);
          if (by === void 0) {
            const error = problem("invalid_request", "reply-remove \u9700\u8981 by { kind, id }", 400);
            return c.json(error.body, error.status);
          }
          const updated2 = await removeReply(taskDir, id, replyId2, by);
          log.info("review-comments", "reply-remove", "\u5220\u9664\u56DE\u590D", { details: { taskDir: basename8(taskDir), id, replyId: replyId2, by: `${by.kind}:${by.id}` } });
          return c.json({ comment: updated2 });
        }
        const replyRaw = body.reply;
        const replyObj = typeof replyRaw === "object" && replyRaw !== null ? replyRaw : void 0;
        if (replyObj === void 0 || typeof replyObj.body !== "string") {
          const error = problem("invalid_request", `${op} \u9700\u8981 reply:{ author, body }`, 400);
          return c.json(error.body, error.status);
        }
        const author = asActor(replyObj.author);
        if (author === void 0) {
          const error = problem("invalid_request", "reply.author \u9700\u8981 kind=user|agent \u4E0E\u975E\u7A7A id", 400);
          return c.json(error.body, error.status);
        }
        if (op === "reply") {
          const updated2 = await addReply(taskDir, id, { author, body: replyObj.body });
          log.info("review-comments", "reply", "\u8FFD\u52A0\u56DE\u590D", { details: { taskDir: basename8(taskDir), id, author: `${author.kind}:${author.id}`, replies: updated2.replies.length, awaiting: updated2.awaiting } });
          return c.json({ comment: updated2 }, 201);
        }
        const replyId = typeof replyObj.id === "string" ? replyObj.id : "";
        if (replyId === "") {
          const error = problem("invalid_request", "reply-update \u9700\u8981 reply.id", 400);
          return c.json(error.body, error.status);
        }
        const updated = await upsertReply(taskDir, id, { id: replyId, author, body: replyObj.body });
        log.info("review-comments", "reply-update", "\u7F16\u8F91\u56DE\u590D", { details: { taskDir: basename8(taskDir), id, replyId } });
        return c.json({ comment: updated });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const notFound = problem("comment_not_found", message, 404);
        return /找不到/.test(message) ? c.json(notFound.body, notFound.status) : c.json(problem("forbidden", message, 403).body, 403);
      }
    }
    if (op === "awaiting") {
      const id = typeof body?.id === "string" ? body.id : "";
      if (id === "") {
        const error = problem("invalid_request", "awaiting \u9700\u8981 id", 400);
        return c.json(error.body, error.status);
      }
      const raw = body.awaiting;
      if (raw !== "user" && raw !== "agent" && raw !== null) {
        const error = problem("invalid_request", "awaiting \u5FC5\u987B\u662F user / agent / null", 400);
        return c.json(error.body, error.status);
      }
      const byRaw = body.by;
      const by = typeof byRaw === "object" && byRaw !== null ? byRaw : void 0;
      const actor = by !== void 0 && (by.kind === "user" || by.kind === "agent") && typeof by.id === "string" && by.id !== "" ? { kind: by.kind, id: by.id } : void 0;
      if (actor === void 0) {
        const error = problem("invalid_request", "awaiting \u9700\u8981 by { kind, id }", 400);
        return c.json(error.body, error.status);
      }
      const updated = await setCommentAwaiting(taskDir, id, raw, actor);
      if (updated === void 0) {
        const error = problem("comment_not_found", "\u627E\u4E0D\u5230\u8FD9\u6761\u8BC4\u8BBA", 404);
        return c.json(error.body, error.status);
      }
      log.info("review-comments", "awaiting", "\u6539\u7B49\u5F85\u65B9", { details: { taskDir: basename8(taskDir), id, awaiting: raw, by: `${actor.kind}:${actor.id}` } });
      return c.json({ comment: updated });
    }
    if (op === "state") {
      const id = typeof body?.id === "string" ? body.id : "";
      const state = body?.state;
      const by = body?.by;
      if (id === "") {
        const error = problem("invalid_request", "state \u9700\u8981 id\uFF08\u975E\u7A7A\u5B57\u7B26\u4E32\uFF09", 400);
        return c.json(error.body, error.status);
      }
      if (state !== "draft" && state !== "open" && state !== "resolved") {
        const error = problem("invalid_request", "state \u5FC5\u987B\u662F draft / open / resolved", 400);
        return c.json(error.body, error.status);
      }
      if (typeof by !== "object" || by === null) {
        const error = problem("invalid_request", "state \u9700\u8981 by { kind, id }\uFF08\u8C01\u5728\u6539\uFF09", 400);
        return c.json(error.body, error.status);
      }
      const actor = by;
      if (actor.kind !== "user" && actor.kind !== "agent" || typeof actor.id !== "string" || actor.id === "") {
        const error = problem("invalid_request", "by \u9700\u8981 kind=user|agent \u4E0E\u975E\u7A7A id", 400);
        return c.json(error.body, error.status);
      }
      try {
        const updated = await setCommentState(taskDir, id, state, { kind: actor.kind, id: actor.id });
        if (updated === void 0) {
          const error = problem("comment_not_found", "\u627E\u4E0D\u5230\u8FD9\u6761\u8BC4\u8BBA", 404);
          return c.json(error.body, error.status);
        }
        log.info("review-comments", "state", "\u6539\u8BC4\u8BBA\u72B6\u6001", { details: { taskDir: basename8(taskDir), id, state, by: `${actor.kind}:${actor.id}` } });
        return c.json({ comment: updated });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const denied = problem("forbidden", message, 403);
        return c.json(denied.body, denied.status);
      }
    }
    if (op === "clear") {
      await clearComments(taskDir);
      log.info("review-comments", "clear", "\u6E05\u7A7A\u8BC4\u8BBA", { details: { taskDir: basename8(taskDir) } });
      return c.json({ cleared: true });
    }
    if (op === "remove") {
      const id = body?.id;
      if (typeof id !== "string" || id === "") {
        const error = problem("invalid_request", "remove \u9700\u8981 id\uFF08\u975E\u7A7A\u5B57\u7B26\u4E32\uFF09", 400);
        return c.json(error.body, error.status);
      }
      const removed = await removeComment(taskDir, id);
      log.info("review-comments", "remove", "\u5220\u9664\u8BC4\u8BBA", { details: { taskDir: basename8(taskDir), id, removed } });
      return c.json({ removed });
    }
    const declaredTaskId = typeof body?.comment?.taskId === "string" ? String(body.comment.taskId) : /^(\d{4})/.exec(basename8(taskDir))?.[1] ?? basename8(taskDir);
    const input = toCommentInput(body?.comment, declaredTaskId);
    if (input === void 0) {
      const error = problem("invalid_request", "comment \u5B57\u6BB5\u4E0D\u5408\u6CD5\uFF08\u9700\u8981 author/anchor{source,path,side,start,end}/body\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const saved = await upsertComment(taskDir, input);
    log.info("review-comments", "upsert", "\u5199\u5165\u8BC4\u8BBA", {
      details: {
        taskDir: basename8(taskDir),
        id: saved.id,
        author: `${saved.author.kind}:${saved.author.id}`,
        path: saved.anchor.path,
        range: `${saved.anchor.start}-${saved.anchor.end}`,
        state: saved.state
      }
    });
    return c.json({ comment: saved }, 201);
  });
  app.get("/api/review/viewed", async (c) => {
    const taskDir = c.req.query("taskDir");
    if (taskDir === void 0 || taskDir.trim() === "") {
      const error = problem("invalid_request", "\u9700\u8981 taskDir \u67E5\u8BE2\u53C2\u6570\uFF08\u975E\u7A7A\u5B57\u7B26\u4E32\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const items = await readViewed(taskDir);
    log.info("review-viewed", "list", "\u8BFB\u53D6\u5DF2\u770B\u8FDB\u5EA6", { details: { taskDir: basename8(taskDir), count: items.length } });
    return c.json({ items });
  });
  app.post("/api/review/viewed", async (c) => {
    const body = await c.req.json().catch(() => void 0);
    const taskDir = typeof body?.taskDir === "string" ? body.taskDir.trim() : "";
    if (taskDir === "") {
      const error = problem("invalid_request", "\u9700\u8981 taskDir \u5B57\u6BB5\uFF08\u975E\u7A7A\u5B57\u7B26\u4E32\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const taskId = /^(\d{4})/.exec(basename8(taskDir))?.[1] ?? basename8(taskDir);
    if (body?.op === "clear") {
      await clearViewed(taskDir);
      log.info("review-viewed", "clear", "\u6E05\u7A7A\u5DF2\u770B\u8FDB\u5EA6", { details: { taskDir: basename8(taskDir) } });
      return c.json({ cleared: true });
    }
    if (body?.op !== "set") {
      const error = problem("invalid_request", "op \u5FC5\u987B\u662F set / clear", 400);
      return c.json(error.body, error.status);
    }
    if (!Array.isArray(body.paths) || body.paths.length === 0) {
      const error = problem("invalid_request", "set \u9700\u8981\u975E\u7A7A\u7684 paths \u6570\u7EC4\uFF08\u6BCF\u9879 { path, hash }\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const entries = [];
    for (const raw of body.paths) {
      if (typeof raw !== "object" || raw === null) continue;
      const item = raw;
      if (typeof item.path !== "string" || item.path === "") continue;
      if (typeof item.hash !== "string" || item.hash === "") continue;
      entries.push({ path: item.path, hash: item.hash });
    }
    if (entries.length === 0) {
      const error = problem("invalid_request", "paths \u91CC\u6CA1\u6709\u4EFB\u4F55\u5408\u6CD5\u9879\uFF08\u9700\u8981 path \u4E0E\u975E\u7A7A hash\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const viewed = body.viewed !== false;
    const items = entries.length === 1 ? await setFileViewed(taskDir, taskId, entries[0].path, entries[0].hash, viewed) : await setFilesViewed(taskDir, taskId, entries, viewed);
    log.info("review-viewed", "set", "\u6807\u8BB0\u5DF2\u770B", {
      details: { taskDir: basename8(taskDir), count: entries.length, viewed, total: items.length }
    });
    return c.json({ items });
  });
  app.get("/api/attachment", async (c) => {
    const raw = c.req.query("path");
    const referenced = await referencedImagePaths(resolveHome());
    const result = await loadAttachmentForServe(raw, referenced);
    if ("code" in result) {
      log.warn("http", "attachment", "\u56FE\u7247\u53D6\u56DE\u88AB\u62D2", { details: { code: result.code } });
      const error = problem(result.code, result.message, result.status);
      return c.json(error.body, error.status);
    }
    return c.body(new Uint8Array(result.bytes), 200, {
      "Content-Type": result.mimeType,
      "Cache-Control": "private, max-age=0, must-revalidate",
      "ETag": `"${result.bytes.length}-${Math.round(result.mtimeMs)}"`
    });
  });
  app.get("/api/fs/roots", async (c) => c.json({ roots: await readRoots() }));
  app.post("/api/fs/roots", async (c) => {
    const body = await c.req.json().catch(() => void 0);
    if (body === void 0 || typeof body.path !== "string" || body.path.trim() === "") {
      const error = problem("invalid_request", "\u9700\u8981 path \u5B57\u6BB5\uFF08\u975E\u7A7A\u5B57\u7B26\u4E32\uFF09", 400);
      return c.json(error.body, error.status);
    }
    const result = await registerRoot(body.path);
    if ("code" in result) return fsError(c, result);
    return c.json({ roots: result.roots }, 201);
  });
  app.get("/api/fs/browse", async (c) => {
    const result = await browse(c.req.query("path"));
    if ("code" in result) return fsError(c, result);
    return c.json(result);
  });
  app.get("/api/fs/tree", async (c) => {
    const path = c.req.query("path");
    if (path === void 0 || path === "") {
      const error = problem("invalid_request", "\u9700\u8981 path \u67E5\u8BE2\u53C2\u6570", 400);
      return c.json(error.body, error.status);
    }
    const result = await listTree(path);
    if ("code" in result) return fsError(c, result);
    return c.json(result);
  });
  app.get("/api/fs/content", async (c) => {
    const path = c.req.query("path");
    if (path === void 0 || path === "") {
      const error = problem("invalid_request", "\u9700\u8981 path \u67E5\u8BE2\u53C2\u6570", 400);
      return c.json(error.body, error.status);
    }
    const result = await readContent(path);
    if ("code" in result) return fsError(c, result);
    return c.json(result);
  });
  const distOptions = {
    root: "./frontend/dist",
    onFound: (path, c) => {
      c.header("Cache-Control", cacheControlOf(c.req.path));
    }
  };
  app.use("/*", serveStatic(distOptions));
  app.get("/*", async (c, next) => {
    if (looksLikeFile(c.req.path)) return next();
    c.header("Cache-Control", REVALIDATE_CACHE);
    return serveStatic({ path: "./frontend/dist/index.html" })(c, next);
  });
  return app;
}

// src/main.ts
init_logging();
var portArg = process.argv.find((arg) => arg.startsWith("--port="));
var port = portArg === void 0 ? 43120 : Number(portArg.slice("--port=".length));
var proxySetup = await installProxyIfConfigured();
var home = resolveHome();
if (!await pathExists(home)) {
  console.error(`\u5BB6\u76EE\u5F55\u4E0D\u5B58\u5728\uFF1A${home}`);
  console.error("\u8BF7\u5148\u8FD0\u884C\uFF1Apnpm home:install");
  process.exit(1);
}
await initLogs();
await ensureMediaDir(home);
var server = createAdaptorServer({ fetch: createApp().fetch });
attachEventSocket(server);
server.listen(port, "127.0.0.1", () => {
  const info = server.address();
  console.log(`Life OS \u540E\u7AEF\u5DF2\u542F\u52A8: http://127.0.0.1:${info.port}\uFF08\u5BB6\u76EE\u5F55 ${home}\uFF09`);
  if (proxySetup.installed) {
    console.log(`\u51FA\u7AD9\u4EE3\u7406\u5DF2\u6309\u73AF\u5883\u53D8\u91CF\u542F\u7528\uFF1A${proxySetup.proxy}\uFF08NO_PROXY \u547D\u4E2D\u7684\u5730\u5740\u4ECD\u76F4\u8FDE\uFF09`);
  } else {
    console.log("\u51FA\u7AD9\u672A\u914D\u7F6E\u4EE3\u7406\uFF08\u6CA1\u6709 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY \u73AF\u5883\u53D8\u91CF\uFF09");
  }
});
