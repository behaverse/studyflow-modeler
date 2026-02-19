import { useState, useContext } from 'react';
import { Description, Dialog, DialogPanel, Field, Fieldset, Label, Input, Button } from '@headlessui/react'

import { APIKeyContext } from './contexts';

export default function StartUpModal() {

  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const { apiKey, setApiKey } = useContext(APIKeyContext);

  // FIXME Auto-login as guest on mount
  useState(() => {
    setApiKey('guest');
  });

  const login = (formData) => {
    const api_key = formData.get('api_key');
    if (api_key !== '') {
      // TODO check with behaverse data server
      setError('Invalid key');
      return;
    }
    setApiKey(api_key);
    setIsOpen(false);
  }

  const guestLogin = () => {
    setApiKey('guest');
    setIsOpen(false);
  }

  return (
    <>
      <Dialog open={isOpen} onClose={() => { }} className="relative z-50">
        <div className="fixed inset-0 flex w-screen items-center justify-center p-1">
          <DialogPanel className="max-w-lg rounded-lg bg-stone-100 p-8">
            <p className="text-base/7 text-stone-900 pb-8">
              Welcome! To access this demo, you need a valid key. If you don&apos;t have one, please <a className="text-sky-500 hover:text-sky-600" href="https://github.com/behaverse" target="_blank">contact us</a>.
            </p>
            <form action={login}>
              <Fieldset className="space-y-6">
                <Field>
                  <Label className="text-sm font-medium">Behaverse API Key</Label>
                  <Input
                    name="api_key"
                    onChange={(e) => { setError(undefined) }}
                    className="mt-3 block w-full rounded-lg border-none bg-stone-200 py-1.5 px-3 font-mono text-sm/6 text-black focus:outline-2 focus:-outline-offset-2 focus:outline-stone-600"
                    placeholder="Example: 12345adhjkl67890"
                  />
                  <Description className="text-xs text-stone-400 mt-1">
                    Make sure your key has the correct permissions.
                  </Description>
                </Field>
                <div className="flex justify-between items-center">
                  <div className="float-start">{error && <p className="text-red-500 text-sm">{error}</p>}</div>
                  <div className="float-end space-x-2">
                    <Button type="button" onClick={guestLogin} className="rounded-md bg-stone-300 py-1.5 px-3 text-sm/6 text-black hover:bg-stone-400 cursor-pointer">Continue as Guest</Button>
                    <Button type="submit" className="float-end rounded-md bg-sky-500 py-1.5 px-3 text-sm/6 text-white font-semibold hover:bg-sky-700 cursor-pointer">Login</Button>
                  </div>
                </div>
              </Fieldset>
            </form>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  )
}
