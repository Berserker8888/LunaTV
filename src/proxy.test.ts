/** @jest-environment node */

import { shouldSkipAuth } from './proxy';

describe('proxy public PWA assets', () => {
  it.each([
    '/offline.html',
    '/splash/splash-750x1334.png',
    '/screenshot1.png',
    '/screenshot2.png',
    '/screenshot3.png',
  ])('allows %s without authentication', (pathname) => {
    expect(shouldSkipAuth(pathname)).toBe(true);
  });

  it('does not retain the obsolete screenshot path exception', () => {
    expect(shouldSkipAuth('/screenshot.png')).toBe(false);
  });

  it.each([
    '/_next',
    '/_next/static/chunks/app.js',
    '/favicon.ico',
    '/sw.js',
    '/icons/icon.png',
  ])('allows %s without authentication', (pathname) => {
    expect(shouldSkipAuth(pathname)).toBe(true);
  });

  it.each([
    '/loginxxx',
    '/_nextxxx',
    '/sw.js.evil',
    '/favicon.ico.bak',
    '/api/login2',
  ])('does not allow prefix-squatting path %s', (pathname) => {
    expect(shouldSkipAuth(pathname)).toBe(false);
  });
});
