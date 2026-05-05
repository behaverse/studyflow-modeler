import { forwardRef } from 'react';

export const ExamplesButton = forwardRef<HTMLButtonElement, { className?: string; onClick?: () => void; dialog?: React.RefObject<{ open: () => void } | null> }>(
  function ExamplesButton({ className, onClick, dialog }, ref) {
    return (
      <button
        ref={ref}
        title="Open an example diagram"
        className={`w-full text-left ${className ?? ''}`}
        onClick={() => {
          dialog?.current?.open();
          onClick?.();
        }}
      >
        <i className="iconify bi--collection pe-2"></i> Examples...
      </button>
    );
  },
);
