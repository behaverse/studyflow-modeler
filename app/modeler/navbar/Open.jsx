import { useEffect, useContext, useRef } from "react";
import { ModelerContext } from '../contexts';


export function OpenButton({ className, ...props }) {

    const { modeler } = useContext(ModelerContext);
    const fileInputRef = useRef(null);

    useEffect(() => {
    }, [modeler]);

    const handleUpload = (event) => {
        const xml = event.target.result;
        modeler.importXML(xml).then(() => {
            modeler.get('canvas').zoom('fit-viewport');
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
        fileData.onloadend = handleUpload;
        fileData.readAsText(file);
        // You can process the file here (e.g., read content, upload, etc.)
    };

    return (
        <>
            <button
                title="Upload"
                className={`w-full text-left ${className}`}
                onClick={() => fileInputRef.current.click()}>
                <i className="bi bi-cloud-upload pe-2"></i> Open
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
