import { forwardRef, useContext, type MouseEvent } from 'react';
import { ModelerContext } from '../../contexts';
import { executeCommand } from '../../commands';
import { MenuItemButton } from './MenuItemButton';

type Props = {
  className?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
};

export const NewDiagramButton = forwardRef<HTMLButtonElement, Props>(
  function NewDiagramButton({ className, onClick }, ref) {
    const { modeler } = useContext(ModelerContext);

    const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      alert('FIXME: this will delete the current diagram and load an empty one. It cannot be undone.');
      if (modeler) {
        executeCommand(modeler, { type: 'new-diagram' }).catch((err) => console.log(err));
      }
      onClick?.(event);
    };

    return (
      <MenuItemButton
        ref={ref}
        title="New Diagram"
        icon="iconify bi--file-earmark-plus"
        label=" New"
        className={className}
        onClick={handleClick}
      />
    );
  },
);
