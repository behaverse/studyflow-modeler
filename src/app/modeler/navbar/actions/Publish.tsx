import { useEffect, useContext, useState, ReactElement } from "react";

import { Button, Dialog, DialogPanel, DialogTitle, Fieldset, Label, Description, Input, Field } from '@headlessui/react'

import { ModelerContext } from '../../contexts';

export function PublishButton({ className, ...props }) {

  const {modeler} = useContext(ModelerContext);
  let [isOpen, setIsOpen] = useState<boolean>(false)
  let [status, setStatus] = useState<string | ReactElement | undefined>(undefined)
  let [publishButtonIsVisible, setPublishButtonIsVisible] = useState(true)
  let [previewUrl, setPreviewUrl] = useState(undefined)
  let [isLoading, setLoading] = useState(false)

  function open() {
    setPublishButtonIsVisible(true)
    setPreviewUrl(undefined);
    setLoading(false);
    setStatus(undefined);
    setIsOpen(true);
  }

  function close() {
    setPublishButtonIsVisible(true);
    setIsOpen(false);
    setPreviewUrl(undefined);
  }
  useEffect(() => {
  }, [modeler]);

  const handlePublish = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    setLoading(true);
    setStatus("Publishing...");
    setPublishButtonIsVisible(false);
    const study_name = formData.get('study_name');
    const api_key = formData.get('api_key');
    modeler.saveXML({ format: true }).then(({ xml }) => {
      fetch(`https://api.behaverse.org/v1/studies/${study_name}/flow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml',
          'Authorization': `Bearer ${api_key}`
        },
        body: xml
      }).then((response) => {
        if (response.status === 403 || response.status === 401) {
          console.log(response);
          throw new Error("Invalid API key");
        }
  
        if (!response.ok) {
          throw new Error("Failed to publish (error " + response.status + ")");
        }

        return response.json()
      })
        .then((data) => {
          setLoading(false);
          setStatus("Published successfully.");
          setPreviewUrl(data.preview_url);
        })
        .catch((error) => {
          setPublishButtonIsVisible(true);
          console.error(error);
          setPreviewUrl(undefined);
          setLoading(false);
          setStatus(<div className="text-red-500">{error.message}</div>);
        });
    });
  }

  function renderPublishDialog() {
    if (isOpen) {
      console.log("Publish dialog is open", isOpen);
    }
    return (
      <Dialog open={isOpen} className="relative z-[101] focus:outline-none" onClose={close}>
        <div className="fixed backdrop-blur	inset-0 z-10 w-screen overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <DialogPanel
              transition
              className="w-full bg-stone-100 max-w-md rounded-xl p-6 backdrop-blur-2xl duration-300 ease-out closed:transform-[scale(95%)] closed:opacity-0 z-[102]"
            >
              <DialogTitle as="h3" className="text-base/7 text-stone-900 font-semibold pb-8">
                Publish
                <span className="text-sm/6 text-black ml-2 float-end cursor-pointer" onClick={close}>
                  <i className="bi bi-x-lg"></i>
                </span>
              </DialogTitle>
              <form onSubmit={handlePublish}>
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
                        {status}
                      </span>
                    </div>
                  }
                  {previewUrl &&
                    <a href={previewUrl} target="_blank"
                      className="float-end inline-flex items-center gap-2 rounded-md bg-green-500 py-1.5 px-3 text-sm/6 text-white font-semibold shadow-inner shadow-white/10 hover:bg-green-700"
                    >Preview</a>
                  }
                  {publishButtonIsVisible &&
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
    );
  }

  return (
    <>
      <div
        title="Publish"
        id="publish-button"
        className={`w-full text-left ${className}`}
        onClick={open}>
        <i className="bi bi-broadcast-pin pe-2"></i> Publish...
      </div>
      {renderPublishDialog()}
    </>
  );

}
