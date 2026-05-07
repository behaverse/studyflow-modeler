/**
 * source of truth for v1 modeler styling.
 *
 *   1. `src/assets/css/app.css`
 *      - `@theme { --color-cream-* }` color tokens
 *
 *   2. `src/modeler/styles.ts`  ← this file
 *      - Reusable tokens
 *      - Per-module themes

 */

// --- 1. Token blocks 

/** Background-surface tokens. */
export const surface = {
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
  /** Hover state for `card`. */
  cardHover: 'bg-cream-300',
} as const;

/** Layered drop-shadow recipes. */
export const shadow = {
  /** Floating chrome panel (navbar pill, palette wrapper, inspector panel). */
  panel: 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.6)]',
  /** Same depth as `panel` but without the inset highlight (flat sheets). */
  panelFlat: 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_24px_rgba(0,0,0,0.06)]',
  /** Menu / popover surface (deeper, more diffuse). */
  menu: 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_12px_36px_rgba(0,0,0,0.10),inset_0_1px_0_rgba(255,255,255,0.6)]',
  /** Modal sheet (deepest, longest-throw). */
  sheet: 'shadow-[0_1px_3px_rgba(0,0,0,0.04),0_24px_72px_rgba(0,0,0,0.16)]',
} as const;

/** Border / divider tokens. */
export const border = {
  hairline: 'border border-black/[0.08]',
  hairlineStrong: 'border border-black/[0.10]',
  /** Background color used for 1px divider <hr>-style elements. */
  divider: 'bg-black/[0.08]',
  /** Vertical 1px divider used inside the navbar shell. */
  dividerStrong: 'bg-black/[0.10]',
} as const;

/**
 * Hover / active wash tokens — subtle dark wash on cream surfaces.
 * Use as full strings (Tailwind detects `hover:bg-black/[0.05]` literally).
 */
export const interaction = {
  hover: 'hover:bg-black/[0.05]',
  active: 'active:bg-black/[0.08]',
  press: 'hover:bg-black/[0.05] active:bg-black/[0.08]',
} as const;

/** Text-color tokens. */
export const text = {
  primary: 'text-stone-900',
  secondary: 'text-stone-700',
  muted: 'text-stone-500',
  faint: 'text-stone-400',
} as const;

/** Corner-radius tokens. */
export const radius = {
  /** Full pill (use for icon-only round buttons or very short controls). */
  pill: 'rounded-full',
  /** 16px — top-level chrome (navbar shell, dialogs, popovers, flyouts, inspector). */
  capsule: 'rounded-2xl',
  /** 12px — palette wrapper, primary CTAs, inspector tab pills. */
  card: 'rounded-xl',
  /** 8px — buttons, dropdown items, list cards inside dialogs. */
  button: 'rounded-lg',
  /** 6px — inputs, text fields, tabs, chevron-icon hovers. */
  field: 'rounded-md',
  /** 10px — palette tool buttons (chosen for concentric fit inside palette wrapper). */
  paletteTool: 'rounded-[10px]',
} as const;

// --- 2. NavBar 

export const navbar = {
  /** Brand link (logo + wordmark) anchored to top-left. */
  brand: 'fixed top-2 left-[-10px] z-50 flex items-center gap-2.5 px-4 h-12 select-none',
  brandImage: 'h-12 w-12',
  brandWordmark: 'text-md leading-none select-none text-violet-800',
  brandWordmarkLight: 'font-light',
  brandWordmarkBold: 'font-semibold',

  /**
   * Floating capsule containing the diagram name + menus.
   * Uses the same 12px radius as the palette wrapper so the three
   * floating chrome panels (navbar / palette / inspector) read as one
   * coherent corner family.
   *
   * Padding is `px-1.5` (6px) — matched to the ~6px vertical breathing
   * room that h-7 children get inside h-10, so items sit equidistant
   * from all four navbar borders.
   */
  /**
   * Centered in the empty space between the brand (~160px from viewport-left)
   * and the inspector. When the inspector is expanded the safe area ends at
   * `viewport - 296` (w-72 + right-2), so the shell's center is shifted
   * 72px LEFT of viewport center. When the inspector is collapsed (only its
   * ~50px toggle button remains on the right), the safe area is much wider
   * and the shell shifts 55px RIGHT of viewport center. The toggle is keyed
   * on `body.inspector-collapsed`, set by the Panel component.
   */
  shell: `fixed top-2 left-1/2 -translate-x-1/2 z-50 flex items-center h-10
          max-w-[calc(100vw-32px)]
          md:left-[calc(50%-72px)] md:max-w-[calc(100vw-464px)]
          [body.inspector-collapsed_&]:md:left-[calc(50%+55px)]
          [body.inspector-collapsed_&]:md:max-w-[calc(100vw-220px)]
          ${radius.card} ${surface.chrome} ${border.hairline} ${shadow.panelFlat}
          px-1.5`,

  /**
   * Slot has no horizontal padding — the diagram-name span / input adds
   * its own `px-2`. Stacking another `px-2` here would make the left
   * edge feel ~2× more padded than the top/bottom.
   */
  diagramSlot: 'flex items-center min-w-0 flex-shrink',
  diagramName: `text-[13px] font-medium ${text.secondary} cursor-pointer px-2 py-1 ${radius.field} hover:bg-black/[0.05] transition-colors truncate`,
  diagramNameInput: `text-[13px] font-medium ${text.primary} ${surface.card} ${radius.field} px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-cream-400`,

  /**
   * Only `ml-1` (left margin) — the right margin would stack with the
   * shell's `px-1.5` and push Simulate ~10px from the navbar's right edge,
   * exceeding the ~6px vertical breathing room. Keep the left margin so
   * menus sit a comfortable gap away from the diagram name.
   */
  menuContainer: 'flex items-center gap-0.5 ml-1 flex-shrink-0',
} as const;

// --- 3. NavBar menu primitives (consumed by `MenuBar.tsx`)

export const navBtnCls =
  'text-[13px] font-medium text-stone-700 hover:text-stone-900 hover:bg-black/[0.05] active:bg-black/[0.08] rounded-md h-7 px-2.5 transition-colors';

export const navBurgerBtnCls =
  'inline-flex items-center justify-center text-lg font-medium text-stone-700 hover:text-stone-900 hover:bg-black/[0.05] active:bg-black/[0.08] rounded-md h-7 w-7 transition-colors';

/**
 * Headless UI <MenuItems> dropdown panel. Stronger cream character than the
 * shell so menus pop, but the same 12px radius as the navbar / palette /
 * inspector so every floating chrome surface shares one corner family.
 *
 * Padding is on the dropdown (`px-1 py-1`), not on items — see `itemCls`.
 */
export const dropdownCls = `${surface.menu} ${border.hairline} text-stone-800 ${radius.card} shadow-[0_1px_3px_rgba(0,0,0,0.04),0_12px_36px_rgba(0,0,0,0.10)] z-50 px-1 py-1 min-w-44`;

/**
 * Single dropdown item. Padding lives on the dropdown container above so
 * items can use `w-full` (the standard for menu buttons) without spilling
 * past the panel's right edge — `width: 100%` + `mx-1` would render at
 * `parent + 8px`, which is what produced the visible overflow on the File
 * / View menus before.
 */
export const itemCls =
  'px-3 py-1.5 text-[13px] text-stone-800 hover:bg-black/[0.05] active:bg-black/[0.08] rounded-lg cursor-pointer transition-colors';

/** Horizontal divider inside a dropdown. */
export const sepCls = 'h-px bg-black/[0.08] my-1 mx-2';

/**
 * Vertical 1px divider used inside the navbar shell (between diagram name and
 * Simulate). The diagram-name span has internal `px-2` (8px) which the eye
 * reads as part of the gap before the line, so the divider only needs right
 * margin to balance perceptually against the colored Simulate button.
 */
export const navDividerCls = 'w-px h-4 bg-black/[0.10] mr-2 ml-2';

// --- 4. Side palette

export const palette = {
  /**
   * Outer floating palette panel — vertical capsule, cream-100 with vibrancy.
   *
   * Radius is chosen to be concentric with inner tool buttons (`rounded-[10px]`
   * + ~4px horizontal padding ≈ 14px outer): `rounded-xl` (12px) reads as
   * a clean nested shape without a visible gap between item hover-pills
   * and the wrapper corner.
   */
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

  /** "Has flyout" affordance — small chevron rendered absolutely on the button. */
  groupChevron: 'absolute right-[3px] top-1/2 w-[3px] h-[3px] border-r-[1.4px] border-b-[1.4px] border-stone-600 rotate-[-45deg] -translate-y-1/2',

  /** Floating tooltip span shown on hover next to a palette button. */
  tooltip: `pointer-events-none absolute left-[calc(100%+12px)] top-1/2 -translate-y-1/2
            bg-stone-900/85 backdrop-blur-md text-cream-50 text-[11.5px] font-medium
            px-2.5 py-1 rounded-lg whitespace-nowrap
            opacity-0 group-hover:opacity-100 transition-opacity
            z-[200]`,
} as const;

// --- 5. Palette flyout (per-group panel)

export const paletteFlyout = {
  /**
   * Outer flyout container (per-group). Visibility toggled via `isOpen`.
   * Uses the same 12px radius as the palette wrapper / navbar / inspector
   * so every floating chrome surface shares one corner family.
   */
  panel: (isOpen: boolean) => `${isOpen ? 'visible opacity-100 pointer-events-auto' : 'invisible opacity-0 pointer-events-none'}
              transition-all duration-150
              absolute left-[calc(100%+10px)] top-[-6px] z-[300]
              w-[240px] p-2.5 pb-3
              ${radius.card} ${surface.menu} ${border.hairline} ${shadow.menu}`,

  /** Invisible bridge that keeps hover alive between trigger button and flyout. */
  gapBridge: 'absolute left-[-10px] top-0 w-[10px] h-full',

  /** Group label header at the top of the flyout. */
  header: 'text-xs font-semibold uppercase tracking-[0.1em] text-stone-500 pb-2 mb-2 px-1 border-b border-black/[0.08]',

  /** 3-column grid of element tiles. */
  grid: 'grid grid-cols-3 gap-1',

  /** Individual draggable element tile. */
  item: 'flex flex-col items-center justify-center gap-1 p-2 rounded-lg text-stone-700 hover:text-stone-900 hover:bg-black/[0.05] active:bg-black/[0.08] transition-colors cursor-grab active:cursor-grabbing',

  itemLabel: 'text-xs leading-tight text-center',
} as const;

// --- 6. Inspector

export const inspector = {
  wrapper: 'fixed top-2 right-2 z-[220]',
  /**
   * Inspector panel — translucent cream-100 with vibrancy. Floats with
   * margin from the viewport edges (Claude.ai pattern), all corners
   * rounded with the same 12px radius as the navbar / palette.
   */
  panel: `relative w-72 ${radius.card} ${surface.chrome} ${border.hairline} ${shadow.panelFlat}
          text-stone-900 max-h-[calc(100vh-80px)] overflow-y-auto`,
  panelHidden: 'hidden',
  panelBody: 'w-full',

  /**
   * Pin to viewport so the position doesn't shift between Show / Hide states.
   * Lives outside the panel because `backdrop-filter` on the panel would
   * otherwise establish a containing block for `position: fixed` and anchor
   * the toggle to the panel rather than the viewport.
   */
  toggleButton: `fixed top-3.5 right-3.5 z-[230] flex items-center justify-center
                 w-8 h-8 rounded-md
                 text-stone-500 hover:text-stone-900 hover:bg-black/[0.05]
                 transition-colors`,
  toggleIcon: 'text-[24px]',

  headerTitle: 'pb-0 text-[15px] font-semibold p-2 pb-0 text-stone-900 tracking-tight',
  headerSubtitle: 'text-[10.5px] text-left font-mono px-2 pb-2 text-stone-500',

  tabList: 'flex flex-wrap gap-1 px-2 pb-2 border-b border-black/[0.08]',
  tabBase: 'px-2.5 py-1 text-xs font-semibold rounded-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-cream-400',
  tabSelected: 'bg-stone-900 text-cream-50 shadow-sm',
  tabUnselected: 'text-stone-600 hover:bg-black/[0.05] hover:text-stone-900 cursor-pointer',
  tabPanels: 'p-1',
  tabPanel: 'rounded-xl',
} as const;

// --- 7. Inspector fields

export const field = {
  field: 'mx-2 pb-2',

  label: 'flex items-center justify-between text-sm font-semibold',
  helpAnchor: 'relative group/help',
  helpIcon: 'iconify bi--patch-question text-stone-400 cursor-help',
  helpTooltip: 'absolute bottom-full right-0 mb-1 invisible group-hover/help:visible w-64 bg-stone-900 text-xs text-cream-200 p-2 rounded-lg shadow-xl z-50',
  helpTooltipWide: 'absolute bottom-full right-0 mb-1 invisible group-hover/help:visible max-w-md w-64 bg-stone-900 text-xs text-cream-200 p-2 rounded-lg shadow-xl z-50',
  helpTooltipName: 'font-mono text-xs font-bold text-cream-50',

  /**
   * Inputs sit inside the cream-100 inspector panel; cream-200 gives a
   * subtle recessed warm-on-warm contrast (no cool gray on cream).
   */
  textInput: 'px-2 py-1 w-full rounded-md border border-black/[0.08] bg-cream-200 font-mono text-sm/6 text-stone-900 placeholder-stone-400 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400',
  textArea: 'px-2 py-1 w-full rounded-md border border-black/[0.08] bg-cream-200 font-mono text-sm/4 text-stone-900 placeholder-stone-400 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400',

  selectWrapper: 'relative',
  select: 'appearance-none px-2 py-1 pr-8 w-full rounded-md border border-black/[0.08] bg-cream-200 text-sm/6 text-stone-900 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400',
  selectChevron: 'group iconify bi--caret-down pointer-events-none absolute top-1.5 right-2.5 text-stone-500',

  booleanRow: 'flex items-center justify-between',
  booleanGroup: 'flex items-center gap-2',
  checkbox: 'group block size-4 rounded border border-black/[0.20] bg-cream-200 data-[checked]:bg-stone-900 data-[checked]:border-stone-900',
  checkboxIcon: 'stroke-cream-50 opacity-0 group-data-[checked]:opacity-100',

  /* Array (isMany String) field — list editor with inferred-from-connections rows. */
  arrayList: 'flex flex-col gap-1 mt-1',
  arrayRow: 'relative',
  arrayInput: 'px-2 py-1 pr-7 w-full rounded-md border border-black/[0.08] bg-cream-200 font-mono text-sm/6 text-stone-900 placeholder-stone-400 focus:outline-2 focus:-outline-offset-2 focus:outline-cream-400',
  arrayRemoveBtn: 'absolute top-1/2 right-1.5 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-stone-400 hover:text-stone-900 hover:bg-black/[0.05] cursor-pointer',
  arrayAddBtn: 'self-start w-7 h-7 flex items-center justify-center rounded-md text-stone-500 hover:text-stone-900 hover:bg-black/[0.05] cursor-pointer',
  arrayInferredInput: 'px-2 py-1 pr-16 w-full rounded-md border border-dashed border-black/[0.20] bg-cream-100 font-mono italic text-sm/6 text-stone-500 placeholder-stone-400 focus:outline-none focus:border-black/[0.45]',
  arrayInferredLabel: 'pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 italic text-[11.5px] text-stone-400',
} as const;

// --- 8. Code-editor modal (inside the inspector)

export const codeEditor = {
  openButton: 'w-full mt-2 p-1.5 rounded-md cursor-pointer bg-cream-200 hover:bg-cream-300 text-stone-700 hover:text-stone-900 border border-black/[0.08] transition-colors',
  modalOverlay: 'fixed inset-0 z-150 flex items-center justify-center p-4 backdrop-blur-xs',
  modalBackdrop: 'absolute',
  modal: 'relative z-160 bg-cream-100 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04),0_24px_72px_rgba(0,0,0,0.16)] border border-black/[0.06] w-full max-w-4xl max-h-[90vh] overflow-auto',
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

// --- 9. Modeler shell + canvas 

export const modeler = {
  /** Loading-state container — full-height, canvas-colored. */
  loading: `flex h-full text-center ${surface.canvas}`,
  loadingSpinner: 'm-auto animate-spin',
  loadingIcon: 'iconify bi--arrow-repeat text-stone-500 text-[3rem]',
  /** Modeler canvas (where bpmn-js renders). */
  canvas: `grow ${surface.canvas}`,
} as const;

// --- 10. Dialog primitives (Login / Publish / Examples) 

export const dialog = {
  /** Headless UI <Dialog> root. */
  root: 'relative z-[101] focus:outline-none',
  /** Backdrop overlay covering the viewport with a blur. */
  backdrop: 'fixed backdrop-blur inset-0 z-10 w-screen overflow-y-auto',
  /** Centered layout for the panel inside the backdrop. */
  centerLayout: 'flex min-h-full items-center justify-center p-4',

  /**
   * Solid sheet — cream-100 with hairline border + sheet shadow.
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
  secondaryBtn: `${radius.button} bg-cream-200 hover:bg-cream-300 py-1.5 px-3.5 text-sm/6 text-stone-800 cursor-pointer transition-colors`,
  /** Emerald "Preview" CTA used by Publish on success. */
  previewBtn: `inline-flex items-center gap-2 ${radius.button} bg-emerald-600 hover:bg-emerald-700 py-1.5 px-3.5 text-sm/6 text-white font-medium transition-colors`,

  errorText: 'text-red-500 text-sm',
  statusText: 'text-sm text-stone-600 m-auto',
} as const;

// --- 10b. Command palette (burger → search dialog)

export const commandPalette = {
  /**
   * Headless UI <Dialog> root. Sits above the inspector (`z-[220]`) but below
   * the settings overlay (`z-[300]`) — when the palette opens, the rest of
   * the chrome recedes behind a single soft blur.
   */
  root: 'relative z-[250] focus:outline-none',
  /** Backdrop: light blur, full viewport. */
  backdrop: 'fixed inset-0 z-10 backdrop-blur',
  /** Top-aligned layout (palette feels natural near the top, not centered). */
  layout: 'fixed inset-0 z-20 flex items-start justify-center pt-[15vh] p-4 overflow-y-auto',
  /** The palette sheet itself — cream-100 with hairline border + sheet shadow. */
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

// --- 11. Examples-dialog list cards

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

  /** Left sidebar — section navigation. */
  sidebar: `w-60 shrink-0 border-r border-black/[0.06] py-4 px-3 overflow-y-auto ${surface.sheet}`,
  sidebarGroupLabel: 'text-xs font-semibold uppercase tracking-[0.1em] text-stone-500 px-3 pt-2 pb-1',
  sidebarItem: `flex items-center gap-2.5 w-full text-left px-3 py-1.5 ${radius.button}
                text-[13px] font-medium ${text.secondary}
                hover:bg-black/[0.05] hover:text-stone-900 active:bg-black/[0.08]
                transition-colors cursor-pointer`,
  sidebarItemActive: 'bg-black/[0.05] text-stone-900',
  sidebarItemIcon: 'text-[15px] text-stone-500 shrink-0',

  /** Right content area — scrollable, max-width-constrained. */
  content: 'flex-1 overflow-y-auto px-4 py-8',
  contentInner: 'mx-auto max-w-2xl space-y-8',

  /** Section header (large title at the top of the right pane). */
  sectionTitle: `text-[22px] font-semibold tracking-tight ${text.primary}`,
  sectionDescription: `text-[13px] ${text.muted} mt-1`,

  /** A single setting row — label on the left, control on the right. */
  row: 'flex items-start justify-between gap-6 py-4 border-b border-black/[0.06] last:border-b-0',
  rowText: 'flex-1 min-w-0',
  rowLabel: `text-[14px] font-medium ${text.primary}`,
  rowHelp: `text-[12.5px] ${text.muted} mt-0.5 leading-relaxed`,
  rowControl: 'shrink-0 flex items-center',

  /** Card wrapping a group of related rows. */
  group: `${radius.card} ${surface.card} border border-black/[0.06] px-4 py-1`,
  groupTitle: `text-[13px] font-semibold ${text.primary} mb-2`,

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

  /** API-key style input — recessed and monospace. */
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
