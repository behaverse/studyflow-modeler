import { useEffect, useContext, useState } from "react";

import { Button, Dialog, DialogPanel, DialogTitle, Fieldset, Label, Description, Input, Field } from '@headlessui/react'

import {ModelerContext} from '../Contexts';

export default function ExportButton(props) {

  const modeler = useContext(ModelerContext);
  let [isOpen, setIsOpen] = useState(false)
  let [status, setStatus] = useState(undefined)

  function open() {
    setIsOpen(true)
  }

  function close() {
    setIsOpen(false)
  }
  useEffect(() => {
  }, [modeler]);

  const handlePublish = (formData) => {
    const study_name = formData.get('study_name');
    const api_key = formData.get('api_key');
    console.log('Publishing...', study_name, api_key);
    modeler.saveXML({ format: true }).then(({ xml }) => {
      console.log(xml);
      fetch(`https://api.behaverse.org/v1/studies/${study_name}/flow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml'
        },
        body: xml
      }).then((response) => response.json()).then((data) => {
        setStatus(data.status);
      })
    }).catch((error) => {
      console.error(error);
    });
  }

  return (
    <>
      <Button
        title="Publish"
        className="bg-stone-200 hover:bg-stone-300 border border-stone-300 text-black py-1 px-3 rounded-e"
        onClick={open}>
          <i className="bi bi-broadcast-pin w-3 h-3"></i>
      </Button>

      <Dialog open={isOpen} as="div" className="relative z-[101] focus:outline-none" onClose={close}>
        <div className="fixed backdrop-blur	inset-0 z-10 w-screen overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <DialogPanel
              transition
              className="w-full bg-stone-100 max-w-md rounded-xl p-6 backdrop-blur-2xl duration-300 ease-out closed:transform-[scale(95%)] closed:opacity-0 z-[102]"
            >
              <DialogTitle as="h3" className="text-base/7 text-stone-900 font-semibold pb-8">
                Publish this StudyFlow
                <span className="text-sm/6 text-black ml-2 float-end cursor-pointer" onClick={close}>
                  <i className="bi bi-x-lg"></i>
                </span>
              </DialogTitle>
              <form action={handlePublish}>
              <Fieldset className="space-y-6">
                <Field>
                  <Label className="text-sm font-medium">Study Name</Label>
                  <Input
                    name="study_name"
                    className="mt-3 block w-full rounded-lg border-none bg-stone-200 py-1.5 px-3 font-mono text-sm/6 text-black focus:outline-2 focus:-outline-offset-2 focus:outline-stone-600"
                    placeholder="Example: my-study"
                  />
                  <Description className="text-xs text-stone-400 mt-1">
                    Use only lower-case letters, numbers, and hyphens
                  </Description>
                </Field>
                <Field>
                  <Label className="text-sm font-medium">Behaverse API Key</Label>
                  <Input
                    name="api_key"
                    className="mt-3 block w-full rounded-lg border-none bg-stone-200 py-1.5 px-3 font-mono text-sm/6 text-black focus:outline-2 focus:-outline-offset-2 focus:outline-stone-600"
                    placeholder="Example: 12345jdcj33kllk67890"
                  />
                  <Description className="text-xs text-black/50 mt-1">
                    See the <a className="text-sky-500 hover:text-sky-600" href="https://api.behaverse.org/docs" target="_blank">API docs</a> for more information
                  </Description>
                </Field>
                  {status &&
                    <div className="float-start inline-flex items-center py-1.5">
                      <span className="text-sm m-auto">
                        Study Flow published successfully!
                      </span>
                    </div>
                  }
                  {!status &&
                    <Button
                      type="submit"
                      className="float-end inline-flex items-center gap-2 rounded-md bg-sky-500 py-1.5 px-3 text-sm/6 text-white font-semibold shadow-inner shadow-white/10 hover:bg-sky-700"
                    >
                      Publish
                    </Button>
                  }
              </Fieldset>
              </form>
            </DialogPanel>
          </div>
        </div>
      </Dialog>
    </>
  );

}
