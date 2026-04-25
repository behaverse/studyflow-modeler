import { forwardRef, useContext, useRef, type ChangeEvent, type MouseEvent } from 'react';
import { DiagramNameContext, ModelerContext } from '../../contexts';
import { executeCommand } from '../../commands';
import { MenuItemButton } from './MenuItemButton';

type Props = {
  className?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
};

const VALID_EXTENSIONS = ['.xml', '.svg', '.studyflow'];

export const OpenButton = forwardRef<HTMLButtonElement, Props>(
  function OpenButton({ className, onClick }, ref) {
    const { modeler } = useContext(ModelerContext);
    const { setDiagramName } = useContext(DiagramNameContext);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleUpload = (event: ProgressEvent<FileReader>, filename: string) => {
      const content = (event.target as FileReader).result;
      executeCommand(modeler, {
        type: 'open-diagram',
        filename,
        content,
        setDiagramName,
      }).catch((error: any) => {
        alert(error?.message || 'Failed to open diagram.');
        console.error(error);
      });
    };

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const hasValidExtension = VALID_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
      if (!hasValidExtension) {
        alert('Please select a valid XML, SVG, or Studyflow file.');
        return;
      }

      const reader = new FileReader();
      reader.onloadend = (e) => handleUpload(e, file.name);
      reader.readAsText(file);
      event.target.value = '';
      onClick?.(event as unknown as MouseEvent<HTMLButtonElement>);
    };

    const onButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
      // Prevent parent menu handlers from closing/unmounting this component
      // before the file-picker returns a selection.
      event.preventDefault();
      event.stopPropagation();
      fileInputRef.current?.click();
    };

    return (
      <>
        <MenuItemButton
          ref={ref}
          title="Upload"
          icon="iconify bi--folder2-open"
          label=" Open File..."
          className={className}
          onClick={onButtonClick}
        />
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept=".xml,.bpmn,.studyflow,.svg"
          onChange={handleFileChange}
        />
      </>
    );
  },
);
