import { log } from '~/lib/logger.server';
import {
  getEmulationHeaders,
  resolveGoogleDriveUrl,
  validateUrl,
} from '~/lib/server-utils';

export interface MediaFetchResult {
  buffer: Uint8Array;
  filename: string;
  fileSize: number;
}

export async function fetchMediaChunk(
  initialUrl: string,
  chunkSize: number = 10 * 1024 * 1024,
): Promise<MediaFetchResult> {
  const tStart = performance.now();
  const { url: targetUrl, isGoogleDrive } = resolveGoogleDriveUrl(initialUrl);

  if (isGoogleDrive) {
    log(`Converted Google Drive URL to: ${targetUrl}`);
  }

  validateUrl(targetUrl);

  // 1. HEAD Request
  log(`Starting HEAD request to: ${targetUrl}`);
  const tHead = performance.now();
  const headRes = await fetch(targetUrl, {
    method: 'HEAD',
    headers: getEmulationHeaders(),
    redirect: 'follow',
  });
  log(`HEAD request took ${Math.round(performance.now() - tHead)}ms`);

  log(`isGoogleDrive: ${isGoogleDrive}`);

  // Check for HTML content (indicates a webpage, not a direct file link)
  const contentType = headRes.headers.get('content-type');
  if (contentType?.includes('text/html')) {
    // If it's Google Drive, it might be the rate-limit page
    if (isGoogleDrive) {
      throw new Error(
        'Google Drive file is rate-limited. Try again in 24 hours.',
      );
    }
    // Generic HTML response
    throw new Error(
      'URL links to a webpage, not a media file. Provide a direct link.',
    );
  }

  if (!headRes.ok) {
    if (headRes.status === 404) {
      throw new Error('Media file not found. Check the URL.');
    } else if (headRes.status === 403) {
      throw new Error(
        'Access denied. The link may have expired or requires authentication.',
      );
    } else {
      throw new Error(`Unable to access file (HTTP ${headRes.status}).`);
    }
  }

  const fileSize = parseInt(headRes.headers.get('content-length') || '0', 10);
  log(`File size: ${fileSize} bytes`);
  if (!fileSize) throw new Error('Could not determine file size');

  // 2. Determine Filename
  let filename = targetUrl;
  const contentDisposition = headRes.headers.get('content-disposition');
  if (contentDisposition) {
    const starMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (starMatch && starMatch[1]) {
      try {
        filename = decodeURIComponent(starMatch[1]);
      } catch (e) {
        log('Failed to decode filename*:', 'warn', e);
      }
    } else {
      const normalMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
      if (normalMatch && normalMatch[1]) {
        filename = normalMatch[1];
      }
    }
  }
  log(`Resolved filename: ${filename}`);

  // 3. Fetch Content Chunk
  const fetchEnd = Math.min(chunkSize - 1, fileSize - 1);

  log(`Pre-fetching bytes 0-${fetchEnd}...`);
  const tFetch = performance.now();
  const response = await fetch(targetUrl, {
    headers: getEmulationHeaders(`bytes=0-${fetchEnd}`),
    redirect: 'follow',
  });
  log(
    `Fetch response header received in ${Math.round(performance.now() - tFetch)}ms. Status: ${response.status}`,
  );

  // Strategy: "Turbo Mode" vs "Eco Mode"
  // Debug Strategy: Always use stream reader to monitor progress
  // if (response.status === 206) {
  //   log(
  //     'Server accepted Range request (206). Using native optimized buffer.',
  //   );
  //   const tBuff = performance.now();
  //   try {
  //     const arrayBuffer = await response.arrayBuffer();
  //     log(
  //       `Range body downloaded/buffered in ${Math.round(performance.now() - tBuff)}ms`,
  //     );
  //     fileBuffer = new Uint8Array(arrayBuffer);
  //   } catch (e) {
  //     log('Failed to buffer range response:', 'error', e);
  //     throw e;
  //   }
  // } else {
  // STATUS 200 or 206 Generic Handler for Debugging
  log(
    `Response status ${response.status}. Using stream reader with progress logging.`,
  );

  const SAFE_LIMIT = 10 * 1024 * 1024; // 10MB "Eco Mode" limit
  const tempBuffer = new Uint8Array(SAFE_LIMIT); // Pre-allocate: Zero GC overhead
  let offset = 0;
  let lastLogOffset = 0;

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Failed to retrieve response body stream');

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const spaceLeft = SAFE_LIMIT - offset;

      if (value.byteLength > spaceLeft) {
        // Buffer full: Copy what fits, then stop.
        tempBuffer.set(value.subarray(0, spaceLeft), offset);
        offset += spaceLeft;
        log(`Hit safe limit of ${SAFE_LIMIT} bytes. Cancelling stream.`);
        await reader.cancel();
        break;
      } else {
        tempBuffer.set(value, offset);
        offset += value.byteLength;
      }

      // Log every ~1MB
      if (offset - lastLogOffset > 1024 * 1024) {
        const mb = (offset / (1024 * 1024)).toFixed(1);
        log(`Buffered ${mb}MB...`);
        lastLogOffset = offset;
      }
    }
  } catch (err) {
    log('Stream reading interrupted or failed:', 'warn', err);
  }

  // Create a view of the actual data we read (no copy)
  const fileBuffer = tempBuffer.subarray(0, offset);
  // }

  log(`Loaded ${fileBuffer.byteLength} bytes into memory.`);
  log(`Total fetch operation took ${Math.round(performance.now() - tStart)}ms`);

  return {
    buffer: fileBuffer,
    filename,
    fileSize,
  };
}
