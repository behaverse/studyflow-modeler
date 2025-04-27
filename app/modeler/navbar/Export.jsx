import { Canvg } from 'canvg';

import { useEffect, useContext } from "react";
import { ModelerContext } from '../contexts';
import download from 'downloadjs';
import { MenuItem } from '@headlessui/react'

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

export function ExportMenuItem() {

    const {modeler} = useContext(ModelerContext);

    useEffect(() => {
    }, [modeler]);

    function exportDiagram() {
        modeler.saveSVG().then(({ svg }) => {
            download(svg, 'diagram.svg', 'image/svg+xml');
            // TODO if png is needed, uncomment the following lines
            // exportoToImage(svg).then((dataURL) => {
            //     download(dataURL, 'diagram.png', 'image/png');
            // });
        });
    }

    return (
        <MenuItem className="py-1 px-4 hover:bg-stone-300">
        <button
            title="Export to SVG"
            className=""
            onClick={exportDiagram}>
            <i className="bi bi-image"></i> Export to SVG
            </button>
        </MenuItem>
    );

}
