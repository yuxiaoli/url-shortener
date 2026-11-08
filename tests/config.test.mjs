import test from 'node:test';
import assert from 'node:assert/strict';
import {parseConfig, validateConfig, validPath, MAX_LINKS} from '../src/config.mjs';
const config = (redirects = []) => ({schemaVersion: 1, publicOrigin: 'https://s.vectorindex.cloud', redirects});
test('validates, sorts and normalizes destinations', () => {
  assert.deepEqual(validateConfig(config([{path: '/z', target: 'https://example.com'}, {path: '/a/docs', target: 'https://example.org/x?q=1#top'}])).redirects,
    [{path: '/a/docs', target: 'https://example.org/x?q=1#top'}, {path: '/z', target: 'https://example.com/'}]);
});
test('empty map is valid locally; publishing is a separate guarded action', () => assert.equal(validateConfig(config()).redirects.length, 0));
test('duplicate paths are rejected instead of silently overwritten', () => assert.throws(() => validateConfig(config([{path:'/x',target:'https://example.com'}, {path:'/x',target:'https://example.org'}])), /Duplicate/));
test('invalid and ambiguous short paths are rejected', () => {
  for (const path of ['x', '//x', '/a/', '/a/../b', '/a.b', '/%61', '/a?x', '/a#x', '/a b', '/中文', '/' + 'a'.repeat(161)]) assert.equal(validPath(path), false, path);
  for (const path of ['/', '/a', '/a/b', '/a_B-2']) assert.equal(validPath(path), true, path);
});
test('unsafe destinations are rejected without fetching them', () => {
  for (const target of ['javascript:alert(1)', 'data:text/html,hello', '//example.com', 'ftp://example.com',
    'https://user:pass@example.com', 'https://example.com\n', 'https://example.com/%0d%0aHeader:x',
    'https://example.com\\@evil.com', 'http://localhost', 'https://127.0.0.1', 'https://0x7f000001',
    'https://2130706433', 'https://[::1]', 'https://host.local', 'https://host.internal',
    'https://example.com:8443', 'https://s.vectorindex.cloud/x', 'http://s.vectorindex.cloud./x']) {
    assert.throws(() => validateConfig(config([{path:'/x',target}])), undefined, target);
  }
});
test('full public HTTP and HTTPS URLs are supported', () => {
  assert.equal(validateConfig(config([{path:'/x',target:'http://example.com/old'}])).redirects[0].target, 'http://example.com/old');
});
test('unknown fields and versions fail closed', () => {
  for (const input of [{...config(),schemaVersion:2}, {...config(),secret:'no'}, {schemaVersion:1}, null, [], config([{path:'/x',target:'https://example.com',extra:true}])]) assert.throws(() => validateConfig(input));
});
test('origin must be exact HTTPS origin', () => {
  for (const publicOrigin of ['http://s.vectorindex.cloud', 'https://s.vectorindex.cloud/', 'https://x:y@s.vectorindex.cloud', 'https://s.vectorindex.cloud:8443']) assert.throws(() => validateConfig({...config(),publicOrigin}));
});
test('invalid JSON, excessive count and oversized input are rejected', () => {
  assert.throws(() => parseConfig('{bad'));
  assert.throws(() => parseConfig(' '.repeat(262145)));
  assert.throws(() => validateConfig(config(Array.from({length:MAX_LINKS+1},(_,i)=>({path:`/${i}`,target:'https://example.com'})))));
});
