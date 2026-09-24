import { clientAddressFromProxyHeaders } from './same-site';

function headers(values: Record<string, string>): {
  get(name: string): string | null;
} {
  return {
    get(name: string) {
      return values[name] ?? null;
    },
  };
}

describe('clientAddressFromProxyHeaders', () => {
  it('uses the nearest forwarded address and ignores a spoofed prefix', () => {
    expect(
      clientAddressFromProxyHeaders(
        headers({
          'x-forwarded-for': '1.2.3.4, 10.0.0.8',
          'cf-connecting-ip': '9.9.9.9',
        })
      )
    ).toBe('10.0.0.8');
  });

  it('uses the cloudflare client ip when no forwarded-for is present', () => {
    expect(
      clientAddressFromProxyHeaders(
        headers({ 'cf-connecting-ip': '203.0.113.9' })
      )
    ).toBe('203.0.113.9');
  });
});
