import { useState, type ReactNode } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { dialog as d } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';

const SIZES = { sm: d.panelSm, md: d.panelMd, lg: d.panelLg, xl: d.panelXl, full: d.panelFull } as const;

type Props = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  size?: keyof typeof SIZES;
  help?: ReactNode;
  actions?: ReactNode;
  testId?: string;
  children: ReactNode;
};

/**
 * The one dialog frame: a title row of help, the feature's own actions, then the shared
 * window controls. Every size but `sm` can fill the window; Esc and the backdrop close.
 * `transition` must stay on the panel: `dialog.panel` carries the `closed:` classes it activates.
 */
export function Modal({ isOpen, onClose, title, size = 'lg', help, actions, testId, children }: Props) {
  const [maximized, setMaximized] = useState(false);
  const canMaximize = size !== 'sm';
  const panelSize = canMaximize && maximized ? SIZES.full : SIZES[size];
  return (
    <Dialog open={isOpen} onClose={onClose} className={d.root}>
      <div className={d.backdrop}>
        <div className={d.centerLayout}>
          <DialogPanel transition className={`${panelSize} ${d.panel}`} data-testid={testId}>
            <DialogTitle as="h3" className={`${d.title} pb-3 flex items-center gap-1`}>
              <span>{title}</span>
              {help}
              <span className="flex-1" aria-hidden="true" />
              {actions}
              {canMaximize && (
                <button
                  type="button"
                  onClick={() => setMaximized((v) => !v)}
                  className={`${d.titleAction} ml-2`}
                  title={maximized ? 'Restore the dialog' : 'Fill the window'}
                  aria-label={maximized ? 'Restore' : 'Maximize'}
                >
                  <i className={`${maximized ? ICONS.fullscreenExit : ICONS.fullscreen} size-3.5 block`}></i>
                </button>
              )}
              <button type="button" onClick={onClose} className={d.closeButton} title="Close (Esc)" aria-label="Close">
                <i className={`${ICONS.close} size-3.5 block`}></i>
              </button>
            </DialogTitle>
            {children}
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
