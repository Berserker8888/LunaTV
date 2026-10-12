import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'node:util';
import {
  ReadableStream,
  TransformStream,
  WritableStream,
} from 'node:stream/web';

// 注意：不要在這裡全域 polyfill fetch／Response。曾嘗試用 undici 補齊，
// 結果有兩個問題：undici 的 Response body stream 在 jest fake timers 下
// 第二個 read() 永遠不回 done；而且 fetch 存在後，未 mock 的程式路徑會
// 真的打出外部網路請求（之前 ReferenceError 反而是安全網）。
// 需要假 Response 的測試請在檔內用 node:stream/web 自建，
// 需要假 fetch 的測試請在檔內 jest.mock／覆寫 global.fetch。

Object.defineProperty(globalThis, 'TextDecoder', {
  configurable: true,
  value: TextDecoder,
});
Object.defineProperty(globalThis, 'TextEncoder', {
  configurable: true,
  value: TextEncoder,
});
Object.defineProperty(globalThis, 'ReadableStream', {
  configurable: true,
  value: ReadableStream,
});
Object.defineProperty(globalThis, 'TransformStream', {
  configurable: true,
  value: TransformStream,
});
Object.defineProperty(globalThis, 'WritableStream', {
  configurable: true,
  value: WritableStream,
});
// React scheduler 只需要 postMessage/onmessage。Node 的原生 MessageChannel
// 會留下 worker_threads handle，讓 Jest 在測試完成後無法退出。
class TestMessageChannel {
  constructor() {
    this.port1 = { onmessage: null };
    this.port2 = {
      postMessage: (data) => {
        setTimeout(() => this.port1.onmessage?.({ data }), 0);
      },
    };
  }
}
Object.defineProperty(globalThis, 'MessageChannel', {
  configurable: true,
  value: TestMessageChannel,
});
// undici (via url-safety) expects MessagePort in jsdom environments.
if (typeof globalThis.MessagePort === 'undefined') {
  Object.defineProperty(globalThis, 'MessagePort', {
    configurable: true,
    value: function MessagePort() {},
  });
}

// Polyfill USERNAME env var for Linux/CI environments
process.env.USERNAME = process.env.USERNAME || 'admin';

