import type { ReactNode } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { dialog as d } from '@/modeler/ui/styles';
import { ICONS } from '@/icons';

const SIZES = { sm: d.panelSm, md: d.panelMd, lg: d.panelLg, xl: d.panelXl } as const;

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

/** `transition` must stay on the panel: `dialog.panel` carries the `closed:` classes it activates. */
export function Modal({ isOpen, onClose, title, size = 'lg', help, actions, testId, children }: Props) {
  return (
    <Dialog open={isOpen} onClose={onClose} className={d.root}>
      <div className={d.backdrop}>
        <div className={d.centerLayout}>
          <DialogPanel transition className={`${SIZES[size]} ${d.panel}`} data-testid={testId}>
            <DialogTitle as="h3" className={`${d.title} pb-3 flex items-center gap-1`}>
              <span>{title}</span>
              {help}
              <span className="flex-1" aria-hidden="true" />
              {actions}
              <span className={d.closeButton} onClick={onClose}>
                <i className={ICONS.close}></i>
              </span>
            </DialogTitle>
            {children}
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
