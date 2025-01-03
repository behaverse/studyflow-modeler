import { useEffect, useContext, useState } from "react";

import { Button, Dialog, DialogPanel, DialogTitle } from '@headlessui/react'

import {ModelerContext} from '../ModelerContext';

import xmldom from 'xmldom';

export default function ExportButton() {

  const modeler = useContext(ModelerContext);
  let [isOpen, setIsOpen] = useState(false)

  function open() {
    setIsOpen(true)
  }

  function close() {
    setIsOpen(false)
  }
  useEffect(() => {
  }, [modeler]);

  function xml2json(xml, {ignoreTags = []} = {}) {
    var el = xml.nodeType === 9 ? xml.documentElement : xml
    if (ignoreTags.includes(el.nodeName)) return el
  
    var h  = {_name: el.nodeName}
    h.content    = Array.from(el.childNodes || []).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('')
    h.attributes = Array.from(el.attributes || []).filter(a => a).reduce((h, a) => { h[a.name] = a.value; return h }, {})
    h.children   = Array.from(el.childNodes || []).filter(n => n.nodeType === 1).map(c => {
      var r = xml2json(c, {ignoreTags: ignoreTags})
      h[c.nodeName] = h[c.nodeName] || r
      return r
    })
    return h
  }

  function publishDiagram() {
    modeler.saveXML({ format: true }).then(({ xml }) => {
      const parsedXml = new xmldom.DOMParser().parseFromString(xml, 'text/xml')
      const diagramJson = xml2json(parsedXml);
      console.log(diagramJson);
      alert('Diagram published!');
    });
  }

  return (
    <>
      <Button
        title="Publish"
        className="bg-gray-200 hover:bg-gray-300 border border-gray-300 text-black py-1 px-3 rounded-e"
        onClick={open}>
          <i className="bi bi-broadcast-pin w-3 h-3"></i>
      </Button>

      <Dialog open={isOpen} as="div" className="relative z-10 focus:outline-none" onClose={close}>
        <div className="fixed backdrop-blur	 inset-0 z-10 w-screen overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <DialogPanel
              transition
              className="w-full bg-black/5 max-w-md rounded-xl p-6 backdrop-blur-2xl duration-300 ease-out data-[closed]:transform-[scale(95%)] data-[closed]:opacity-0"
            >
              <DialogTitle as="h3" className="text-base/7 font-medium">
                Study published!
              </DialogTitle>
              <p className="mt-2 text-sm/6">
                Your study has been successfully published.
              </p>
              <div className="mt-4">
                <Button
                  className="inline-flex items-center gap-2 rounded-md bg-gray-200 py-1.5 px-3 text-sm/6 font-semibold  shadow-inner shadow-white/10 focus:outline-none data-[hover]:bg-gray-300 data-[focus]:outline-1 data-[focus]:outline-white data-[open]:bg-gray-700"
                  onClick={close}
                >
                  Close
                </Button>
              </div>
            </DialogPanel>
          </div>
        </div>
      </Dialog>
    </>
  );

}
