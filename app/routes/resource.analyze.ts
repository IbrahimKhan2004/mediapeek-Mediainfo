import mediaInfoFactory from '../lib/mediaInfoFactory';
// @ts-expect-error - Missing types for WASM import
import mediaInfoWasm from '../wasm/MediaInfoModule.wasm';
import type { Route } from './+types/resource.analyze';

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  let targetUrl = url.searchParams.get('url');

  let isGoogleDrive = false;

  if (targetUrl) {
    const googleDriveRegex =
      /https:\/\/drive\.google\.com\/file\/d\/([-a-zA-Z0-9_]+)\/view/;
    const match = targetUrl.match(googleDriveRegex);
    if (match && match[1]) {
      isGoogleDrive = true;
      const fileId = match[1];
      targetUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`;
      console.log(`[Analyze] Converted Google Drive URL to: ${targetUrl}`);
    } else if (targetUrl.includes('drive.usercontent.google.com')) {
      isGoogleDrive = true;
    }
  }

  if (!targetUrl) {
    return Response.json({ error: 'Missing URL parameters' }, { status: 400 });
  }

  // 1. Define Helper for Emulation Headers (Same as Proxy)
  const getEmulationHeaders = (range?: string) => {
    const headers = new Headers();
    if (range) headers.set('Range', range);
    headers.set(
      'accept',
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    );
    headers.set('accept-language', 'en-US,en;q=0.9');
    headers.set('priority', 'u=0, i');
    headers.set(
      'sec-ch-ua',
      '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
    );
    headers.set('sec-ch-ua-mobile', '?0');
    headers.set('sec-ch-ua-platform', '"macOS"');
    headers.set('sec-fetch-dest', 'document');
    headers.set('sec-fetch-mode', 'navigate');
    headers.set('sec-fetch-site', 'none');
    headers.set('sec-fetch-user', '?1');
    headers.set('upgrade-insecure-requests', '1');
    headers.set(
      'user-agent',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    );
    return headers;
  };

  try {
    // 2. Initial HEAD Request for Size
    const headRes = await fetch(targetUrl, {
      method: 'HEAD',
      headers: getEmulationHeaders(),
      redirect: 'follow',
    });

    console.log(`[Analyze] isGoogleDrive: ${isGoogleDrive}`);
    if (isGoogleDrive) {
      const contentType = headRes.headers.get('content-type');
      console.log(`[Analyze] Content-Type: ${contentType}`);
      if (contentType && contentType.includes('text/html')) {
        throw new Error(
          'Google Drive Error: This file is likely rate-limited or shared with too many people. Please try again later (up to 24h).',
        );
      }
    }

    if (!headRes.ok) throw new Error(`Failed to HEAD: ${headRes.status}`);

    // Handle redirects manually if needed, but 'follow' usually works.
    // If strict 403, might need cookies? But usually headers are enough.

    const fileSize = parseInt(headRes.headers.get('content-length') || '0', 10);
    console.log(`[Analyze] File size: ${fileSize} bytes`);
    if (!fileSize) throw new Error('Could not determine file size');

    // 3. Pre-fetch first 50MB (or less if file is smaller)
    const CHUNK_SIZE = 50 * 1024 * 1024; // 50MB
    const fetchEnd = Math.min(CHUNK_SIZE - 1, fileSize - 1);

    console.log(`[Analyze] Pre-fetching bytes 0-${fetchEnd}...`);
    const response = await fetch(targetUrl, {
      headers: getEmulationHeaders(`bytes=0-${fetchEnd}`),
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch initial chunk: ${response.status} ${response.statusText}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const fileBuffer = new Uint8Array(arrayBuffer);
    console.log(`[Analyze] Loaded ${fileBuffer.byteLength} bytes into memory.`);

    // 4. Setup MediaInfo ReadChunk logic (Memory-only)
    const readChunk = async (size: number, offset: number) => {
      // console.log(`[Analyze] readChunk: offset=${offset}, size=${size}`);

      if (offset >= fileBuffer.byteLength) {
        // Requested data is beyond our downloaded chunk.
        // Return empty to simulate EOF (truncation).
        return new Uint8Array(0);
      }

      // Slice from memory
      const end = Math.min(offset + size, fileBuffer.byteLength);
      const chunk = fileBuffer.subarray(offset, end);
      return chunk;
    };

    // 5. Instantiate MediaInfo
    let mediainfo;
    let isMinimal = false;
    let format = url.searchParams.get('format') || 'text';

    if (format === 'minimal') {
      format = 'JSON';
      isMinimal = true;
    }

    try {
      mediainfo = await mediaInfoFactory({
        format,
        coverData: false,
        full: false,
        chunkSize: 5 * 1024 * 1024, // 5MB (Keep <10MB to avoid OOM on 128MB Free Plan limits)
        wasmModule: mediaInfoWasm,
        locateFile: () => 'ignored', // Not used when wasmModule is provided
      });
    } catch (e) {
      console.error('Failed to load MediaInfo/WASM:', e);
      return Response.json(
        {
          error: 'Failed to initialize MediaInfo on server',
          details: String(e),
        },
        { status: 500 },
      );
    }

    // 5. Analyze
    let result = await mediainfo.analyzeData(() => fileSize, readChunk);
    mediainfo.close();

    if (isMinimal) {
      try {
        const jsonResult = JSON.parse(result);
        result = formatMinimal(jsonResult);
      } catch (e) {
        console.error('Failed to parse MediaInfo JSON for minimal format:', e);
        // Fallback to text if parsing fails, although result is likely raw JSON string
        result = 'Error formatting minimal output. Raw JSON:\n' + result;
      }
    }

    return Response.json({ result });
  } catch (error) {
    console.error('Server-side Analysis Error:', error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Unknown Server Error',
      },
      { status: 500 },
    );
  }
}

// Helper Formatting Logic
interface MediaInfoTrack {
  '@type': string;
  Format?: string;
  Format_Profile?: string;
  Format_Info?: string; // e.g. "Advanced Video Codec"
  FileSize?: string; // 21.5 GiB
  Duration_String1?: string; // 1 h 23 min
  Duration_String?: string;
  Duration?: string;
  FrameRate?: string;
  FrameRate_String?: string; // 23.976 FPS or (24000/1001)
  BitRate_String?: string;
  BitRate?: string;
  Width?: string;
  Height?: string;
  DisplayAspectRatio_String?: string; // 2.40:1
  PixelAspectRatio?: string;
  Channels_String?: string; // 6 channels
  Channels?: string;
  SamplingRate_String?: string; // 48.0 kHz
  Title?: string;
  Language_String?: string; // English
  Language?: string;
  Encoded_Application?: string; // mkvmerge v95.0...
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

interface MediaInfoResult {
  media?: {
    track: MediaInfoTrack[];
  };
}

// Helper to separate keys
function formatKey(key: string) {
  return key.replace(/_/g, ' ');
}

function formatMinimal(data: MediaInfoResult): string {
  if (!data?.media?.track) return 'No media tracks found.';

  const tracks = data.media.track;
  const lines: string[] = [];

  // Group tracks by type
  const general = tracks.find((t) => t['@type'] === 'General');
  const videos = tracks.filter((t) => t['@type'] === 'Video');
  const audios = tracks.filter((t) => t['@type'] === 'Audio');
  const texts = tracks.filter((t) => t['@type'] === 'Text');
  const menus = tracks.filter((t) => t['@type'] === 'Menu');

  // 1. General
  if (general) {
    lines.push('General');
    if (general.Format) lines.push(`Format: ${general.Format}`);
    if (general.FileSize) lines.push(`FileSize: ${general.FileSize}`);
    // Prefer Duration_String1 or Duration_String
    const duration = general.Duration_String1 || general.Duration_String;
    if (duration) lines.push(`Duration: ${duration}`);

    if (general.FrameRate) lines.push(`FrameRate: ${general.FrameRate}`);
    if (general.Encoded_Application)
      lines.push(
        `${formatKey('Encoded_Application')}: ${general.Encoded_Application}`,
      );
  }

  if (general) lines.push(''); // Spacer

  // 2. Video
  videos.forEach((video, index) => {
    lines.push(videos.length > 1 ? `Video #${index + 1}` : 'Video');
    if (video.Format) lines.push(`Format: ${video.Format}`);
    if (video.Format_Profile)
      lines.push(`${formatKey('Format_Profile')}: ${video.Format_Profile}`);
    if (video.BitRate_String)
      lines.push(`${formatKey('BitRate_String')}: ${video.BitRate_String}`);

    if (video.Width) lines.push(`Width: ${video.Width}`);
    if (video.Height) lines.push(`Height: ${video.Height}`);

    if (video.DisplayAspectRatio_String)
      lines.push(
        `${formatKey('DisplayAspectRatio_String')}: ${video.DisplayAspectRatio_String}`,
      );

    if (video.FrameRate_String)
      lines.push(`${formatKey('FrameRate_String')}: ${video.FrameRate_String}`);
    else if (video.FrameRate) lines.push(`FrameRate: ${video.FrameRate}`);

    lines.push(''); // Spacer after each video track
  });

  // 3. Audio
  audios.forEach((audio, index) => {
    lines.push(`Audio #${index + 1}`);
    const lang = audio.Language_String || audio.Language;
    if (lang) lines.push(`Language: ${lang}`); // Language is key
    if (audio.Format) lines.push(`Format: ${audio.Format}`);
    if (audio.Channels_String)
      lines.push(`${formatKey('Channels_String')}: ${audio.Channels_String}`);
    if (audio.BitRate_String)
      lines.push(`${formatKey('BitRate_String')}: ${audio.BitRate_String}`);
    if (audio.Title) lines.push(`Title: ${audio.Title}`);

    lines.push(''); // Spacer
  });

  // 4. Subtitle (Text)
  texts.forEach((text, index) => {
    lines.push(texts.length > 1 ? `Subtitle #${index + 1}` : 'Subtitle');
    const lang = text.Language_String || text.Language;
    if (lang) lines.push(`Language: ${lang}`);
    if (text.Format) lines.push(`Format: ${text.Format}`);
    if (text.BitRate_String)
      lines.push(`${formatKey('BitRate_String')}: ${text.BitRate_String}`);
    if (text.Title) lines.push(`Title: ${text.Title}`);

    lines.push(''); // Spacer
  });

  // 5. Chapters (Menu)
  menus.forEach((menu) => {
    // Trying to find time-based keys
    const timeRegex = /^\d{2}:\d{2}:\d{2}/;
    const chapterKeys = Object.keys(menu).filter((k) => timeRegex.test(k));

    if (chapterKeys.length > 0) {
      lines.push('Chapters');
      chapterKeys.sort().forEach((k) => {
        const val = menu[k] as string;
        lines.push(`${k}: ${val}`);
      });
      lines.push('');
    }
  });

  return lines.join('\n').trim();
}
