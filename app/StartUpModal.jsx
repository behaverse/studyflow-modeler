import 'bootstrap-icons/font/bootstrap-icons.css'
import { useState, useContext } from 'react';
import { Description, Dialog, DialogPanel, Field, Fieldset, Label, Input, Button } from '@headlessui/react'

import { APIKeyContext } from './studyflow/contexts';

export default function StartUpModal() {

    const [isOpen, setIsOpen] = useState(true);
    const { apiKey, setApiKey } = useContext(APIKeyContext);

    const handleConnect = (formData) => {
        const api_key = formData.get('api_key');
        if (api_key !== 'xcit-demo') {
            return;
        }
        setApiKey(api_key);
        setIsOpen(false);
    }

    return (
        <>
        <Dialog open={isOpen} onClose={() => {}} className="relative z-50">
          <div className="fixed inset-0 flex w-screen items-center justify-center p-1">
            <DialogPanel className="max-w-lg rounded-lg border bg-white p-8">
              <form action={handleConnect}>
              <Fieldset className="space-y-6">
                <Field>
                  <Label className="text-sm font-medium">API Key</Label>
                  <Input
                    name="api_key"
                    className="mt-3 block w-full rounded-lg border-none bg-stone-200 py-1.5 px-3 font-mono text-sm/6 text-black focus:outline-2 focus:-outline-offset-2 focus:outline-stone-600"
                    placeholder="Example: 12345adhjkl67890"
                  />
                  <Description className="text-xs text-stone-400 mt-1">
                    Make sure your key has the correct permissions.
                  </Description>
            </Field>
                <Button type="submit" className="float-end inline-flex items-center gap-2 rounded-md bg-sky-500 py-1.5 px-3 text-sm/6 text-white font-semibold shadow-inner shadow-white/10 hover:bg-sky-700">Enter</Button>  
                            </Fieldset>
            </form>
            </DialogPanel>
          </div>
        </Dialog>
      </>
    )
}
