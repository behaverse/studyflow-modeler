import { forwardRef, useContext } from 'react';
import { APIKeyContext } from '../../contexts';

export const LoginButton = forwardRef<HTMLButtonElement, { className?: string; onClick?: () => void; dialog?: React.RefObject<{ open: () => void } | null> }>(
  function LoginButton({ className, onClick, dialog }, ref) {
    const { apiKey } = useContext(APIKeyContext);
    const isGuest = !apiKey || apiKey === 'guest';

    return (
      <button
        ref={ref}
        title="Login with API Key"
        className={`w-full text-left ${className ?? ''}`}
        onClick={() => {
          dialog?.current?.open();
          onClick?.();
        }}
      >
        <i className="iconify bi--person pe-2"></i>
        {isGuest ? ' Login...' : ' Switch Account...'}
      </button>
    );
  }
);
