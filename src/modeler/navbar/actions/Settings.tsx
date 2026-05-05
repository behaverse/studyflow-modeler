import { forwardRef } from 'react';

export const SettingsButton = forwardRef<
  HTMLButtonElement,
  { className?: string; onClick?: () => void; openSettings?: () => void }
>(function SettingsButton({ className, onClick, openSettings }, ref) {
  return (
    <button
      ref={ref}
      title="Open settings"
      className={`w-full text-left ${className ?? ''}`}
      onClick={() => {
        openSettings?.();
        onClick?.();
      }}
    >
      <i className="iconify bi--gear pe-2"></i> Settings...
    </button>
  );
});
