import {
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  type KeyObject,
} from 'node:crypto';

export type SigningKeys = {
  kid: string;
  privateKey: KeyObject;
  publicKeys: Map<string, KeyObject>;
};

type KeyEnv = {
  JWT_KID: string;
  JWT_PRIVATE_KEY: string;
  JWT_PUBLIC_KEY: string;
};

/**
 * ES256 key ring. The signer uses the current kid. Verification selects the
 * public key by the token's kid, so a previous public key can stay in the
 * ring until access tokens minted with it expire.
 */
export function loadSigningKeys(env: KeyEnv): SigningKeys {
  const kid = env.JWT_KID.trim();
  const privateKey = readPrivateKey(env.JWT_PRIVATE_KEY, 'JWT_PRIVATE_KEY');
  const publicKey = readPublicKey(env.JWT_PUBLIC_KEY, 'JWT_PUBLIC_KEY');
  assertPair(privateKey, publicKey);
  const publicKeys = new Map<string, KeyObject>([[kid, publicKey]]);

  const previousKid = optionalEnv('JWT_PREVIOUS_KID');
  const previousPublic = optionalEnv('JWT_PREVIOUS_PUBLIC_KEY');
  if (previousKid && previousPublic) {
    publicKeys.set(
      previousKid,
      readPublicKey(previousPublic, 'JWT_PREVIOUS_PUBLIC_KEY'),
    );
  } else if (previousKid || previousPublic) {
    throw keyError(
      'JWT_PREVIOUS_KID',
      'overlap rotation needs JWT_PREVIOUS_KID and JWT_PREVIOUS_PUBLIC_KEY together',
    );
  }

  return { kid, privateKey, publicKeys };
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function readPrivateKey(value: string, name: string): KeyObject {
  const pem = decodePem(value, name);
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'ec') {
      throw keyError(name, 'ES256 requires an EC private key');
    }
    if (key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw keyError(name, 'ES256 requires P-256 (prime256v1)');
    }
    return key;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Invalid environment')) {
      throw err;
    }
    throw keyError(name, 'must be a base64-encoded PKCS8 P-256 private key');
  }
}

function readPublicKey(value: string, name: string): KeyObject {
  const pem = decodePem(value, name);
  try {
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== 'ec') {
      throw keyError(name, 'ES256 requires an EC public key');
    }
    if (key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw keyError(name, 'ES256 requires P-256 (prime256v1)');
    }
    return key;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Invalid environment')) {
      throw err;
    }
    throw keyError(name, 'must be a base64-encoded SPKI P-256 public key');
  }
}

function assertPair(privateKey: KeyObject, publicKey: KeyObject): void {
  const data = Buffer.from('es256-pair-check');
  const signature = createSign('SHA256')
    .update(data)
    .sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });
  const matches = createVerify('SHA256')
    .update(data)
    .verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, signature);
  if (!matches) {
    throw keyError('JWT_PUBLIC_KEY', 'does not match JWT_PRIVATE_KEY');
  }
}

function decodePem(value: string, name: string): string {
  const pem = Buffer.from(value.trim(), 'base64').toString('utf8');
  if (!pem.includes('-----BEGIN ')) {
    throw keyError(name, 'must be a base64-encoded PEM');
  }
  return pem;
}

function keyError(name: string, message: string): Error {
  return new Error(
    `Invalid environment configuration:\n  ${name}: ${message}\nCompare your .env with .env.example.`,
  );
}
