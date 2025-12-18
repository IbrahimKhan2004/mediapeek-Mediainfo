export interface PrivateBinResponse {
  status: number;
  id: string;
  url: string;
  deletetoken: string;
  message?: string;
}

const privateBinHost = 'https://privatebin.net';

// Helper to encode ArrayBuffer to Base64 (Standard)
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Encrypt content using AES-GCM
// PrivateBin v2 format requires:
// - AES-256-GCM
// - Key derivation is NOT used for the random key we generate locally,
//   but we still need to provide standard parameters for the format.
// Actually, PrivateBin's "v2" format is quite specific.
// It typically uses a random master key (part of URL), then derives a DEK (Data Encryption Key) from it.
// However, the simplest way compatible with the specialized privatebin-client behavior is:
// 1. Generate a random 32-byte key (to be in the URL).
// 2. Encrypt the data with this key (or a derived one).
//
// Let's reverse engineer the exact minimal payload expected by `privatebin.net` for "v2" format.
// According to PrivateBin JS client:
// The "key" in the URL is base58 encoded (or base64 safe).
// The payload `adata` contains parameters.
//
// Simplified approach based on PrivateBin API spec:
// We will generate a random 256-bit key. This key will be the "URL key".
export async function uploadToPrivateBin(
  content: string,
): Promise<{ url: string; deleteUrl: string }> {
  // 1. Generate a random 256-bit key (32 bytes)
  const keyBytes = window.crypto.getRandomValues(new Uint8Array(32));

  // 2. Prepare encryption parameters
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
  const salt = window.crypto.getRandomValues(new Uint8Array(8)); // 64-bit salt
  const iterations = 100000;
  const keySize = 256;
  const tagSize = 128;

  // Import the random URL key as the "passphrase" raw key material
  const passphraseKey = await window.crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveKey', 'deriveBits'],
  );

  // Derive the actual encryption key using PBKDF2
  const cryptoKey = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: iterations,
      hash: 'SHA-256',
    },
    passphraseKey,
    { name: 'AES-GCM', length: keySize },
    false,
    ['encrypt'],
  );

  // PrivateBin v2 `adata` structure (Authenticated Data)
  // [ [iv, salt, iter, ks, ts, algo, mode, compression], format, open_discussion, burn_after_reading ]
  const cryptoParams = [
    arrayBufferToBase64(iv.buffer),
    arrayBufferToBase64(salt.buffer),
    iterations,
    keySize,
    tagSize,
    'aes',
    'gcm',
    'none',
  ];

  const adata = [
    cryptoParams,
    'plaintext', // format
    0, // open_discussion
    0, // burn_after_reading
  ];

  // Current PrivateBin implementation requires `adata` to be serialized to a string for GCM AAD
  // IMPORTANT: The server expects the JSON string of the `adata` array to be canonical (no spaces)
  // for AAD verification if it were to verify, but more importantly for the client to decrypt it later.
  // PrivateBin JS uses `JSON.stringify` which produces no spaces.
  const adataJson = JSON.stringify(adata);
  const adataBytes = new TextEncoder().encode(adataJson);

  // 3. Encrypt
  // Note: PrivateBin puts the `adata` into the AAD (Additional Authenticated Data)
  const encodedContent = new TextEncoder().encode(
    JSON.stringify({ paste: content }),
  );

  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
      additionalData: adataBytes,
      tagLength: 128,
    },
    cryptoKey,
    encodedContent,
  );

  // 4. Construct payload
  // The ciphertext includes the auth tag appended at the end in Web Crypto AES-GCM
  const ct = arrayBufferToBase64(encrypted);

  const payload = {
    v: 2,
    adata: adata,
    ct: ct,
    meta: {
      expire: '1week', // Default to 1 week
    },
  };

  // 5. Upload
  const response = await fetch(`${privateBinHost}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'JSONHttpRequest', // Trigger JSON API response
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('PrivateBin HTTP Error:', response.status, text);
    throw new Error(
      `PrivateBin upload failed: ${response.statusText} (${response.status})`,
    );
  }

  const result = (await response.json()) as PrivateBinResponse;

  if (result.status !== 0) {
    console.error(
      'PrivateBin API Error Status:',
      result.status,
      'Message:',
      result.message,
    );
    throw new Error(`PrivateBin error: Status ${result.status}`);
  }

  // 6. Construct URL
  // We need to base58 encode the keyBytes ideally, but many PrivateBin instances support other formats.
  // Standard PrivateBin usually uses Base58 for the key in the hash.
  // Let's implement a simple Base58 encoder or check if we can use another format.
  // Actually, standard PrivateBin URL hash is `#<key>`.
  // Using a custom Base58 encoder to match standard behavior.
  const keyBase58 = toBase58(keyBytes);

  return {
    url: `${privateBinHost}/?${result.id}#${keyBase58}`,
    deleteUrl: `${privateBinHost}/?pasteid=${result.id}&deletetoken=${result.deletetoken}`,
  };
}

// Simple Base58 encoder map
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function toBase58(bytes: Uint8Array): string {
  let z = 0;
  while (z < bytes.length && bytes[z] === 0) {
    z++;
  }

  const b58bytes: number[] = [];
  // Convert byte array to base58
  // This is a naive O(N^2) implementation but fine for 32 bytes
  for (let i = z; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < b58bytes.length; j++) {
      const x = b58bytes[j] * 256 + carry;
      b58bytes[j] = x % 58;
      carry = Math.floor(x / 58);
    }
    while (carry > 0) {
      b58bytes.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let str = '';
  // Leading zeros
  for (let i = 0; i < z; i++) {
    str += ALPHABET[0];
  }
  // Reverse and map
  for (let i = b58bytes.length - 1; i >= 0; i--) {
    str += ALPHABET[b58bytes[i]];
  }

  return str;
}
