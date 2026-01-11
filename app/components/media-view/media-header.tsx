import { ExternalLink } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { OptionsMenu } from '~/components/media-view/options-menu';
import { Button } from '~/components/ui/button';
import { Separator } from '~/components/ui/separator';
import { getMediaBadges } from '~/lib/media-utils';
import { cn } from '~/lib/utils';
import type { MediaTrackJSON } from '~/types/media';

import { MediaIcon } from './media-icon';

interface MediaHeaderProps {
  generalTrack?: MediaTrackJSON;
  videoTracks: MediaTrackJSON[];
  audioTracks: MediaTrackJSON[];
  textTracks: MediaTrackJSON[];
  isTextView: boolean;
  setIsTextView: (val: boolean) => void;
  showOriginalTitles: boolean;
  setShowOriginalTitles: (val: boolean) => void;
  rawData: Record<string, string>;
  url: string;
}

export function MediaHeader({
  generalTrack,
  videoTracks,
  audioTracks,
  textTracks,
  isTextView,
  setIsTextView,
  showOriginalTitles,
  setShowOriginalTitles,
  rawData,
  url,
}: MediaHeaderProps) {
  const [privateBinUrl, setPrivateBinUrl] = useState<string | null>(null);

  const headerIcons = useMemo(
    () =>
      generalTrack
        ? getMediaBadges(videoTracks, audioTracks, textTracks, generalTrack)
        : [],
    [videoTracks, audioTracks, textTracks, generalTrack],
  );

  if (!generalTrack) return null;

  const filenameRaw =
    (generalTrack['CompleteName'] as string) ||
    (generalTrack['File_Name'] as string) ||
    'Unknown';
  // Extract basename
  const displayFilename =
    filenameRaw.split('/').pop()?.split('\\').pop() || filenameRaw;

  const fileSize =
    generalTrack['FileSize_String'] ||
    (generalTrack['FileSize/String'] as string) ||
    (generalTrack['FileSize'] as string);
  const duration =
    generalTrack['Duration_String'] ||
    (generalTrack['Duration/String'] as string) ||
    (generalTrack['Duration'] as string);

  return (
    <div className="bg-background/95 supports-backdrop-filter:bg-background/60 sticky top-0 z-50 -mx-4 flex flex-col gap-4 px-4 pt-4 pb-0 backdrop-blur-md transition-all md:-mx-8 md:px-8">
      <div className="flex flex-col items-start gap-2 md:gap-4">
        <h1 className="text-lg font-bold tracking-tight break-all md:text-2xl">
          {displayFilename}
        </h1>
        <div className="text-muted-foreground flex w-full flex-wrap items-center gap-4 text-sm">
          {duration && <span>{duration}</span>}
          {fileSize && (
            <>
              <span className="opacity-30">|</span>
              <span>{fileSize}</span>
            </>
          )}

          {/* Icons & Options */}
          <div className="border-border flex flex-wrap items-center gap-3 sm:flex-1 sm:border-l sm:pl-4">
            {headerIcons.length > 0 &&
              headerIcons.map((icon) => (
                <MediaIcon
                  key={icon}
                  name={icon}
                  className="h-5 opacity-90 transition-opacity hover:opacity-100"
                />
              ))}

            {/* Actions */}
            <div className="ml-auto flex items-center gap-2">
              {/* Dynamic Open Button */}
              <OpenPrivateBinButton key={privateBinUrl} url={privateBinUrl} />

              <OptionsMenu
                data={rawData}
                url={url}
                isTextView={isTextView}
                setIsTextView={setIsTextView}
                showOriginalTitles={showOriginalTitles}
                setShowOriginalTitles={setShowOriginalTitles}
                onShareSuccess={setPrivateBinUrl}
              />
            </div>
          </div>
        </div>
      </div>
      <Separator />
    </div>
  );
}

function OpenPrivateBinButton({ url }: { url: string | null }) {
  // Start false to allow "fade in" from default state
  const [isHighlighted, setIsHighlighted] = useState(false);

  useEffect(() => {
    if (url) {
      // Small delay to trigger the transition (fade in)
      const enterTimer = setTimeout(() => setIsHighlighted(true), 100);

      // Fade out after 5 seconds
      const exitTimer = setTimeout(() => setIsHighlighted(false), 5100);

      return () => {
        clearTimeout(enterTimer);
        clearTimeout(exitTimer);
      };
    }
  }, [url]);

  if (!url) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className={cn(
        'animate-in fade-in h-9 gap-2 px-3 text-xs transition-all duration-1000 ease-in-out',
        isHighlighted
          ? 'ring-offset-background border-green-500 ring-2 ring-green-500 ring-offset-2'
          : 'ring-0 ring-transparent', // Fade back to default border (handled by variant) and no ring
      )}
      onClick={() => window.open(url, '_blank')}
    >
      <ExternalLink className="h-3.5 w-3.5" />
      <span>Open in PrivateBin</span>
    </Button>
  );
}
