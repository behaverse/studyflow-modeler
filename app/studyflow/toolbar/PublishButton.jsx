import { useEffect, useContext } from "react";

import {ModelerContext} from '../ModelerContext';

import xmldom from 'xmldom';

export default function ExportButton() {

  const modeler = useContext(ModelerContext);

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
      <button
        title="Publish"
        className="bg-gray-200 hover:bg-gray-300 border border-gray-300 text-black py-1 px-3 rounded-e"
        onClick={publishDiagram}>
          <i className="bi bi-broadcast-pin w-3 h-3"></i>
      </button>
  );

}
