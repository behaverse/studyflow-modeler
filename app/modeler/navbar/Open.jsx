import { useEffect, useContext, useRef } from "react";
import { ModelerContext } from '../contexts';


export default function OpenMenuItem() {

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
                className="shadow-sm bg-stone-200 hover:bg-stone-300 border-y border-s border-stone-300 text-black py-1 px-3 rounded-s"
                onClick={() => fileInputRef.current.click()}>
                <i className="bi bi-cloud-upload w-3 h-3"></i>
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
