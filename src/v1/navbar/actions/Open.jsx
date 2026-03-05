import { useEffect, useContext, useRef } from "react";
import { DiagramNameContext, ModelerContext } from '../../contexts';
import PropTypes from 'prop-types';
import { executeCommand } from '../../commands';


export function OpenButton({ className, onClick }) {

    const { modeler } = useContext(ModelerContext);
    const { setDiagramName } = useContext(DiagramNameContext);
    const fileInputRef = useRef(null);
    useEffect(() => {
    }, [modeler]);

    const handleUpload = (event, filename) => {
        const content = event.target.result;

        executeCommand(modeler, {
            type: 'open-diagram',
            filename,
            content,
            setDiagramName,
        }).then(() => {
        }).catch((error) => {
            alert(error?.message || 'Failed to open diagram.');
            console.error(error);
        });
    }

    const handleFileChange = (event) => {
        const file = event.target.files[0];

        if (!file) {
            return;
        }

        const hasValidExtension = ['.xml', '.svg', '.studyflow'].some(ext => file.name.toLowerCase().endsWith(ext));
        if (!hasValidExtension) {
            alert("Please select a valid XML, SVG, or Studyflow file.");
            return;
        }

        let fileData = new FileReader();
        fileData.onloadend = (e) => handleUpload(e, file.name);
        fileData.readAsText(file);
        event.target.value = '';
        if (onClick) onClick();
    };

    const onButtonClick = (e) => {
        // Prevent parent menu handlers from closing/unmounting this component
        // before the file-picker returns a selection.
        e.preventDefault();
        e.stopPropagation();
        fileInputRef.current?.click();
    }

    return (
        <>
            <button
                title="Upload"
                className={`w-full text-left ${className}`}
                onClick={onButtonClick}>
                <i className="bi bi-folder2-open pe-2"></i> Open File...
            </button>
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".xml,.bpmn,.studyflow,.svg"
                onChange={handleFileChange} />
        </>
    );

}

OpenButton.propTypes = {
  className: PropTypes.string,
  onClick: PropTypes.func
};
