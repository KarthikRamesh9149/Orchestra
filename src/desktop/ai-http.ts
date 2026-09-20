import {lookup} from 'node:dns/promises';
import type {LookupAddress} from 'node:dns';
import type {LookupFunction} from 'node:net';
import {isIP} from 'node:net';
import {request, type RequestOptions} from 'node:https';
import type {ClientRequest, IncomingMessage} from 'node:http';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_EVENT_BYTES = 128 * 1024;
const SAFE_ERROR = 'The AI provider request could not be completed safely.';
const SAFE_URL_ERROR = 'Use a public HTTPS AI endpoint on port 443 without credentials, a query or a fragment.';
const HEADER_NAMES = new Set(['authorization', 'x-api-key', 'x-goog-api-key', 'anthropic-version', 'anthropic-beta', 'openai-beta', 'content-type', 'accept']);

function failure() { return new Error(SAFE_ERROR); }
function cancelled() { return new DOMException('AI request cancelled.', 'AbortError'); }
function checkAbort(signal: AbortSignal) { if (signal.aborted) throw cancelled(); }

// Fail closed for special-purpose ranges, including documentation, transition,
// benchmarking and multicast addresses. Ordinary IPv6 global unicast is 2000::/3.
// Registry: https://www.iana.org/assignments/iana-ipv4-special-registry/
// Registry: https://www.iana.org/assignments/iana-ipv6-special-registry/
function isPublicAddress(address: string): boolean {
  if (address.includes('%')) return false;
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168 ||
        (b === 31 && c === 196) || (b === 52 && c === 193) ||
        (b === 88 && c === 99) || (b === 175 && c === 48))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6) return false;
  const [first, second = '0', third = '0'] = address.toLowerCase().split(':');
  const a = parseInt(first, 16), b = parseInt(second || '0', 16), c = parseInt(third || '0', 16);
  return a >= 0x2000 && a <= 0x3fff &&
    !(a === 0x2001 && (b <= 0x1ff || b === 0xdb8)) &&
    a !== 0x2002 && !(a === 0x3fff && b <= 0xfff) &&
    !(a === 0x2620 && b === 0x4f && c === 0x8000);
}

function destination(value: string, allowStreamQuery: boolean): URL {
  try {
    if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/u.test(value) || !value.startsWith('https://')) throw failure();
    const url = new URL(value);
    const authority = value.slice(8).split(/[/?#]/, 1)[0];
    if (url.protocol !== 'https:' || url.username || url.password || authority.includes('@') ||
      url.port || value.includes('#') || (value.includes('?') && (!allowStreamQuery || url.search !== '?alt=sse'))) throw failure();
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host)) {
      if (!isPublicAddress(host)) throw failure();
    } else {
      if (host.length > 253 || !host.includes('.') || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
        /(?:^|\.)(?:localhost|local|internal|lan|home|onion|test|invalid|example|arpa)$/.test(host)) throw failure();
    }
    return url;
  } catch { throw new Error(SAFE_URL_ERROR); }
}

/** Validate persisted, untrusted configuration. DNS is rechecked at each request. */
export function validateDesktopAiBaseUrl(value: string): string {
  return destination(value, false).href.replace(/\/+$/, '');
}

async function resolvePublicAddress(url: URL, signal: AbortSignal): Promise<LookupAddress> {
  checkAbort(signal);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(host);
  if (family) return {address: host, family};
  const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(cancelled()); };
    signal.addEventListener('abort', abort, {once: true});
    // Promise handlers remain attached after cancellation: late DNS rejection
    // cannot escape, and no request is created until the abort check below.
    lookup(host, {all: true, verbatim: true}).then(resolve, () => reject(failure()))
      .finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
  checkAbort(signal);
  if (!addresses.length || addresses.length > 64 || addresses.some(entry =>
    !isPublicAddress(entry.address) || isIP(entry.address) !== entry.family)) throw failure();
  return addresses[0];
}

export interface DesktopAiHttpResponse {
  json(): Promise<unknown>;
  events(): AsyncIterable<unknown>;
}

function responseBody(response: IncomingMessage, mime: string, signal: AbortSignal, dispose: () => void): DesktopAiHttpResponse {
  let used = false;
  function claim(expected: string) {
    if (used || mime !== expected) { dispose(); throw failure(); }
    used = true;
    checkAbort(signal);
  }
  async function* chunks() {
    let total = 0;
    for await (const value of response) {
      checkAbort(signal);
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      total += chunk.byteLength;
      if (total > MAX_BODY_BYTES) throw failure();
      yield chunk;
    }
    checkAbort(signal);
    if (!response.complete) throw failure();
  }
  return {
    async json() {
      try {
        claim('application/json');
        const parts: Buffer[] = [];
        for await (const chunk of chunks()) parts.push(chunk);
        return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(parts)));
      } catch { throw signal.aborted ? cancelled() : failure(); }
      finally { dispose(); }
    },
    async *events() {
      try {
        claim('text/event-stream');
        const decoder = new TextDecoder('utf-8', {fatal: true});
        let pending = '', eventBytes = 0;
        let data: string[] = [];
        function* lines(final: boolean): Generator<string> {
          while (pending.length) {
            const end = pending.search(/[\r\n]/);
            if (end < 0 || (!final && pending[end] === '\r' && end === pending.length - 1)) break;
            const newline = pending[end] === '\r' && pending[end + 1] === '\n' ? 2 : 1;
            const line = pending.slice(0, end);
            eventBytes += Buffer.byteLength(line) + newline;
            if (eventBytes > MAX_EVENT_BYTES) throw failure();
            pending = pending.slice(end + newline);
            yield line;
          }
          if (eventBytes + Buffer.byteLength(pending) > MAX_EVENT_BYTES) throw failure();
        }
        function parseLine(line: string): {value: unknown} | {done: true} | undefined {
          if (line === '') {
            eventBytes = 0;
            if (!data.length) return;
            const payload = data.join('\n');
            data = [];
            if (payload === '[DONE]') return {done: true};
            return {value: JSON.parse(payload)};
          }
          if (line === 'data') data.push('');
          else if (line.startsWith('data:')) data.push(line.slice(line[5] === ' ' ? 6 : 5));
        }
        for await (const chunk of chunks()) {
          pending += decoder.decode(chunk, {stream: true});
          for (const line of lines(false)) {
            const event = parseLine(line);
            if (event && 'done' in event) return;
            if (event) yield event.value;
          }
        }
        pending += decoder.decode();
        for (const line of lines(true)) {
          const event = parseLine(line);
          if (event && 'done' in event) return;
          if (event) yield event.value;
        }
        // A partially delivered event is not a successful response.
        if (pending || data.length) throw failure();
      } catch { throw signal.aborted ? cancelled() : failure(); }
      finally { dispose(); }
    }
  };
}

/** Internal protocol adapter transport. Never pass user-supplied headers here.
 * Only Google's internally constructed `?alt=sse` query is permitted; saved base
 * URLs must separately pass validateDesktopAiBaseUrl. No proxy, retry or redirect.
 */
export async function postDesktopAi(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal): Promise<DesktopAiHttpResponse> {
  try {
    checkAbort(signal);
    const target = destination(url, true);
    const outgoing: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      const key = name.toLowerCase();
      if (!HEADER_NAMES.has(key) || Object.hasOwn(outgoing, key) || typeof value !== 'string' || value.length > 8192 || !/^[\x20-\x7e]+$/.test(value)) throw failure();
      outgoing[key] = value;
    }
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    if (payload.length > MAX_BODY_BYTES) throw failure();
    outgoing['content-type'] = 'application/json';
    outgoing['content-length'] = String(payload.length);
    outgoing['accept-encoding'] = 'identity';
    const address = await resolvePublicAddress(target, signal);
    checkAbort(signal);
    // DNS is never consulted again for this connection. Disable shared pooling
    // and automatic family selection so the checked address is the actual peer.
    const pinnedLookup: LookupFunction = (_host, options, callback) => {
      if (options.all) callback(null, [address]);
      else callback(null, address.address, address.family);
    };
    return await new Promise<DesktopAiHttpResponse>((resolve, reject) => {
      let req: ClientRequest | undefined, res: IncomingMessage | undefined;
      let closed = false;
      const dispose = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        res?.destroy();
        req?.destroy();
      };
      const fail = () => { dispose(); reject(signal.aborted ? cancelled() : failure()); };
      const abort = () => { dispose(); reject(cancelled()); };
      const timer = setTimeout(fail, 60_000);
      timer.unref();
      signal.addEventListener('abort', abort, {once: true});
      if (signal.aborted) { abort(); return; }
      try {
        const options: RequestOptions & {autoSelectFamily: boolean} = {
          method: 'POST', headers: outgoing, agent: false, lookup: pinnedLookup,
          family: address.family, autoSelectFamily: false, rejectUnauthorized: true,
          maxHeaderSize: 16 * 1024,
        };
        req = request(target, options, response => {
          res = response;
          // An error may arrive before a consumer begins body iteration.
          res.on('error', () => {});
          const mime = res.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
          const encoding = res.headers['content-encoding'];
          const length = res.headers['content-length'];
          if (closed || signal.aborted || !res.statusCode || res.statusCode < 200 || res.statusCode >= 300 ||
            (mime !== 'application/json' && mime !== 'text/event-stream') ||
            (encoding && encoding !== 'identity') ||
            (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES))) {
            response.destroy(); fail(); return;
          }
          resolve(responseBody(response, mime, signal, dispose));
        });
        req.on('error', fail);
        req.end(payload);
      } catch { fail(); }
    });
  } catch { throw signal.aborted ? cancelled() : failure(); }
}
