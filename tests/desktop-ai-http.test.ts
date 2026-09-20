import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {IncomingMessage} from 'node:http';
import type {RequestOptions} from 'node:https';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({lookup: vi.fn(), request: vi.fn()}));
vi.mock('node:dns/promises', () => ({lookup: mocks.lookup}));
vi.mock('node:https', () => ({request: mocks.request}));
import {postDesktopAi, validateDesktopAiBaseUrl} from '../src/desktop/ai-http.js';

const target = 'https://api.provider.com/v1/responses';
const secret = 'synthetic-secret-not-for-errors';
const controller = () => new AbortController();
function network(body: string | Buffer | null = '{}', mime = 'application/json', statusCode = 200, extraHeaders = {}) {
  const response = Object.assign(new PassThrough(), {
    statusCode, headers: {'content-type': mime, ...extraHeaders}, complete: body !== null,
  });
  const request = Object.assign(new EventEmitter(), {end: vi.fn(), destroy: vi.fn()});
  request.end.mockImplementation(() => queueMicrotask(() => {
    const callback = mocks.request.mock.calls.at(-1)![2] as (response: IncomingMessage) => void;
    callback(response as unknown as IncomingMessage);
    if (body !== null) response.end(body);
  }));
  mocks.request.mockReturnValue(request);
  return {response, request};
}
async function post(signal = controller().signal) {
  return postDesktopAi(target, {Authorization: `Bearer ${secret}`}, {prompt: 'private prompt'}, signal);
}
async function collect(events: AsyncIterable<unknown>) {
  const result: unknown[] = [];
  for await (const event of events) result.push(event);
  return result;
}

beforeEach(() => {
  mocks.lookup.mockReset().mockResolvedValue([{address: '93.184.216.34', family: 4}]);
  mocks.request.mockReset();
});
afterEach(() => { vi.useRealTimers(); });

describe('desktop AI endpoint validation', () => {
  it.each([
    ['https://api.provider.com/', 'https://api.provider.com'],
    ['https://api.provider.com:443/v1///', 'https://api.provider.com/v1'],
    ['https://API.PROVIDER.COM/v1', 'https://api.provider.com/v1'],
    ['https://8.8.8.8/v1', 'https://8.8.8.8/v1'],
    ['https://[2606:4700:4700::1111]/v1', 'https://[2606:4700:4700::1111]/v1'],
  ])('normalizes public endpoint %s', (value, expected) => expect(validateDesktopAiBaseUrl(value)).toBe(expected));

  it.each([
    'http://api.provider.com', 'https://api.provider.com:444/v1', 'https://user:password@api.provider.com',
    'https://@api.provider.com', 'https://api.provider.com?key=secret', 'https://api.provider.com?',
    'https://api.provider.com?alt=sse', 'https://api.provider.com#fragment', 'https://api.provider.com#',
    'https://localhost', 'https://localhost.', 'https://api.local', 'https://api.internal',
    'https://api.lan', 'https://api.home.arpa', 'https://api.onion', 'https://api.test',
    'https://api.invalid', 'https://api.example', 'https://printer',
    ' https://api.provider.com', 'https://api.provider.com\n', 'https://api.provider.com\\@127.0.0.1',
    'https://127.1', 'https://2130706433', 'https://0x7f000001', 'https://0177.0.0.1',
    'https://0.0.0.0', 'https://10.1.2.3', 'https://100.64.0.1', 'https://127.0.0.1',
    'https://169.254.169.254', 'https://172.16.0.1', 'https://192.168.0.1',
    'https://192.0.0.1', 'https://192.0.2.1', 'https://192.88.99.1', 'https://198.18.0.1',
    'https://198.51.100.1', 'https://203.0.113.1', 'https://224.0.0.1', 'https://255.255.255.255',
    'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://[fc00::1]', 'https://[fe80::1]',
    'https://[2001:db8::1]', 'https://[2001::1]', 'https://[2002:7f00:1::]', 'https://[3fff::1]',
    'https://[64:ff9b::7f00:1]', 'https://[ff02::1]',
  ])('rejects unsafe endpoint %s without leaking supplied values', value => {
    expect(() => validateDesktopAiBaseUrl(value)).toThrow('Use a public HTTPS AI endpoint');
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

describe('desktop AI pinned HTTPS boundary', () => {
  it('resolves once and pins that public address without proxies, redirects or pooled sockets', async () => {
    const {request} = network('{"ok":true}');
    const result = await post();
    expect(await result.json()).toEqual({ok: true});
    expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith('api.provider.com', {all: true, verbatim: true});
    const [url, options] = mocks.request.mock.calls[0] as [URL, RequestOptions];
    expect(url.href).toBe(target);
    expect(options).toMatchObject({method: 'POST', agent: false, family: 4, autoSelectFamily: false, rejectUnauthorized: true, maxHeaderSize: 16384});
    expect(options.headers).toMatchObject({authorization: `Bearer ${secret}`, 'content-type': 'application/json', 'accept-encoding': 'identity'});
    expect(request.end).toHaveBeenCalledWith(Buffer.from('{"prompt":"private prompt"}'));
    mocks.lookup.mockResolvedValue([{address: '127.0.0.1', family: 4}]);
    const callback = vi.fn();
    options.lookup!('api.provider.com', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    const allCallback = vi.fn();
    options.lookup!('api.provider.com', {all: true}, allCallback);
    expect(allCallback).toHaveBeenCalledWith(null, [{address: '93.184.216.34', family: 4}]);
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    expect(request.destroy).toHaveBeenCalled();
  });

  it.each(['127.0.0.1', '10.0.0.2', '169.254.169.254', '198.51.100.2', '::1', '::ffff:10.0.0.1', '2001:db8::2', '3fff::2'])('sends nothing when any DNS answer is nonpublic: %s', async address => {
    mocks.lookup.mockResolvedValue([{address: '93.184.216.34', family: 4}, {address, family: address.includes(':') ? 6 : 4}]);
    await expect(post()).rejects.toThrow('could not be completed safely');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each([
    {answers: []},
    {answers: [{address: 'bad-address', family: 4}]},
    {answers: [{address: '93.184.216.34', family: 6}]},
    {answers: [{address: '2606:4700:4700::1111%lo0', family: 6}]},
  ])('fails closed on malformed DNS answers %#', async ({answers}) => {
    mocks.lookup.mockResolvedValue(answers);
    await expect(post()).rejects.toThrow('could not be completed safely');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('rejects a DNS error without exposing its message', async () => {
    mocks.lookup.mockRejectedValue(new Error(secret));
    await expect(post()).rejects.toThrow('The AI provider request could not be completed safely.');
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('uses public literal addresses directly and supports public IPv6 DNS answers', async () => {
    network();
    await (await postDesktopAi('https://8.8.8.8/v1', {}, {}, controller().signal)).json();
    expect(mocks.lookup).not.toHaveBeenCalled();
    mocks.lookup.mockResolvedValue([{address: '2606:4700:4700::1111', family: 6}]);
    network();
    await (await post()).json();
    expect(mocks.request.mock.calls[1][1]).toMatchObject({family: 6});
  });

  it.each([301, 302, 307, 308, 401, 429, 500])('rejects status %s without following Location or reading provider errors', async status => {
    const {response} = network(secret, 'application/json', status, {location: 'https://127.0.0.1/secret'});
    await expect(post()).rejects.toThrow('The AI provider request could not be completed safely.');
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(response.destroyed).toBe(true);
  });

  it('allows only the native SSE query and preserves encoded model path components', async () => {
    network('data: [DONE]\n\n', 'text/event-stream');
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/model%2Fname%2Bpreview:streamGenerateContent?alt=sse';
    expect(await collect((await postDesktopAi(url, {'x-goog-api-key': secret}, {}, controller().signal)).events())).toEqual([]);
    expect(mocks.request.mock.calls[0][0].href).toBe(url);
    for (const query of ['?alt=sse&key=secret', '?key=secret', '?alt=SSE', '?alt=sse&alt=sse']) {
      await expect(postDesktopAi(`${target}${query}`, {}, {}, controller().signal)).rejects.toThrow();
    }
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it.each(['Host', 'Proxy-Authorization', 'Forwarded', 'Cookie', 'Connection', 'Content-Length', 'X-Custom-Header'])('rejects unrecognised internal headers: %s', async name => {
    await expect(postDesktopAi(target, {[name]: secret}, {}, controller().signal)).rejects.toThrow();
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('rejects newline injection, duplicate authorization and oversized requests before network activity', async () => {
    await expect(postDesktopAi(target, {Authorization: `${secret}\r\nHost: local`}, {}, controller().signal)).rejects.toThrow();
    await expect(postDesktopAi(target, {Authorization: secret, authorization: secret}, {}, controller().signal)).rejects.toThrow();
    await expect(postDesktopAi(target, {}, {prompt: 'a'.repeat(2 * 1024 * 1024)}, controller().signal)).rejects.toThrow();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it('supports a 4096-character configured key plus Bearer prefix with an 8192-character header ceiling', async () => {
    for (const value of [`Bearer ${'s'.repeat(4096)}`, 's'.repeat(8192)]) {
      network();
      await (await postDesktopAi(target, {Authorization: value}, {}, controller().signal)).json();
      expect(mocks.request.mock.calls.at(-1)![1].headers.authorization).toBe(value);
    }
    await expect(postDesktopAi(target, {Authorization: 's'.repeat(8193)}, {}, controller().signal)).rejects.toThrow();
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
});

describe('desktop AI cancellation and body lifecycle', () => {
  it('does not resolve or send after pre-cancellation', async () => {
    const abort = controller(); abort.abort(secret);
    await expect(post(abort.signal)).rejects.toMatchObject({name: 'AbortError', message: 'AI request cancelled.'});
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('cancels pending DNS promptly and never sends after DNS eventually returns', async () => {
    let finish!: (value: unknown) => void;
    mocks.lookup.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const abort = controller();
    const result = post(abort.signal);
    abort.abort();
    await expect(result).rejects.toMatchObject({name: 'AbortError'});
    finish([{address: '93.184.216.34', family: 4}]);
    await Promise.resolve(); await Promise.resolve();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('destroys a request cancelled before response headers arrive', async () => {
    const {request} = network(null);
    request.end.mockImplementation(() => {});
    const abort = controller();
    const result = post(abort.signal);
    await vi.waitFor(() => expect(request.end).toHaveBeenCalled());
    abort.abort();
    await expect(result).rejects.toMatchObject({name: 'AbortError'});
    expect(request.destroy).toHaveBeenCalled();
  });

  it('sanitizes connection and certificate failures', async () => {
    const {request} = network(null);
    request.end.mockImplementation(() => queueMicrotask(() => request.emit('error', new Error(secret))));
    await expect(post()).rejects.toThrow('The AI provider request could not be completed safely.');
    expect(request.destroy).toHaveBeenCalled();
  });

  it('destroys a pending response on cancellation, including before body iteration starts', async () => {
    const {response, request} = network(null);
    const abort = controller();
    const result = await post(abort.signal);
    abort.abort(secret);
    expect(response.destroyed).toBe(true);
    expect(request.destroy).toHaveBeenCalled();
    await expect(result.json()).rejects.toMatchObject({name: 'AbortError'});
  });

  it('cancels a stalled body and never exposes the signal reason', async () => {
    const {response} = network(null);
    const abort = controller();
    const result = (await post(abort.signal)).json();
    abort.abort(secret);
    await expect(result).rejects.toMatchObject({name: 'AbortError', message: 'AI request cancelled.'});
    expect(response.destroyed).toBe(true);
  });

  it('destroys the body on an early consumer break', async () => {
    const {response, request} = network(null, 'text/event-stream');
    const result = await post();
    response.write('data: {"value":1}\n\n');
    for await (const value of result.events()) { expect(value).toEqual({value: 1}); break; }
    expect(response.destroyed).toBe(true);
    expect(request.destroy).toHaveBeenCalled();
  });

  it('bounds stalled network lifetime even when a consumer never opens the body', async () => {
    vi.useFakeTimers();
    const {response, request} = network(null);
    const result = await post();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(response.destroyed).toBe(true);
    expect(request.destroy).toHaveBeenCalled();
    await expect(result.json()).rejects.toThrow('could not be completed safely');
  });
});

describe('desktop AI bounded JSON and SSE', () => {
  it.each(['text/html', 'text/plain', 'application/octet-stream'])('rejects MIME %s before consumption', async mime => {
    const {response} = network(secret, mime);
    await expect(post()).rejects.toThrow(); expect(response.destroyed).toBe(true);
  });

  it('rejects compressed and declared-oversized responses', async () => {
    network('{}', 'application/json', 200, {'content-encoding': 'gzip'});
    await expect(post()).rejects.toThrow();
    network('{}', 'application/json', 200, {'content-length': String(2 * 1024 * 1024 + 1)});
    await expect(post()).rejects.toThrow();
  });

  it('accepts JSON with MIME parameters and prevents duplicate reads', async () => {
    network('{"value":1}', 'application/json; charset=utf-8');
    const result = await post();
    expect(await result.json()).toEqual({value: 1});
    await expect(result.json()).rejects.toThrow();
  });

  it('requires the method to match the declared MIME', async () => {
    network('{}', 'application/json');
    await expect(collect((await post()).events())).rejects.toThrow();
    network('data: {}\n\n', 'text/event-stream');
    await expect((await post()).json()).rejects.toThrow();
  });

  it.each([Buffer.from([0xff]), Buffer.from('{"secret":'), Buffer.from('"' + 'x'.repeat(2 * 1024 * 1024) + '"')])('rejects malformed, invalid UTF8 or oversized JSON %#', async body => {
    const {response} = network(body);
    await expect((await post()).json()).rejects.toThrow('could not be completed safely');
    expect(response.destroyed).toBe(true);
  });

  it('accepts a valid JSON body exactly at the raw size limit', async () => {
    const value = 'x'.repeat(2 * 1024 * 1024 - 2);
    network(JSON.stringify(value));
    expect(await (await post()).json()).toBe(value);
  });

  it('parses multiline SSE, comments, CRLF, split UTF8 and DONE without yielding control frames', async () => {
    const {response} = network(null, 'text/event-stream; charset=utf-8');
    const result = collect((await post()).events());
    const bytes = Buffer.from(': heartbeat\r\nevent: delta\r\ndata: {"text":\r\ndata: "é🍊"}\r\n\r\ndata: {"next":true}\r\rdata: [DONE]\n\n');
    for (const byte of bytes) { response.write(Buffer.from([byte])); await Promise.resolve(); }
    expect(await result).toEqual([{text: 'é🍊'}, {next: true}]);
    expect(response.destroyed).toBe(true);
  });

  it.each(['data: {"secret":}\n\n', 'data: {"value":1}', 'data: {"value":1}\n'])('rejects invalid JSON and truncated SSE event %#', async body => {
    const {response} = network(body, 'text/event-stream');
    await expect(collect((await post()).events())).rejects.toThrow('could not be completed safely');
    expect(response.destroyed).toBe(true);
  });

  it('accepts complete SSE events at EOF without a DONE frame', async () => {
    network('event: message_stop\ndata: {"type":"message_stop"}\n\n', 'text/event-stream');
    expect(await collect((await post()).events())).toEqual([{type: 'message_stop'}]);
  });

  it('rejects oversized SSE events, including ignored/comment fields', async () => {
    for (const body of [`data: "${'x'.repeat(128 * 1024)}"\n\n`, `:${'x'.repeat(128 * 1024)}\n\n`]) {
      const {response} = network(body, 'text/event-stream');
      await expect(collect((await post()).events())).rejects.toThrow();
      expect(response.destroyed).toBe(true);
    }
  });

  it('enforces the total raw SSE bound even across small valid events', async () => {
    const {response} = network('data: {}\n\n'.repeat(210_000), 'text/event-stream');
    await expect(collect((await post()).events())).rejects.toThrow();
    expect(response.destroyed).toBe(true);
  });

  it('rejects transport truncation even when buffered JSON is syntactically complete', async () => {
    const {response} = network('{}');
    response.complete = false;
    await expect((await post()).json()).rejects.toThrow();
  });

  it('does not expose body errors from the provider', async () => {
    const {response} = network(null);
    const result = (await post()).json();
    response.destroy(new Error(secret));
    await expect(result).rejects.toThrow('The AI provider request could not be completed safely.');
  });
});
