import { useEffect, useContext, useRef } from "react";
import { DiagramNameContext, ModelerContext } from '../../contexts';


export function OpenButton({ className, ...props }) {

    const { modeler } = useContext(ModelerContext);
    const { diagramName, setDiagramName } = useContext(DiagramNameContext);
    const fileInputRef = useRef(null);

    useEffect(() => {
    }, [modeler]);

    const handleUpload = (event, filename) => {
        const xml = event.target.result;
        modeler.importXML(xml).then(() => {
            modeler.get('canvas').zoom('fit-viewport');
            if (diagramName && setDiagramName) {
                // remove extension from filename
                filename = filename.replace(/\.[^/.]+$/, "");
                setDiagramName(filename);
            }
        }).catch((error) => {
            console.error(error);
        });
    }

    const handleFileChange = (event) => {
        const file = event.target.files[0];
        console.log(event.target.files);

        if (!file) {
            return;
        }

        if (!file.name.endsWith('xml') && !file.name.endsWith('bpmn')
            && !file.name.endsWith('studyflow')) {
            alert("Please select a valid XML/BPMN/Studyflow file.");
            return;
        }

        let fileData = new FileReader();
        fileData.onloadend = (e) => handleUpload(e, file.name);
        fileData.readAsText(file);
        // You can process the file here (e.g., read content, upload, etc.)
    };

    return (
        <>
            <button
                title="Upload"
                className={`w-full text-left ${className}`}
                onClick={() => fileInputRef.current.click()}>
                <i className="bi bi-folder2-open pe-2"></i> Open File...
            </button>
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".xml,.bpmn,.studyflow"
                onChange={handleFileChange} />
        </>
    );

}
