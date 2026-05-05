import { useImperativeHandle, useContext, useState, ReactElement } from "react";

import { Button, Dialog, DialogPanel, DialogTitle, Fieldset, Label, Description, Input, Field } from '@headlessui/react'

import { ModelerContext } from '../contexts';
import { executeCommand } from '../commands';
import { dialog as s } from '../styles';
import { URLS } from '../constants';


export function PublishDialog({ref, ...props}) {
  const {modeler} = useContext(ModelerContext);
  let [isOpen, setIsOpen] = useState<boolean>(false)
  let [status, setStatus] = useState<string | ReactElement | undefined>(undefined)
  let [publishButtonIsVisible, setPublishButtonIsVisible] = useState(true)
  let [previewUrl, setPreviewUrl] = useState(undefined)
  let [isLoading, setLoading] = useState(false)


  useImperativeHandle(ref, () => {
    return {
      open() {
        setPublishButtonIsVisible(true)
        setPreviewUrl(undefined);
        setLoading(false);
        setStatus(undefined);
        setIsOpen(true);
      },

    };
  }, [modeler]);

  function close() {
    setPublishButtonIsVisible(true);
    setIsOpen(false);
    setPreviewUrl(undefined);
  }

  const handlePublish = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    setLoading(true);
    setStatus("Publishing...");
    setPublishButtonIsVisible(false);
    const study_name = formData.get('study_name');
    const api_key = formData.get('api_key');
    executeCommand(modeler, {
      type: 'publish-diagram',
      studyName: String(study_name || ''),
      apiKey: String(api_key || ''),
    })
      .then((result: any) => {
        if (!result?.success) {
          throw new Error(result?.error || 'Failed to publish');
        }

        setLoading(false);
        setStatus("Published successfully.");
        setPreviewUrl(result.data?.preview_url);
      })
      .catch((error: any) => {
        setPublishButtonIsVisible(true);
        console.error(error);
        setPreviewUrl(undefined);
        setLoading(false);
        setStatus(<div className="text-red-500">{error.message}</div>);
      });
  }

  return (
    <Dialog open={isOpen} className={s.root} onClose={close}>
      <div className={s.backdrop}>
        <div className={s.centerLayout}>
          <DialogPanel
            transition
            className={`${s.panelMd} ${s.panel}`}
          >
            <DialogTitle as="h3" className={`${s.title} pb-6`}>
              Publish
              <span className={s.closeButton} onClick={close}>
                <i className="iconify bi--x-lg"></i>
              </span>
            </DialogTitle>
            <form onSubmit={handlePublish}>
              <Fieldset className={s.fieldset}>
                <Field>
                  <Label className={s.label}>Study Name</Label>
                  <Input
                    name="study_name"
                    className={s.input}
                    placeholder="Example: my-study"
                  />
                  <Description className={s.helpText}>
                    Use only lower-case letters, numbers, and hyphens
                  </Description>
                </Field>
                <Field>
                  <Label className={s.label}>Behaverse API Key</Label>
                  <Input
                    name="api_key"
                    className={s.input}
                    placeholder="Example: 12345jdcj33kllk67890"
                  />
                  <Description className={s.helpText}>
                    See the <a className={s.bodyLink} href={URLS.apiDocs} target="_blank">API docs</a> for more information
                  </Description>
                </Field>
                {status &&
                  <div className="float-start inline-flex items-center py-1.5">
                    <span className={s.statusText}>
                      {status}
                    </span>
                  </div>
                }
                {previewUrl &&
                  <a href={previewUrl} target="_blank"
                    className={`float-end ${s.previewBtn}`}
                  >Preview</a>
                }
                {publishButtonIsVisible &&
                  <Button
                    type="submit"
                    className={`float-end inline-flex items-center gap-2 ${s.primaryBtn}`}
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
