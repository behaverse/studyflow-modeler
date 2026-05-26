// Modeler styling tokens and per-module themes; color tokens live in `src/assets/css/app.css`.

// --- Token blocks

/** Background-surface tokens. */
const surface = {
  /** Canvas (lightest cream). */
  canvas: 'bg-cream-50',
  /** Lightly tinted translucent chrome (navbar shell, palette wrapper, inspector panel). */
  chrome: 'bg-cream-100/72 backdrop-blur-2xl backdrop-saturate-150',
  /** Solid sheet (dialogs, modals, code editor). */
  sheet: 'bg-cream-100',
  /** Stronger menu / popover character (navbar dropdowns, palette flyouts, .djs-popup). */
  menu: 'bg-cream-300/85 backdrop-blur-2xl backdrop-saturate-150',
  /** Recessed inset surface (inputs, list cards, secondary buttons). */
  card: 'bg-cream-200',
} as const;

/** Layered drop-shadow recipes. */
const shadow = {
  /** Floating chrome panel (navbar pill, palette wrapper, inspector panel). */
  panel: 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.6)]',
  /** Same depth as `panel` but without the inset highlight (flat sheets). */
  panelFlat: 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]',
  /** Menu / popover surface (deeper, more diffuse). */
  menu: 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_12px_36px_rgba(0,0,0,0.10),inset_0_1px_0_rgba(255,255,255,0.6)]',
  /** Modal sheet (deepest, longest-throw). */
  sheet: 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_24px_72px_rgba(0,0,0,0.16)]',
} as const;

/** Border tokens. */
const border = {
  hairline: 'border border-black/[0.08]',
} as const;

/** Text-color tokens. */
const text = {
  primary: 'text-stone-900',
  secondary: 'text-stone-700',
  muted: 'text-stone-500',
} as const;

/** Corner-radius tokens. */
const radius = {
  /** Full pill (use for icon-only round buttons or very short controls). */
  pill: 'rounded-full',
  /** 16px - top-level chrome (navbar shell, dialogs, popovers, flyouts, inspector). */
  capsule: 'rounded-2xl',
  /** 12px - palette wrapper, primary CTAs, inspector tab pills. */
  card: 'rounded-xl',
  /** 8px - buttons, dropdown items, list cards inside dialogs. */
  button: 'rounded-lg',
  /** 6px - inputs, text fields, tabs, chevron-icon hovers. */
  field: 'rounded-md',
  /** 10px - palette tool buttons (chosen for concentric fit inside palette wrapper). */
  paletteTool: 'rounded-[10px]',
} as const;

// --- NavBar

export const navbar = {
  /** Brand link (logo + wordmark) anchored to top-left. */
  brand: 'fixed top-2 left-[-10px] z-50 flex items-center gap-2.5 px-4 h-12 select-none',
  brandImage: 'h-12 w-12',
  brandWordmark: 'text-md leading-none select-none text-violet-800',
  brandWordmarkLight: 'font-light',
  brandWordmarkBold: 'font-semibold',

  // Floating capsule (diagram name + menus). Centered in the safe area between
  // brand and inspector; shifts when `body.inspector-collapsed` widens it.
  shell: `fixed top-2 left-1/2 -translate-x-1/2 z-50 flex items-center h-10
          max-w-[calc(100vw-32px)]
          md:left-[calc(50%-72px)] md:max-w-[calc(100vw-464px)]
          [body.inspector-collapsed_&]:md:left-[calc(50%+55px)]
          [body.inspector-collapsed_&]:md:max-w-[calc(100vw-220px)]
          ${radius.card} ${surface.chrome} ${border.hairline} ${shadow.panelFlat}
          px-1.5`,

  // No horizontal padding - the diagram-name span/input adds its own px-2.
  diagramSlot: 'flex items-center min-w-0 flex-shrink',
  diagramName: `text-[13px] font-medium ${text.secondary} cursor-pointer px-2 py-1 ${radius.field} hover:bg-black/[0.05] transition-colors truncate`,
  diagramNameInput: `text-[13px] font-medium ${text.primary} ${surface.card} ${radius.field} px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-cream-400`,

  // Only ml-1 - adding mr-1 would stack with shell px-1.5 and push Simulate too far right.
  menuContainer: 'flex items-center gap-0.5 ml-1 flex-shrink-0',
} as const;

// --- NavBar primitives

export const navBurgerBtnCls =
  'inline-flex items-center justify-center text-lg font-medium text-stone-700 hover:text-stone-900 hover:bg-black/[0.05] active:bg-black/[0.08] rounded-md h-7 w-7 transition-colors';

/** Vertical 1px divider between diagram name and Simulate inside the navbar. */
export const navDividerCls = 'w-px h-4 bg-black/[0.10] mr-2 ml-2';

// --- Side palette

export const palette = {
  // Outer panel: vertical capsule. rounded-xl reads concentric with the
  // rounded-[10px] inner tool buttons given the ~4px wrapper padding.
  wrapper: `fixed top-1/2 -translate-y-1/2 left-2 z-[210] flex flex-col
            ${radius.card} ${surface.chrome} ${border.hairline} ${shadow.panel}
            py-1 px-1 gap-0.5`,

  /** Section divider between tool / element / more-elements groups. */
  separator: 'my-1 h-px bg-black/[0.08] mx-1',

  /** Hover-anchor wrapper around each palette button + its tooltip. */
  group: 'group relative flex items-center',
  /** Hover-anchor wrapper for groups that own a flyout. */
  groupWithFlyout: 'group/palgroup relative flex items-center',

  /** Generic icon button used by `PaletteButton`. */
  toolButton: `flex items-center justify-center
               w-[34px] h-8 ${radius.paletteTool}
               text-stone-600 cursor-grab
               hover:bg-black/[0.05] hover:text-stone-900
               hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.6)]
               active:bg-black/[0.08]
               transition-all`,

  /** "Has flyout" affordance - small chevron rendered absolutely on the button. */
  groupChevron: 'absolute right-[3px] top-1/2 w-[3px] h-[3px] border-r-[1.4px] border-b-[1.4px] border-stone-600 rotate-[-45deg] -translate-y-1/2',

  /** Floating tooltip span shown on hover next to a palette button. */
  tooltip: `pointer-events-none absolute left-[calc(100%+12px)] top-1/2 -translate-y-1/2
            bg-stone-900/85 backdrop-blur-md text-cream-50 text-[11.5px] font-medium
            px-2.5 py-1 rounded-lg whitespace-nowrap
            opacity-0 group-hover:opacity-100 transition-opacity
            z-[200]`,
} as const;

// --- Palette flyout (per-group panel)

export const paletteFlyout = {
  /** Outer flyout container; visibility toggled by `isOpen`. */
  panel: (isOpen: boolean) => `${isOpen ? 'visible opacity-100 pointer-events-auto' : 'invisible opacity-0 pointer-events-none'}
              transition-opacity duration-150
              absolute left-[calc(100%+10px)] top-[-6px] z-[300]
              w-[272px]
              p-2.5 pb-3
              ${radius.card} ${surface.menu} ${border.hairline} ${shadow.menu}`,

  /** Invisible bridge that keeps hover alive between trigger button and flyout. */
  gapBridge: 'absolute left-[-10px] top-0 w-[10px] h-full',

  /** Group label header at the top of the flyout. */
  header: 'text-xs font-semibold uppercase tracking-[0.1em] text-stone-500 pb-2 mb-2 px-1 border-b border-black/[0.08]',

  /** Thin section header inside a flyout (e.g. "Types", "Templates"). */
  sectionHeader: 'text-[10.5px] font-semibold uppercase tracking-[0.1em] text-stone-400 px-1 mt-2 mb-1 first:mt-0',

  /** Small "EXT" badge next to a schema name to mark third-party extensions. */
  extBadge: 'inline-flex items-center px-1.5 py-px rounded text-[9.5px] font-semibold uppercase tracking-[0.1em] bg-transparent text-current border border-current',

  /** 3-column grid of element tiles. Capped at ~3 rows; scrolls vertically only. */
  grid: 'grid grid-cols-3 gap-1 max-h-56 overflow-y-auto overflow-x-hidden overscroll-contain palette-flyout-scroll',

  /** Individual draggable element tile. */
  item: 'flex flex-col items-center justify-center gap-1 p-2 rounded-lg text-stone-700 hover:text-stone-900 hover:bg-black/[0.05] active:bg-black/[0.08] transition-colors cursor-grab active:cursor-grabbing min-w-0',

  itemLabel: 'text-xs leading-tight text-center text-pretty hyphens-auto w-full',
} as const;

// --- Inspector

export const inspector = {
  wrapper: 'fixed top-2 right-2 z-[220]',
  panel: `relative w-72 ${radius.card} ${surface.chrome} ${border.hairline} ${shadow.panelFlat}
          text-stone-900 max-h-[calc(100vh-80px)] overflow-y-auto`,
  panelHidden: 'hidden',
  panelBody: 'w-full',

  // Toggle is pinned to the viewport (rendered outside the panel); panel's
  // backdrop-filter would otherwise anchor `fixed` to the panel itself.
  toggleButton: `fixed top-3.5 right-3.5 z-[230] flex items-center justify-center
                 w-8 h-8 rounded-md
                 text-stone-500 hover:text-stone-900 hover:bg-black/[0.05]
                 transition-colors`,
  toggleIcon: 'text-[24px]',

  headerTitle: 'pb-0 text-[15px] font-semibold p-2 pb-0 text-stone-900 tracking-tight',
  headerSubtitle: 'text-[10.5px] text-left font-mono px-2 pb-2 text-stone-500',

  tabList: 'flex flex-wrap gap-0.5 px-2 pb-2 border-b border-black/[0.08]',
  tabBase: 'px-1.5 py-1 text-xs font-semibold rounded-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-cream-400',
  tabSelected: 'bg-stone-900 text-cream-50 shadow-sm',
  tabUnselected: 'text-stone-600 hover:bg-black/[0.05] hover:text-stone-900 cursor-pointer',
  tabPanels: 'p-1',
  tabPanel: 'rounded-xl',
} as const;

// --- Inspector fields

export const field = {
  field: 'mx-2 pb-2',

  label: 'flex items-center justify-between text-sm font-semibold',
  helpAnchor: 'relative group/help',
  helpIcon: 'iconify bi--patch-question text-stone-400 cursor-help',
  helpTooltip: 'absolute bottom-full right-0 mb-1 invisible group-hover/help:visible w-64 bg-stone-900 text-xs text-cream-200 p-2 rounded-lg shadow-xl z-50',
  helpTooltipWide: 'absolute bottom-full right-0 mb-1 invisible group-hover/help:visible max-w-md w-64 bg-stone-900 text-xs text-cream-200 p-2 rounded-lg shadow-xl z-50',
  helpTooltipName: 'font-mono text-xs font-bold text-cream-50',

  // cream-200 inputs sit recessed inside the cream-100 inspector panel.
  textInput: 'px-2 py-1 w-full rounded-md border border-black/[0.08] bg-cream-200 font-mono text-sm/6 text-stone-900 placeholder-stone-400 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400',
  textArea: 'px-2 py-1 w-full rounded-md border border-black/[0.08] bg-cream-200 font-mono text-sm/4 text-stone-900 placeholder-stone-400 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400',

  selectWrapper: 'relative',
  select: 'appearance-none px-2 py-1 pr-8 w-full rounded-md border border-black/[0.08] bg-cream-200 text-sm/6 text-stone-900 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400',
  selectChevron: 'group iconify bi--caret-down pointer-events-none absolute top-1.5 right-2.5 text-stone-500',

  /* Editable combobox - text input + chevron-triggered options panel. */
  comboInput: 'appearance-none px-2 py-1 pr-8 w-full rounded-md border border-black/[0.08] bg-cream-200 font-mono text-sm/6 text-stone-900 placeholder-stone-400 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400',
  comboChevronBtn: 'absolute top-0 right-0 h-full w-7 flex items-center justify-center text-stone-500 hover:text-stone-900 cursor-pointer',
  comboChevronIndicator: 'pointer-events-none absolute top-0 right-0 h-full w-7 flex items-center justify-center text-stone-500',
  comboChevronIcon: 'iconify bi--caret-down text-[12px]',
  comboOptions: 'z-[240] mt-1 w-[var(--input-width)] max-h-56 overflow-auto rounded-md border border-black/[0.08] bg-cream-100 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_12px_36px_rgba(0,0,0,0.10)] py-1 focus:outline-none [--anchor-gap:4px]',
  comboOption: 'px-2.5 py-1 text-sm/6 text-stone-800 data-[focus]:bg-black/[0.05] data-[selected]:font-semibold cursor-pointer',

  /* Listbox (non-editable enum) - button trigger styled like an input field. */
  listboxBtn: 'appearance-none px-2 py-1 pr-8 w-full text-left rounded-md border border-black/[0.08] bg-cream-200 text-sm/6 text-stone-900 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400 cursor-pointer',
  listboxOptions: 'z-[240] mt-1 w-[var(--button-width)] max-h-56 overflow-auto rounded-md border border-black/[0.08] bg-cream-100 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_12px_36px_rgba(0,0,0,0.10)] py-1 focus:outline-none [--anchor-gap:4px]',

  booleanRow: 'flex items-center justify-between',
  booleanGroup: 'flex items-center gap-2',
  checkbox: 'group block size-4 rounded border border-black/[0.20] bg-cream-200 data-[checked]:bg-stone-900 data-[checked]:border-stone-900',
  checkboxIcon: 'stroke-cream-50 opacity-0 group-data-[checked]:opacity-100',

  /* Array (isMany String) field - list editor with inferred-from-connections rows. */
  arrayList: 'flex flex-col gap-1 mt-1',
  arrayRow: 'relative',
  arrayInput: 'px-2 py-1 pr-7 w-full rounded-md border border-black/[0.08] bg-cream-200 font-mono text-sm/6 text-stone-900 placeholder-stone-400 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400',
  arrayRemoveBtn: 'absolute top-1/2 right-1.5 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-stone-400 hover:text-stone-900 hover:bg-black/[0.05] cursor-pointer',
  arrayAddBtn: 'self-start w-7 h-7 flex items-center justify-center rounded-md text-stone-500 hover:text-stone-900 hover:bg-black/[0.05] cursor-pointer',
  arrayInferredInput: 'px-2 py-1 pr-16 w-full rounded-md border border-dashed border-black/[0.20] bg-cream-100 font-mono italic text-sm/6 text-stone-500 placeholder-stone-400 focus:outline-none focus:border-black/[0.45]',
  arrayInferredLabel: 'pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 italic text-[11.5px] text-stone-400',
} as const;

// --- Code-editor modal (inside the inspector)

export const codeEditor = {
  openButton: 'w-full mt-2 p-1.5 rounded-md cursor-pointer bg-cream-200 hover:bg-cream-300 text-stone-700 hover:text-stone-900 border border-black/[0.08] transition-colors',
  // Overlay sits above the inspector (z-[220]) and inspector toggle (z-[230]),
  // and above the Headless UI dialog root (z-[240]/z-[250]) so the editor
  // covers any palette/inspector content it might be opened from.
  modalOverlay: 'fixed inset-0 z-[260] flex items-center justify-center p-4 backdrop-blur-xs',
  modalBackdrop: 'absolute',
  modal: 'relative z-[270] bg-cream-100 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_24px_72px_rgba(0,0,0,0.16)] border border-black/[0.06] w-full max-w-4xl max-h-[90vh] overflow-auto',
  modalHeader: 'px-4 py-3 flex justify-between items-center border-b border-black/[0.06]',
  modalTitle: 'text-[15px] font-semibold tracking-tight text-stone-900',
  modalClose: 'text-sm text-stone-500 hover:text-stone-800 cursor-pointer',
  modalSection: 'p-4',
  modalSubLabel: 'block text-sm font-medium mb-2 text-stone-700',
  modalLanguageSelect: 'appearance-none p-2 w-full rounded-md border border-black/[0.08] text-sm text-stone-800 bg-cream-200',
  modalEditorFrame: 'w-full h-[40vh] max-h-[50vh] overflow-auto rounded-lg bg-cream-200 border border-black/[0.06] focus-within:outline-2 focus-within:-outline-offset-2 focus-within:outline-cream-400',
  modalEditor: 'min-h-full font-mono text-sm/6 text-stone-900',
  modalActions: 'p-4 flex justify-end gap-2 border-t border-black/[0.06]',
  modalCancelBtn: 'px-3 py-1.5 rounded-lg cursor-pointer text-stone-700 hover:bg-black/[0.05]',
  modalSaveBtn: 'px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-cream-50 rounded-lg cursor-pointer font-medium',
} as const;

// --- Modeler shell + canvas

export const modeler = {
  /** Loading-state container - full-height, canvas-colored. */
  loading: `flex flex-1 h-full text-center ${surface.canvas}`,
  loadingSpinner: 'm-auto animate-spin',
  loadingIcon: 'iconify bi--arrow-repeat text-stone-500 text-[3rem]',
  /** Modeler canvas (where bpmn-js renders). */
  canvas: `grow ${surface.canvas}`,
} as const;

// --- Dialog primitives (Login / Publish / Examples) 

export const dialog = {
  /** Headless UI <Dialog> root. Sits above the inspector (`z-[220]`) and its
   * toggle (`z-[230]`) so modals like Examples/Publish/Login fully cover the
   * side panel. */
  root: 'relative z-[240] focus:outline-none',
  /** Backdrop overlay covering the viewport with a blur. */
  backdrop: 'fixed backdrop-blur inset-0 z-10 w-screen overflow-y-auto',
  /** Centered layout for the panel inside the backdrop. */
  centerLayout: 'flex min-h-full items-center justify-center p-4',

  /**
   * Solid sheet - cream-100 with hairline border + sheet shadow.
   * Combine with `panelMd` / `panelLg` for width.
   */
  panel: `${radius.capsule} ${surface.sheet} border border-black/[0.06] p-7 ${shadow.sheet} duration-300 ease-out closed:transform-[scale(95%)] closed:opacity-0 z-[102]`,
  panelMd: 'w-full max-w-md',
  panelLg: 'w-full max-w-2xl',

  title: 'text-[17px] tracking-tight text-stone-900 font-semibold',
  closeButton: 'text-sm/6 text-stone-500 hover:text-stone-900 ml-2 float-end cursor-pointer transition-colors',

  body: 'text-sm text-stone-600',
  bodyLink: 'text-stone-900 underline hover:no-underline',

  fieldset: 'space-y-6',
  label: 'text-sm font-medium text-stone-800',
  /** Mono-font input recessed against the dialog panel. */
  input: `mt-2 block w-full ${radius.button} border border-black/[0.08] ${surface.card} py-2 px-3 font-mono text-sm/6 text-stone-900 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400`,
  helpText: 'text-xs text-stone-500 mt-1.5',

  /** Dark espresso primary CTA. */
  primaryBtn: `${radius.button} bg-stone-900 hover:bg-stone-800 py-1.5 px-3.5 text-sm/6 text-cream-50 font-medium transition-colors cursor-pointer`,
  /** Emerald "Preview" CTA used by Publish on success. */
  previewBtn: `inline-flex items-center gap-2 ${radius.button} bg-emerald-600 hover:bg-emerald-700 py-1.5 px-3.5 text-sm/6 text-white font-medium transition-colors`,

  statusText: 'text-sm text-stone-600 m-auto',
} as const;

// --- Command palette (burger -> search dialog)

export const commandPalette = {
  /**
   * Headless UI <Dialog> root. Sits above the inspector (`z-[220]`) but below
   * the settings overlay (`z-[300]`) - when the palette opens, the rest of
   * the chrome recedes behind a single soft blur.
   */
  root: 'relative z-[250] focus:outline-none',
  /** Backdrop: light blur, full viewport. */
  backdrop: 'fixed inset-0 z-10 backdrop-blur',
  /** Top-aligned layout (palette feels natural near the top, not centered). */
  layout: 'fixed inset-0 z-20 flex items-start justify-center pt-[15vh] p-4 overflow-y-auto',
  /** The palette sheet itself - cream-100 with hairline border + sheet shadow. */
  panel: `w-full max-w-lg ${radius.capsule} ${surface.sheet} border border-black/[0.06] ${shadow.sheet}
          duration-200 ease-out closed:transform-[scale(98%)] closed:opacity-0 overflow-hidden`,

  /** Top input row with search icon. */
  searchRow: 'flex items-center gap-3 px-4 h-12 border-b border-black/[0.06]',
  searchIcon: 'iconify bi--search text-stone-400 text-[14px] shrink-0',
  searchInput: `flex-1 bg-transparent text-[14px] ${text.primary} placeholder-stone-400 focus:outline-none`,

  /** Scrollable list area below the search input. */
  list: 'max-h-[55vh] overflow-y-auto p-1.5',
  empty: 'text-[13px] text-stone-500 italic py-8 text-center',

  /** Group label (small caps, like inspector flyout headers). */
  groupLabel: 'text-[10.5px] font-semibold uppercase tracking-[0.1em] text-stone-500 px-3 pt-2.5 pb-1',

  /** Single command row. */
  item: `flex items-center gap-3 w-full text-left px-3 py-2 ${radius.button}
         text-[13px] ${text.secondary} cursor-pointer transition-colors`,
  itemActive: 'bg-black/[0.05] text-stone-900',
  itemIcon: 'text-[15px] text-stone-500 shrink-0 w-5 text-center',
  itemLabel: 'flex-1 truncate',
  itemHint: 'text-[11px] font-mono text-stone-400 shrink-0',
} as const;

// --- Examples-dialog list cards

export const examplesList = {
  list: 'space-y-1.5 max-h-[60vh] overflow-y-auto',
  empty: 'text-sm text-stone-500 italic py-10 text-center',
  item: `w-full text-left ${radius.card} ${surface.card} border border-black/[0.06] hover:bg-cream-300 hover:border-black/[0.10] disabled:opacity-50 disabled:cursor-not-allowed transition-all p-4 cursor-pointer`,
  itemHeader: 'flex items-baseline justify-between gap-3',
  itemTitle: 'font-semibold tracking-tight text-stone-900',
  itemFilename: 'font-mono text-[11px] text-stone-500 shrink-0',
  itemDescription: 'text-[13px] leading-relaxed text-stone-600 mt-1 line-clamp-3',
  itemError: 'text-[13px] text-red-500 mt-1',
  itemBusy: 'text-xs text-stone-500 mt-1',
} as const;

export const settingsView = {
  /** Backdrop sits over the modeler with a margin so the panel is inset from the edges. */
  root: `fixed inset-0 z-[300] p-16 px-48 flex bg-black/40 backdrop-blur-xs`,
  /** Inset panel containing the actual settings UI. */
  panel: `flex flex-1 flex-col overflow-hidden ${surface.sheet} ${radius.capsule} border border-black/[0.08] ${shadow.sheet}`,

  header: `flex items-center gap-2 px-3 h-14 shrink-0 border-b border-black/[0.06] ${surface.sheet}`,
  headerTitle: `text-[15px] font-semibold tracking-tight ${text.primary}`,
  backButton: `flex items-center justify-center w-8 h-8 ${radius.field}
                ${text.muted} hover:text-stone-900 hover:bg-black/[0.05]
                active:bg-black/[0.08] transition-colors cursor-pointer`,
  backIcon: 'iconify bi--arrow-left text-[16px]',

  /** Two-column body: sidebar + content scroll area. */
  body: 'flex flex-1 min-h-0',

  /** Left sidebar - section navigation. */
  sidebar: `w-60 shrink-0 border-r border-black/[0.06] py-4 px-3 overflow-y-auto ${surface.sheet}`,
  sidebarItem: `flex items-center gap-2.5 w-full text-left px-3 py-1.5 ${radius.button}
                text-[13px] font-medium ${text.secondary}
                hover:bg-black/[0.05] hover:text-stone-900 active:bg-black/[0.08]
                transition-colors cursor-pointer`,
  sidebarItemActive: 'bg-black/[0.05] text-stone-900',
  sidebarItemIcon: 'text-[15px] text-stone-500 shrink-0',

  /** Right content area - scrollable, max-width-constrained. */
  content: 'flex-1 overflow-y-auto px-4 py-8',
  contentInner: 'mx-auto max-w-2xl space-y-8',

  /** Section header (large title at the top of the right pane). */
  sectionTitle: `text-[22px] font-semibold tracking-tight ${text.primary}`,
  sectionDescription: `text-[13px] ${text.muted} mt-1`,

  /** A single setting row - label on the left, control on the right. */
  row: 'flex items-start justify-between gap-6 py-4 border-b border-black/[0.06] last:border-b-0',
  rowText: 'flex-1 min-w-0',
  rowLabel: `text-[14px] font-medium ${text.primary}`,
  rowHelp: `text-[12.5px] ${text.muted} mt-0.5 leading-relaxed`,
  rowControl: 'shrink-0 flex items-center',

  /** Card wrapping a group of related rows. */
  group: `${radius.card} ${surface.card} border border-black/[0.06] px-4 py-1`,

  /** Inline buttons used inside rows (e.g. "Clear data", "Sign out"). */
  inlineBtn: `${radius.button} bg-cream-200 hover:bg-cream-300 active:bg-cream-400
              border border-black/[0.06] py-1.5 px-3 text-[14px] ${text.secondary}
              hover:text-stone-900 transition-colors cursor-pointer`,
  inlineBtnDanger: `${radius.button} bg-red-50 hover:bg-red-100 active:bg-red-200
                    border border-red-200 py-1.5 px-3 text-[13px] text-red-700
                    hover:text-red-900 transition-colors cursor-pointer`,

  /** Compact <select> aligned with the existing inspector field style. */
  select: `appearance-none px-2.5 py-1 pr-8 ${radius.field}
           border border-black/[0.08] bg-cream-100 text-[13px] text-stone-900
           focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400 cursor-pointer`,
  selectWrapper: 'relative',
  selectChevron: 'iconify bi--caret-down pointer-events-none absolute top-2.5 right-2 text-stone-500 text-[12px]',

  /** API-key style input - recessed and monospace. */
  textInput: `px-2.5 py-1.5 w-72 max-w-full ${radius.field}
              border border-black/[0.08] bg-cream-100 font-mono text-[13px] text-stone-900
              placeholder-stone-400 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400`,

  /** Switch (track + thumb). Wraps a Headless UI <Switch>. */
  switchTrack: `relative flex h-5 w-9 cursor-pointer ${radius.pill}
                bg-cream-300 p-0.5 transition-colors
                data-[checked]:bg-stone-900 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400`,
  switchThumb: `pointer-events-none inline-block size-4 ${radius.pill} bg-cream-50 shadow ring-0
                transition duration-200 ease-in-out
                translate-x-0 group-data-[checked]:translate-x-4`,

  /** Static value display (e.g. "Guest" account state). */
  valueChip: `inline-flex items-center gap-1.5 px-2 py-0.5 ${radius.field}
              bg-cream-200 border border-black/[0.06] text-[12px] font-medium ${text.secondary}`,

  /** Subtle footnote at the bottom of the sidebar (version / build info). */
  sidebarFooter: 'mt-6 px-3 text-[11px] text-stone-400',
} as const;
