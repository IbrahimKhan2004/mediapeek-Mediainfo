import { log } from '~/lib/logger.server';
import MediaInfoFactory from '~/lib/mediaInfoFactory';

export interface MediaInfoResult {
  [key: string]: string;
}

export type MediaInfoFormat = 'object' | 'Text' | 'XML' | 'HTML';

export async function analyzeMediaBuffer(
  fileBuffer: Uint8Array,
  fileSize: number,
  filename: string,
  requestedFormats: string[] = [],
): Promise<MediaInfoResult> {
  const tStart = performance.now();
  log(`Starting analysis for ${filename} (${fileSize} bytes)`);

  const readChunk = async (size: number, offset: number) => {
    if (offset >= fileBuffer.byteLength) {
      return new Uint8Array(0);
    }
    const end = Math.min(offset + size, fileBuffer.byteLength);
    return fileBuffer.subarray(offset, end);
  };

  const shouldGenerateAll =
    requestedFormats.includes('all') || requestedFormats.length === 0;

  const allFormats: { type: MediaInfoFormat; key: string }[] = [
    { type: 'object', key: 'json' },
    { type: 'Text', key: 'text' },
    { type: 'XML', key: 'xml' },
    { type: 'HTML', key: 'html' },
  ];

  const formatsToGenerate = allFormats.filter(
    (f) =>
      shouldGenerateAll ||
      requestedFormats.includes(f.key) ||
      requestedFormats.includes(f.type.toLowerCase()),
  );

  const results: Record<string, string> = {};

  // Generate formats sequentially to save memory/CPU
  // Default to JSON if no format specified effectively
  if (formatsToGenerate.length === 0) {
    formatsToGenerate.push({ type: 'object', key: 'json' });
  }

  let infoInstance;
  try {
    // Initialize MediaInfo once
    // Use the first requested format as initial, or fallback to JSON
    const initialFormat = formatsToGenerate[0]?.type || 'object';

    let wasmModule;
    const tWasm = performance.now();
    try {
      // @ts-expect-error - Missing types for WASM import
      const imported = await import('../wasm/MediaInfoModule.wasm');
      wasmModule = imported.default;
    } catch (err) {
      log('Failed to load WASM module dynamically:', 'warn', err);
    }
    log(`WASM module loaded in ${Math.round(performance.now() - tWasm)}ms`);

    const tFactory = performance.now();
    infoInstance = await MediaInfoFactory({
      format:
        initialFormat === 'Text'
          ? 'text'
          : (initialFormat as 'object' | 'XML' | 'HTML' | 'text'),
      coverData: false,
      full: false, // Initial setting, will be overridden in the loop
      chunkSize: 5 * 1024 * 1024,
      wasmModule,
      locateFile: () => 'ignored',
    });
    log(
      `MediaInfo instance created in ${Math.round(performance.now() - tFactory)}ms`,
    );

    for (const { type, key } of formatsToGenerate) {
      const tFormat = performance.now();
      try {
        log(`Generating format: ${type}...`);
        // Use 'text' (lowercase) for Text view to match MediaInfo expectation
        const formatStr = type === 'Text' ? 'text' : type;

        infoInstance.options.format = formatStr as 'object';
        // Enable full output (internal tags) for object/JSON view AND Text view
        infoInstance.options.full = Boolean(
          type === 'object' || type === 'Text',
        );

        infoInstance.reset();

        // For 'object' format, analyzeData returns the result directly.
        // For others, we need to call inform().
        const resultData = await infoInstance.analyzeData(
          () => fileSize,
          readChunk,
        );
        let resultStr = '';

        if (type !== 'object') {
          resultStr = infoInstance.inform();
        }

        if (type === 'object') {
          try {
            const json = resultData;

            if (json && json.media && json.media.track) {
              const generalTrack = json.media.track.find(
                (t: Record<string, unknown>) => t['@type'] === 'General',
              );
              if (generalTrack) {
                if (
                  !generalTrack['CompleteName'] &&
                  !generalTrack['Complete_name'] &&
                  !generalTrack['File_Name']
                ) {
                  generalTrack['CompleteName'] = filename;
                }
              }
            }
            results[key] = JSON.stringify(json, null, 2);
          } catch (e) {
            log('Failed to process object result:', 'warn', e);
            results[key] = '{}';
          }
        } else if (type === 'Text') {
          if (!resultStr.includes('Complete name')) {
            // Injection logic for text
            const lines = resultStr.split('\n');
            const generalIndex = lines.findIndex((l: string) =>
              l.trim().startsWith('General'),
            );
            if (generalIndex !== -1) {
              let insertIndex = generalIndex + 1;
              for (let i = generalIndex + 1; i < lines.length; i++) {
                if (lines[i].trim().startsWith('Unique ID')) {
                  insertIndex = i + 1;
                  break;
                }
                if (lines[i].trim() === '') break;
              }
              const padding = ' '.repeat(41 - 'Complete name'.length);
              lines.splice(
                insertIndex,
                0,
                `Complete name${padding}: ${filename}`,
              );
              resultStr = lines.join('\n');
            }
          }
          results[key] = resultStr;
        } else {
          results[key] = resultStr;
        }
        log(
          `Generated ${type} in ${Math.round(performance.now() - tFormat)}ms`,
        );
      } catch (err) {
        log(`Failed to generate ${type}:`, 'error', err);
        results[key] = `Error generating ${type} view.`;
      }
    }
  } catch (error) {
    log('MediaInfo Analysis execution failed:', 'error', error);
    throw error;
  } finally {
    if (infoInstance) {
      infoInstance.close();
    }
  }

  log(
    `Total analysis completed in ${Math.round(performance.now() - tStart)}ms`,
  );
  return results;
}
