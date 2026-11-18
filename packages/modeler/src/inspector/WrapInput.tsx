/**
 * The inspector's text box: one line tall, it grows a line each time its text wraps, so a long value reads whole
 * instead of scrolling out of sight. The value stays one line: Enter never breaks it (a caller's own Enter still runs),
 * and a line break pasted in becomes a space.
 */

import type { ChangeEvent, FocusEvent, KeyboardEvent, Ref } from 'react';
import { Textarea } from '@headlessui/react';
import { field as s } from '@modeler/inspector/styles';

type Props = {
  value: string;
  /** The box's look (`textInput`, `stateNameInput`, ...); the wrapping is added to it. */
  className: string;
  name?: string;
  placeholder?: string;
  'aria-label'?: string;
  readOnly?: boolean;
  disabled?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
  onChange?: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onBlur?: (event: FocusEvent<HTMLTextAreaElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
};

export function WrapInput({ className, onChange, onKeyDown, ...rest }: Props) {
  return (
    <Textarea
      {...rest}
      rows={1}
      className={`${className} ${s.wrap}`}
      onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter') event.preventDefault();
        onKeyDown?.(event);
      }}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
        const line = event.target.value.replace(/\s*[\r\n]+\s*/g, ' ');
        if (line !== event.target.value) event.target.value = line;
        onChange?.(event);
      }}
    />
  );
}
