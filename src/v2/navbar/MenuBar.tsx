import { useRef, useState, type ReactElement } from 'react';
import {
  Menu,
  MenuItems,
  MenuButton,
  MenuItem,
  MenuSeparator,
  Popover,
  PopoverButton,
  PopoverPanel,
  Dialog,
  DialogPanel,
  DialogTitle,
  Button,
  Fieldset,
  Field,
  Label,
  Input,
  Description,
} from '@headlessui/react';
import { useModelerStore } from '../store';
import { exportDiagram } from '../commands/exportDiagram';

// ─── Save As ────────────────────────────────────────────────────────────────

function SaveButton({ className }: { className?: string }) {
  const saveFile = useModelerStore((s) => s.saveFile);

  return (
    <button title="Save As" className={`w-full text-left ${className ?? ''}`} onClick={saveFile}>
      <i className="bi bi-download pe-2" /> Save As...
    </button>
  );
}

// ─── Open ────────────────────────────────────────────────────────────────────

function OpenButton({ className }: { className?: string }) {
  const importXml = useModelerStore((s) => s.importXml);
  const setDiagramName = useModelerStore((s) => s.setDiagramName);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleButtonClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = async (ev) => {
      const content = ev.target?.result as string;
      try {
        await importXml(content);
        const nameWithoutExt = file.name.replace(/\.[^.]+$/, '');
        if (nameWithoutExt) setDiagramName(nameWithoutExt);
      } catch (err: any) {
        alert(err?.message || 'Failed to open diagram.');
        console.error(err);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <>
      <button title="Open File" className={`w-full text-left ${className ?? ''}`} onClick={handleButtonClick}>
        <i className="bi bi-folder2-open pe-2" /> Open File...
      </button>
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept=".xml,.bpmn,.studyflow"
        onChange={handleFileChange}
      />
    </>
  );
}

// ─── Publish Dialog ──────────────────────────────────────────────────────────

function PublishDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const exportXml = useModelerStore((s) => s.exportXml);
  const [status, setStatus] = useState<string | ReactElement | undefined>(undefined);
  const [showPublish, setShowPublish] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);

  const close = () => {
    setShowPublish(true);
    setPreviewUrl(undefined);
    setStatus(undefined);
    setIsLoading(false);
    onClose();
  };

  const handlePublish = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const studyName = String(data.get('study_name') || '');
    const apiKey = String(data.get('api_key') || '');

    setIsLoading(true);
    setStatus('Publishing...');
    setShowPublish(false);

    try {
      const xml = await exportXml();
      const response = await fetch(`https://api.behaverse.org/v1/studies/${studyName}/flow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml',
          Authorization: `Bearer ${apiKey}`,
        },
        body: xml,
      });

      if (response.status === 401 || response.status === 403) throw new Error('Invalid API key');
      if (!response.ok) throw new Error(`Failed to publish (error ${response.status})`);

      const result = await response.json();
      setIsLoading(false);
      setStatus('Published successfully.');
      setPreviewUrl(result?.preview_url);
    } catch (err: any) {
      setShowPublish(true);
      setIsLoading(false);
      setPreviewUrl(undefined);
      setStatus(<div className="text-red-500">{err.message}</div>);
    }
  };

  return (
    <Dialog open={isOpen} className="relative z-[101] focus:outline-none" onClose={close}>
      <div className="fixed backdrop-blur inset-0 z-10 w-screen overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4">
          <DialogPanel className="w-full bg-stone-100 max-w-md rounded-xl p-6 backdrop-blur-2xl duration-300 ease-out closed:transform-[scale(95%)] closed:opacity-0 z-[102]">
            <DialogTitle as="h3" className="text-base/7 text-stone-900 font-semibold pb-8">
              Publish
              <span className="text-sm/6 text-black ml-2 float-end cursor-pointer" onClick={close}>
                <i className="bi bi-x-lg" />
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
                    See the{' '}
                    <a className="text-sky-500 hover:text-sky-600" href="https://api.behaverse.org/docs" target="_blank">
                      API docs
                    </a>{' '}
                    for more information
                  </Description>
                </Field>
                {status && (
                  <div className="float-start inline-flex items-center py-1.5">
                    <span className="text-sm m-auto">{status}</span>
                  </div>
                )}
                {previewUrl && (
                  <a
                    href={previewUrl}
                    target="_blank"
                    className="float-end inline-flex items-center gap-2 rounded-md bg-green-500 py-1.5 px-3 text-sm/6 text-white font-semibold shadow-inner shadow-white/10 hover:bg-green-700"
                  >
                    Preview
                  </a>
                )}
                {showPublish && !isLoading && (
                  <Button
                    type="submit"
                    className="float-end inline-flex items-center gap-2 rounded-md bg-sky-500 py-1.5 px-3 text-sm/6 text-white font-semibold shadow-inner shadow-white/10 hover:bg-sky-700"
                  >
                    Publish
                  </Button>
                )}
              </Fieldset>
            </form>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}

// ─── MenuBar ─────────────────────────────────────────────────────────────────

// ─── Simulate Button ─────────────────────────────────────────────────────────

function SimulateButton() {
  const simActive = useModelerStore((s) => s.simActive);
  const requestToggleSim = useModelerStore((s) => s.requestToggleSim);

  const handleClick = () => {
    requestToggleSim();
  };

  return (
    <button
      title={simActive ? 'Stop Simulation' : 'Simulate the studyflow'}
      className={`rounded-lg h-8 px-2 transition-colors ${
        simActive
          ? 'text-white bg-fuchsia-600 hover:bg-fuchsia-700'
          : 'text-stone-200 hover:bg-white/20'
      }`}
      onClick={handleClick}
    >
      {simActive ? 'Stop Simulation' : 'Simulate'}
    </button>
  );
}

// ─── MenuBar ─────────────────────────────────────────────────────────────────

export function MenuBar() {
  const [publishOpen, setPublishOpen] = useState(false);
  const requestResetZoom = useModelerStore((s) => s.requestResetZoom);

  return (
    <div className="flex items-center gap-1">
      <PublishDialog isOpen={publishOpen} onClose={() => setPublishOpen(false)} />

      <Popover className="relative">
        <PopoverButton className="hover:bg-white/20 rounded-lg h-8 w-8 flex items-center justify-center text-stone-200">
          <i className="bi bi-list text-xl leading-none" />
        </PopoverButton>
        <PopoverPanel
          anchor="bottom start"
          className="flex items-start gap-0 bg-black/80 backdrop-blur-md border border-white/10 rounded-md p-1 z-50"
        >
          <Menu as="div" title="FileMenu">
            <MenuButton className="hover:bg-white/20 rounded-lg h-8 px-2 text-stone-200">File</MenuButton>
            <MenuItems
              unmount={false}
              anchor="bottom start"
              className="min-w-48 bg-black/80 backdrop-blur-md border border-white/10 text-stone-200 rounded-md grid auto-rows-max grid-flow-row z-50"
            >
              <MenuItem>
                <OpenButton className="px-3 py-1 hover:bg-white/20" />
              </MenuItem>
              <MenuItem>
                <SaveButton className="px-3 py-1 hover:bg-white/20" />
              </MenuItem>
              <MenuSeparator className="h-px bg-white/10" />
              <MenuItem>
                {({ close }) => (
                  <button
                    className="w-full text-left px-3 py-1 hover:bg-white/20"
                    onClick={() => { close(); exportDiagram(useModelerStore.getState().diagramName, 'svg'); }}
                  >
                    <i className="bi bi-filetype-svg pe-2" /> Export as SVG
                  </button>
                )}
              </MenuItem>
              <MenuItem>
                {({ close }) => (
                  <button
                    className="w-full text-left px-3 py-1 hover:bg-white/20"
                    onClick={() => { close(); exportDiagram(useModelerStore.getState().diagramName, 'png'); }}
                  >
                    <i className="bi bi-filetype-png pe-2" /> Export as PNG
                  </button>
                )}
              </MenuItem>
              <MenuItem>
                {({ close }) => (
                  <button
                    className="w-full text-left px-3 py-1 hover:bg-white/20"
                    onClick={() => { close(); exportDiagram(useModelerStore.getState().diagramName, 'studyflow'); }}
                  >
                    <i className="bi bi-file-earmark-code pe-2" /> Export as .studyflow
                  </button>
                )}
              </MenuItem>
              <MenuSeparator className="h-px bg-white/10" />
              <MenuItem>
                {({ close }) => (
                  <button
                    className="w-full text-left px-3 py-1 hover:bg-white/20"
                    onClick={() => { close(); setPublishOpen(true); }}
                  >
                    <i className="bi bi-broadcast-pin pe-2" /> Publish...
                  </button>
                )}
              </MenuItem>
            </MenuItems>
          </Menu>

          <Menu as="div" title="ViewMenu">
            <MenuButton className="hover:bg-white/20 rounded-lg h-8 px-2 text-stone-200">View</MenuButton>
            <MenuItems
              unmount={false}
              anchor="bottom start"
              className="min-w-36 bg-black/80 backdrop-blur-md border border-white/10 text-stone-200 rounded-md grid auto-rows-max grid-flow-row z-50"
            >
              <MenuItem>
                {({ close }) => (
                  <button
                    className="w-full text-left px-3 py-1 hover:bg-white/20"
                    onClick={() => { close(); requestResetZoom(); }}
                  >
                    <i className="bi bi-arrows-fullscreen pe-2" /> Reset Zoom
                  </button>
                )}
              </MenuItem>
            </MenuItems>
          </Menu>

          <Menu as="div" title="HelpMenu">
            <MenuButton className="hover:bg-white/20 px-2 rounded-lg h-8 text-stone-200">Help</MenuButton>
            <MenuItems
              anchor="bottom start"
              className="w-36 bg-black/80 backdrop-blur-md border border-white/10 text-stone-200 rounded-md grid auto-rows-max grid-flow-row z-50"
            >
              <MenuItem>
                <a href="./docs" target="_blank" className="block px-3 py-1 hover:bg-white/20">
                  Docs
                </a>
              </MenuItem>
              <MenuItem>
                <a
                  href="https://github.com/behaverse/studyflow-modeler"
                  target="_blank"
                  className="block px-3 py-1 hover:bg-white/20"
                >
                  GitHub
                </a>
              </MenuItem>
            </MenuItems>
          </Menu>
        </PopoverPanel>
      </Popover>

      <SimulateButton />
    </div>
  );
}
