import { useEffect, useState } from 'react';
import { settingsView as s } from '@/modeler/infra/styles';
import { AboutSection } from '@/modeler/views/settings/sections/AboutSection';
import { AccountSection } from '@/modeler/views/settings/sections/AccountSection';
import { EditorSection } from '@/modeler/views/settings/sections/EditorSection';
import { ExtensionsSection } from '@/modeler/views/settings/sections/ExtensionsSection';
import { GeneralSection } from '@/modeler/views/settings/sections/GeneralSection';
import { PrivacySection } from '@/modeler/views/settings/sections/PrivacySection';

type SectionId = 'account' | 'general' | 'editor' | 'extensions' | 'privacy' | 'about';

type Section = {
  id: SectionId;
  label: string;
  icon: string;
  Component: () => React.ReactNode;
};

const SECTIONS: Section[] = [
  { id: 'account', label: 'Account', icon: 'bi--person-circle', Component: AccountSection },
  { id: 'general', label: 'General', icon: 'bi--sliders', Component: GeneralSection },
  { id: 'editor', label: 'Editor', icon: 'bi--pencil', Component: EditorSection },
  { id: 'extensions', label: 'Extensions', icon: 'bi--diagram-3', Component: ExtensionsSection },
  { id: 'privacy', label: 'Privacy', icon: 'bi--shield-lock', Component: PrivacySection },
  { id: 'about', label: 'About', icon: 'bi--info-circle', Component: AboutSection },
];

export function SettingsView({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState<SectionId>('account');
  const ActiveSection = SECTIONS.find((sec) => sec.id === active)!.Component;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={s.root} role="dialog" aria-modal="true" aria-label="Settings" data-testid="settings-view">
      <div className={s.panel}>
        <header className={s.header}>
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            title="Back (Esc)"
            className={s.backButton}
          >
            <i className={s.backIcon} aria-hidden="true" />
          </button>
          <h1 className={s.headerTitle}>Settings</h1>
        </header>

        <div className={s.body}>
          <nav className={s.sidebar} aria-label="Settings sections">
            <ul className={s.sidebarList}>
              {SECTIONS.map((sec) => (
                <li key={sec.id}>
                  <button
                    type="button"
                    onClick={() => setActive(sec.id)}
                    aria-current={active === sec.id ? 'page' : undefined}
                    className={`${s.sidebarItem} ${active === sec.id ? s.sidebarItemActive : ''}`}
                  >
                    <i className={`iconify ${sec.icon} ${s.sidebarItemIcon}`} aria-hidden="true" />
                    <span>{sec.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <main className={s.content}>
            <div className={s.contentInner}>
              <ActiveSection />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
