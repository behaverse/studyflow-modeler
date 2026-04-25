import { forwardRef, useContext, type MouseEvent } from 'react';
import { DiagramNameContext, ModelerContext } from '../../contexts';
import { executeCommand } from '../../commands';
import { MenuItemButton } from './MenuItemButton';

type Props = {
  className?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
};

export const SaveButton = forwardRef<HTMLButtonElement, Props>(
  function SaveButton({ className, onClick }, ref) {
    const { modeler } = useContext(ModelerContext);
    const { diagramName } = useContext(DiagramNameContext);

    function downloadDiagram(event: MouseEvent<HTMLButtonElement>) {
      executeCommand(modeler, { type: 'save-diagram', diagramName });
      onClick?.(event);
    }

    return (
      <MenuItemButton
        ref={ref}
        title="Download"
        icon="iconify bi--download"
        label=" Save As..."
        className={className}
        onClick={downloadDiagram}
      />
    );
  },
);
