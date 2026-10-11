/**
 * Teyvat McD Oracle — 最小 MCP Streamable HTTP 客户端
 *
 * 零依赖：只用 Node 18+ 内置的 fetch / ReadableStream / AbortController。
 * 目标不是做一个通用 MCP SDK，而是让本项目「不装 WorkBuddy 也能跑」，
 * 从而证明它真实调用了麦当劳 MCP Server（https://mcp.mcd.cn）。
 *
 * 协议要点（MCP Streamable HTTP）：
 *   1. POST 一条 JSON-RPC 2.0 initialize，从响应头 mcp-session-id 拿到会话 ID
 *   2. POST 一条 notifications/initialized 通知（无 id，服务端不响应）
 *   3. 之后所有 tools/call 都带上 mcp-session-id
 *   4. 响应可能是 application/json，也可能是 text/event-stream（SSE），两种都要认
 */

export const DEFAULT_MCP_URL = 'https://mcp.mcd.cn';
export const CLIENT_INFO = { name: 'teyvat-mcd-oracle', version: '1.0.0' };

export class McpError extends Error {
  constructor(message, { stage = 'unknown', code = null } = {}) {
    super(message);
    this.name = 'McpError';
    this.stage = stage;
    this.code = code;
  }
}

export class McdMcpClient {
  #url;
  #token;
  #timeoutMs;
  #sessionId = null;
  #seq = 0;

  serverInfo = null;
  sessionId = null;

  constructor({ url = DEFAULT_MCP_URL, token, timeoutMs = 30000 } = {}) {
    if (!token) {
      throw new McpError(
        '缺少麦当劳 MCP Token。请设置环境变量 MCD_MCP_TOKEN，或加 --demo 走离线演示模式。',
        { stage: 'config' },
      );
    }
    this.#url = url;
    this.#token = token;
    this.#timeoutMs = timeoutMs;
  }

  /** 握手：initialize + notifications/initialized */
  async connect() {
    const result = await this.#rpc(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: CLIENT_INFO,
      },
      { stage: 'initialize' },
    );
    this.serverInfo = result?.serverInfo ?? null;

    // 通知类消息无 id，服务端按规范不回 body（回了也忽略）
    try {
      await this.#rpc('notifications/initialized', undefined, { notify: true, stage: 'initialized' });
    } catch {
      /* 部分实现直接返回 202 空 body，不影响后续调用 */
    }
    return result;
  }

  /** 列出服务端暴露的全部 tool（用于 doctor / 文档核验） */
  async listTools() {
    const result = await this.#rpc('tools/list', {}, { stage: 'tools/list' });
    return result?.tools ?? [];
  }

  /** 调用一个 tool，返回原始 MCP result */
  async callTool(name, args = {}) {
    return await this.#rpc('tools/call', { name, arguments: args }, { stage: `tools/call:${name}` });
  }

  /** 调用一个 tool 并解析出载荷（常见为 {code,message,data} 或裸对象） */
  async callToolJson(name, args = {}) {
    const result = await this.callTool(name, args);
    if (result?.isError) {
      const text = extractText(result);
      throw new McpError(`工具 ${name} 返回错误：${text || '(无错误详情)'}`, {
        stage: `tools/call:${name}`,
      });
    }
    const payload = parseToolPayload(result);
    const { code, message, data } = unwrap(payload);
    if (code && !/^(success|ok|0|200)$/i.test(String(code))) {
      throw new McpError(`工具 ${name} 业务失败 [${code}]：${message ?? '(无描述)'}`, {
        stage: `tools/call:${name}`,
        code,
      });
    }
    return data;
  }

  // ---------------------------------------------------------------- internals

  async #rpc(method, params, { notify = false, stage = method } = {}) {
    const body = {
      jsonrpc: '2.0',
      ...(notify ? {} : { id: ++this.#seq }),
      method,
      ...(params === undefined ? {} : { params }),
    };

    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${this.#token}`,
    };
    if (this.#sessionId) headers['mcp-session-id'] = this.#sessionId;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.#timeoutMs);

    let res;
    try {
      res = await fetch(this.#url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      const hint =
        err?.name === 'AbortError'
          ? `请求超时（${this.#timeoutMs}ms）`
          : `网络不可达或 DNS 失败`;
      throw new McpError(`${hint}：${err?.message ?? err}`, { stage });
    } finally {
      clearTimeout(timer);
    }

    // 服务端可能在建会话时下发 session id
    const sid = res.headers.get('mcp-session-id');
    if (sid) {
      this.#sessionId = sid;
      this.sessionId = sid;
    }

    if (notify) return null;

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const hint = res.status === 401 || res.status === 403 ? '（Token 无效或未授权）' : '';
      throw new McpError(
        `HTTP ${res.status} ${res.statusText}${hint}${detail ? ` — ${detail.slice(0, 300)}` : ''}`,
        { stage },
      );
    }

    const ctype = (res.headers.get('content-type') ?? '').toLowerCase();
    const msg = ctype.includes('text/event-stream')
      ? await readSseResult(res, body.id)
      : await readJsonResult(res);

    if (msg === null || msg === undefined) return null;
    if (msg.error) {
      throw new McpError(`MCP 错误 ${msg.error.code}: ${msg.error.message}`, {
        stage,
        code: msg.error.code,
      });
    }
    return msg.result ?? null;
  }
}

// ------------------------------------------------------------------ helpers

async function readJsonResult(res) {
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new McpError(`响应不是合法 JSON：${text.slice(0, 200)}`, { stage: 'parse' });
  }
}

async function readSseResult(res, id) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);

        const data = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('\n');
        if (!data || data === '[DONE]') continue;

        let msg;
        try {
          msg = JSON.parse(data);
        } catch {
          continue;
        }
        // 命中我们的请求 id：SSE 流可以就此关闭
        if (id === undefined || msg.id === id) return msg;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
  return null;
}

function extractText(result) {
  return (result?.content ?? [])
    .filter((c) => typeof c?.text === 'string')
    .map((c) => c.text)
    .join('\n');
}

/** MCP tool 返回体 → 结构化对象（尽力而为，容忍 string / JSON-in-text / 结构化 content） */
export function parseToolPayload(result) {
  if (result?.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent;
  }
  const text = extractText(result);
  if (!text) return null;
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return { _text: trimmed };
  try {
    return JSON.parse(trimmed);
  } catch {
    return { _text: trimmed };
  }
}

/** 拆掉 {code,message,data} 信封 */
export function unwrap(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'data' in payload) {
    const code = payload.code ?? payload.status?.code ?? null;
    const message = payload.message ?? payload.msg ?? payload.status?.message ?? null;
    return { code, message, data: payload.data };
  }
  return { code: null, message: null, data: payload };
}

// ------------------------------------------------- 形状无关的取值工具
// 麦当劳 MCP 各工具的返回字段名不统一，硬编码字段名很容易挂。
// 这里用「深度搜索 + 候选键」的方式取值，对返回结构变化免疫。

export function pick(obj, keys, fallback = undefined) {
  if (!obj || typeof obj !== 'object') return fallback;
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return fallback;
}

/** 深度优先寻找第一个满足 predicate 的值 */
export function deepFind(node, predicate, { maxDepth = 8, maxNodes = 20000 } = {}) {
  const queue = [{ v: node, d: 0 }];
  let seen = 0;
  while (queue.length) {
    const { v, d } = queue.shift();
    if (++seen > maxNodes) break;
    if (predicate(v)) return v;
    if (d >= maxDepth || v === null || typeof v !== 'object') continue;
    for (const child of Array.isArray(v) ? v : Object.values(v)) {
      if (child && typeof child === 'object') queue.push({ v: child, d: d + 1 });
    }
  }
  return undefined;
}

/** 取载荷里的「主列表」：先试候选键，再退化为深度搜索第一个非空对象数组 */
export function firstArray(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const k of keys) {
    if (Array.isArray(payload[k])) return payload[k];
  }
  const found = deepFind(
    payload,
    (v) => Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object'),
  );
  return found ?? [];
}

/**
 * 价格单位归一：麦当劳接口基本以「分」为单位，但个别列表页可能给「元」。
 * 用中位数做启发式判断，避免把 25 元当成 0.25 元。
 */
export function normalizeCents(raw, { assume = 'auto' } = {}) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (assume === 'cents') return Math.round(n);
  if (assume === 'yuan') return Math.round(n * 100);
  return n >= 500 ? Math.round(n) : Math.round(n * 100);
}

export function medianCents(values) {
  const nums = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!nums.length) return 0;
  return nums[Math.floor(nums.length / 2)];
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
