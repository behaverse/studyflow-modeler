import { useEffect, useContext } from "react";
import { ModelerContext } from '../../contexts';
import { executeCommand } from '../../commands';

export function NewDiagramButton({ className }) {

    const { modeler } = useContext(ModelerContext);

    useEffect(() => {
    }, [modeler]);

    const handleClick = (e) => {
        e.preventDefault();
        alert("FIXME: this will delete the current diagram and load an empty one. It cannot be undone.");
        if (modeler) {
            executeCommand(modeler, {
                type: 'new-diagram',
            }).catch(err => {
                console.log(err);
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
