import { useEffect, useContext } from "react";
import { ModelerContext } from '../contexts';
import new_diagram from '../../assets/new_diagram.bpmn';

export function NewDiagramButton({ className, ...props }) {

    const { modeler } = useContext(ModelerContext);

    useEffect(() => {
    }, [modeler]);

    const handleClick = (e) => {
        e.preventDefault();
        alert("FIXME: this will delete the current diagram and load an empty one. It cannot be undone.");
        if (modeler) {
            fetch(new_diagram)
                .then(r => r.text())
                .then(content => {
                    modeler.importXML(content)
                        .then(({ warnings }) => {
                            if (warnings.length) {
                            console.warn(warnings);
                            }
                            modeler.get('canvas').zoom('fit-viewport');
                        })
                        .catch(err => {
                            console.log(err);
                        });
                });

        }
    }

    return (
        <>
            <button
                title="Upload"
                className={`w-full text-left ${className}`}
                onClick={handleClick}
                >
                <i className="bi bi-file-earmark-plus pe-2"></i> New
            </button>
        </>
    );

}
