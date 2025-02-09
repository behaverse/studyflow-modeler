import { Canvg } from 'canvg';

import { useEffect, useContext } from "react";
import { ModelerContext } from '../contexts';
import download from 'downloadjs';

async function exportoToImage(svg) {

    let canvas = document.createElement('canvas');

    const context = canvas.getContext('2d');

    const canvg = Canvg.fromString(context, svg);
    await canvg.render();

    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = 'white';

    context.fillRect(0, 0, canvas.width, canvas.height);

    const dataURL = canvas.toDataURL('image/png');
    return dataURL;

}

export default function ExportButton() {

    const {modeler} = useContext(ModelerContext);

    useEffect(() => {
    }, [modeler]);

    function exportDiagram() {
        modeler.saveSVG().then(({ svg }) => {
            exportoToImage(svg).then((dataURL) => {
                download(dataURL, 'diagram.png', 'image/png');
            });
        });
    }

    return (
        <button
            title="Export to Image"
            className="bg-stone-200 hover:bg-stone-300 border-y border-e rounded-e border-gray-300 text-black py-1 px-3"
            onClick={exportDiagram}>
            <i className="bi bi-image"></i>
        </button>
    );

}
