import { forwardRef, useContext, type MouseEvent } from 'react';
import { ModelerContext, DiagramNameContext } from '../../contexts';
import { executeCommand } from '../../commands';
import { MenuItemButton } from './MenuItemButton';

type Props = {
  fileType: string;
  className?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
};

export const ExportButton = forwardRef<HTMLButtonElement, Props>(
  function ExportButton({ className, fileType, onClick }, ref) {
    const { modeler } = useContext(ModelerContext);
    const { diagramName } = useContext(DiagramNameContext);

    async function exportDiagram(event: MouseEvent<HTMLButtonElement>) {
      await executeCommand(modeler, {
        type: 'export-diagram',
        diagramName,
        fileType: fileType.toLowerCase(),
      });
      onClick?.(event);
    }

    const ext = fileType.toLowerCase();
    return (
      <MenuItemButton
        ref={ref}
        title={`Export to ${ext.toUpperCase()}`}
        icon={`iconify bi--filetype-${ext}`}
        label={` Export to ${fileType.toUpperCase()}...`}
        className={className}
        onClick={exportDiagram}
      />
    );
  },
);
