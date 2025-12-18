import { Check, ChevronDown } from 'lucide-react';

import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';

interface FormatMenuProps {
  value: string;
  onChange: (value: string) => void;
}

const formats = [
  { value: 'text', label: 'Text' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'HTML', label: 'HTML' },
  { value: 'XML', label: 'XML' },
  { value: 'JSON', label: 'JSON' },
];

export function FormatMenu({ value, onChange }: FormatMenuProps) {
  const selectedFormat = formats.find((f) => f.value === value) || formats[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-[140px] justify-between">
          {selectedFormat.label}
          <ChevronDown className="opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[140px]">
        {formats.map((format) => (
          <DropdownMenuItem
            key={format.value}
            onClick={() => onChange(format.value)}
          >
            <span className="flex-1">{format.label}</span>
            {value === format.value && <Check className="ml-2 h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
