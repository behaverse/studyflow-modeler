import { forwardRef, useContext, type MouseEvent } from 'react';
import { ModelerContext } from '../../contexts';
import { executeCommand } from '../../commands';
import { MenuItemButton } from './MenuItemButton';

type Props = {
  className?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
};

export const ResetZoomButton = forwardRef<HTMLButtonElement, Props>(
  function ResetZoomButton({ className, onClick }, ref) {
    const { modeler } = useContext(ModelerContext);

    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
      if (modeler) {
        try {
          executeCommand(modeler, { type: 'reset-zoom' });
        } catch (err) {
          console.warn('Zoom to fit failed', err);
        }
      }
      onClick?.(event);
    };

    return (
      <MenuItemButton
        ref={ref}
        title="Reset Zoom"
        icon="iconify bi--fullscreen"
        label=" Reset Zoom"
        className={className}
        onClick={handleClick}
      />
    );
  },
);

export default ResetZoomButton;
