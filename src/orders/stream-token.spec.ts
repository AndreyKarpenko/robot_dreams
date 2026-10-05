import { signStreamToken, verifyStreamToken } from './stream-token';

describe('stream token', () => {
  const previous = process.env.STREAM_TOKEN_SECRET;

  beforeEach(() => {
    process.env.STREAM_TOKEN_SECRET = 'test-stream-token-secret';
  });

  afterAll(() => {
    if (previous == null) {
      delete process.env.STREAM_TOKEN_SECRET;
    } else {
      process.env.STREAM_TOKEN_SECRET = previous;
    }
  });

  it('returns the buyer id from a token this process signed', () => {
    const token = signStreamToken('5');
    expect(verifyStreamToken(token)).toBe('5');
  });

  it('rejects a client-supplied user id and a tampered payload', () => {
    expect(verifyStreamToken('5')).toBeUndefined();

    const token = signStreamToken('5');
    const [payload, sig] = token.split('.');
    const flipped = Buffer.from(payload, 'base64url').toString('utf8');
    const tampered = Buffer.from(
      flipped.replace('"uid":"5"', '"uid":"9"'),
      'utf8',
    ).toString('base64url');
    expect(verifyStreamToken(`${tampered}.${sig}`)).toBeUndefined();
  });

  it('rejects an expired token', () => {
    const token = signStreamToken('5', 1_000);
    expect(verifyStreamToken(token, 1_000 + 8 * 24 * 60 * 60 * 1000)).toBe(
      undefined,
    );
  });
});
