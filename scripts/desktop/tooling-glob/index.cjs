'use strict';

// Build-tool compatibility only. No code from Picomatch's regexp compiler
// is present here. Callers use the matcher, isMatch, or the lexical scan.
const { Minimatch } = require('minimatch');

function matcher(patterns, options = {}) {
  const useWindows = options.windows ?? (!options.posix && process.platform === 'win32');
  const normalize = (value) => (useWindows ? value.replaceAll('\\', '/') : value).replace(/^\.\//, '');
  const compiled = (Array.isArray(patterns) ? patterns : [patterns]).map((pattern) => {
    const source = pattern.replace(/^\.\//, '');
    return new Minimatch(source, {
      dot: options.dot,
      flipNegate: options.flipNegate,
      matchBase: options.matchBase || options.basename,
      nobrace: options.nobrace,
      nocase: options.nocase,
      nocomment: true,
      noext: options.noext || options.noextglob,
      noglobstar: options.noglobstar,
      // An initial !(...) is a group, not a negation of the whole path.
      nonegate: options.nonegate || source.startsWith('!('),
      optimizationLevel: 0,
      platform: useWindows ? 'win32' : process.platform === 'win32' ? 'linux' : process.platform,
    });
  });
  const ignore = options.ignore ? matcher(options.ignore, { ...options, ignore: undefined }) : null;
  return (input) => {
    if (typeof input !== 'string') throw new TypeError('A pathname must be a string');
    if (!input || ignore?.(input)) return false;
    const path = normalize(input);
    return compiled.some((pattern) =>
      pattern.match(path) || (!options.strictSlashes && path.endsWith('/') && pattern.match(path.slice(0, -1))));
  };
}

// tinyglobby uses parts for safe pruning; Vite uses the fixed path prefix
// for discovery. Slashes inside braces, groups and escapes are not boundaries.
function scan(input, options = {}) {
  let prefixEnd = 0;
  let negated = false;
  if (!options.nonegate) {
    while (input[prefixEnd] === '!' && input[prefixEnd + 1] !== '(') {
      negated = true;
      prefixEnd++;
    }
  }
  if (input.startsWith('./', prefixEnd)) prefixEnd += 2;

  const body = input.slice(prefixEnd);
  const starts = [0];
  const groups = [];
  let magic = Infinity;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    const frame = groups.at(-1);
    if (frame?.end === ']') {
      if (ch === ']') {
        groups.pop();
        magic = Math.min(magic, frame.part);
      }
      continue;
    }
    if (frame?.end === ch) {
      groups.pop();
      continue;
    }
    const part = starts.at(-1);
    if (ch === '/' && !frame) starts.push(i + 1);
    else if (ch === '*' || ch === '?') magic = Math.min(magic, part);
    else if (ch === '{') groups.push({ end: '}', part });
    else if (ch === '[') groups.push({ end: ']', part });
    else if (ch === '(' && !options.noparen) {
      groups.push({ end: ')', part });
      magic = Math.min(magic, part);
    } else if (frame?.end === '}' && (ch === ',' || (ch === '.' && body[i + 1] === '.'))) {
      magic = Math.min(magic, frame.part);
    }
  }
  const isGlob = magic !== Infinity;
  return {
    input,
    prefix: input.slice(0, prefixEnd),
    base: isGlob ? body.slice(0, magic === 1 && body.startsWith('/') ? 1 : Math.max(0, magic - 1)) : body,
    glob: isGlob ? body.slice(magic) : '',
    isGlob,
    negated,
    negatedExtglob: body.startsWith('!('),
    ...(options.parts ? { parts: starts.map((start, index) => body.slice(start, index + 1 === starts.length ? undefined : starts[index + 1] - 1)) } : {}),
  };
}

matcher.isMatch = (input, patterns, options) => matcher(patterns, options)(input);
matcher.scan = scan;
module.exports = matcher;
