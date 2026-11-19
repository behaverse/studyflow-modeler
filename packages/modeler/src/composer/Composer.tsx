import { useContext, useEffect, useRef } from 'react';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import type { Issue } from '@core/checks';
import { ModeContext } from '@modeler/app/contexts';
import { useDialogs } from '@modeler/app/Dialogs';
import { useModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { OPEN_PALETTE_SHORTCUT_LABEL } from '@modeler/commandPalette/CommandPalette';
import { usePalette } from '@modeler/commandPalette/PaletteProvider';
import { faceOf } from '@modeler/composer/face';
import { useIsBlank, useProblems, useSelection } from '@modeler/composer/hooks';
import { dismissRunQuestion, pressRun, recheckRunQuestion, startRun, useRunQuestion } from '@modeler/composer/run';
import { composer as s } from '@modeler/composer/styles';
import { ReplayFace } from '@modeler/provenance/Replay';
import { ReviewFace } from '@modeler/review/ReviewFace';
import { useIsSimulationPaused } from '@modeler/simulation/useIsSimulating';
import { ICONS } from '@modeler/icons';
import { toggleViews, useViews } from '@modeler/views/store';
import { DRAWER_HEIGHT } from '@modeler/views/styles';

/** A fix's button, by what it adds. */
const FIX_LABELS: Record<string, string> = { 'bpmn:EndEvent': 'Add end' };

/**
 * The checklist's rows, what the checks found: a press on one shows its element, and Fix mends it where its check
 * knows how (an end after a step that leads nowhere). `onPick` closes the card; `onFixed` follows a fix.
 */
function ProblemRows({ issues, onPick, onFixed }: { issues: Issue[]; onPick: () => void; onFixed?: () => void }) {
  const modeler = useModeler();
  return issues.map((issue, index) => (
    <div key={`${issue.elementId ?? ''}${index}`} className={s.problem} data-testid="problem">
      <button
        type="button"
        className={s.problemShow}
        title={issue.message}
        onClick={() => {
          onPick();
          if (issue.elementId) void executeCommand(modeler, { type: 'GoToElement', id: issue.elementId });
        }}
      >
        <i className={`${ICONS.warning} ${issue.severity === 'error' ? s.error : s.warning}`} aria-hidden="true" />
        <span className={s.problemText}>{issue.message}</span>
      </button>
      {issue.fix && (
        <button
          type="button"
          className={s.fix}
          onClick={() => {
            const { append, after } = issue.fix!;
            void executeCommand(modeler, { type: 'AppendElement', from: after, bpmnType: append });
            onFixed?.();
          }}
        >
          {FIX_LABELS[issue.fix.append] ?? 'Fix'}
        </button>
      )}
    </div>
  ));
}

/** Run: one press wherever it is pressed (`composer/run.ts`), which asks first when the plan has problems. */
function RunButton() {
  const modeler = useModeler();
  return (
    <button type="button" title="Open this study in the runner" className={s.run} onClick={() => pressRun(modeler)}>
      Run
      <i className={ICONS.openOut} aria-hidden="true" />
    </button>
  );
}

/**
 * Run's question, over the composer's right end, whichever face it shows: the checklist, then Cancel or Run anyway.
 * A fix reads the checks again, so a plan fixed in the card can run from it. It goes on a press outside it or on Esc,
 * which it takes, so the selection stays.
 */
function RunQuestion() {
  const modeler = useModeler();
  const issues = useRunQuestion();
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!issues) return undefined;
    const onDown = (e: PointerEvent) => { if (!card.current?.contains(e.target as Node)) dismissRunQuestion(); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      dismissRunQuestion();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [issues]);

  if (!issues) return null;
  const ready = issues.length === 0;
  return (
    <div ref={card} className={s.runCard} role="dialog" aria-label="Before you run" data-testid="run-problems">
      <div className={s.problemsHeader}>{ready ? 'Ready to run' : 'Before you run'}</div>
      <ProblemRows issues={issues} onPick={dismissRunQuestion} onFixed={() => recheckRunQuestion(modeler)} />
      <div className={s.problemsFooter}>
        <button type="button" className={s.cancel} onClick={dismissRunQuestion}>Cancel</button>
        <button type="button" className={s.runAnyway} onClick={() => { void startRun(modeler); }}>{ready ? 'Run' : 'Run anyway'}</button>
      </div>
    </div>
  );
}

/** Whether the plan is ready to run: a check when it is, else how many problems, which opens the checklist. */
function Readiness({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) {
    return (
      <span className={s.ready} title="Ready to run" data-testid="composer-ready">
        <i className={ICONS.check} aria-hidden="true" />
      </span>
    );
  }
  return (
    <Popover className="flex">
      <PopoverButton className={s.problems} title="Before you run" data-testid="composer-problems">
        <i className={ICONS.warning} aria-hidden="true" />
        {issues.length}
      </PopoverButton>
      <PopoverPanel anchor="top start" className={s.problemsCard}>
        {({ close }) => (
          <>
            <div className={s.problemsHeader}>Before you run</div>
            <ProblemRows issues={issues} onPick={close} />
          </>
        )}
      </PopoverPanel>
    </Popover>
  );
}

/** The selection as the commands' context: its id, or how many, and a way to let it go. */
function SelectionChip({ ids }: { ids: readonly string[] }) {
  const modeler = useModeler();
  const label = ids.length === 1 ? ids[0] : `${ids.length} selected`;
  return (
    <span className={s.chip}>
      <span className={s.chipLabel}>{label}</span>
      <button type="button" className={s.chipClear} title="Clear the selection" aria-label="Clear the selection" onClick={() => modeler.canvas.select([])}>
        <i className={ICONS.close} aria-hidden="true" />
      </button>
    </span>
  );
}

/** A simulation's transport: it plays or holds, steps on from a hold, and stops. Space and → do the same. */
function Playback() {
  const modeler = useModeler();
  const paused = useIsSimulationPaused(modeler);
  const togglePause = () => executeCommand(modeler, { type: 'PauseSimulation' });
  const step = () => executeCommand(modeler, { type: 'StepSimulation' });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')) return;
      if (e.key === ' ') {
        e.preventDefault();
        void executeCommand(modeler, { type: 'PauseSimulation' });
      } else if (e.key === 'ArrowRight' && modeler.simulation.isPaused()) {
        e.preventDefault();
        void executeCommand(modeler, { type: 'StepSimulation' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modeler]);

  return (
    <>
      <span className={s.label}>
        <i className={ICONS.simulate} aria-hidden="true" />
        {paused ? 'Paused' : 'Simulating'}
      </span>
      <span className="flex-1" />
      <button
        type="button"
        className={s.playPause}
        title={paused ? 'Play (space)' : 'Pause (space)'}
        aria-label={paused ? 'Resume simulation' : 'Pause simulation'}
        onClick={togglePause}
      >
        <i className={paused ? ICONS.play : ICONS.pause} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={s.transport}
        title={paused ? 'Step to where a token arrives next (→)' : 'Pause to step'}
        aria-label="Step simulation"
        disabled={!paused}
        onClick={step}
      >
        <i className={ICONS.chevronRight} aria-hidden="true" />
      </button>
      <button type="button" title="Stop simulation" className={s.stop} onClick={() => executeCommand(modeler, { type: 'ToggleSimulation' })}>
        <i className={ICONS.stop} aria-hidden="true" />
        Stop
      </button>
    </>
  );
}

/**
 * The composer: one bar at the bottom of the canvas that turns to what is needed (`composer/face.ts` decides which
 * face): a first step on a blank study, the commands and the way to simulate or run while designing, the selection as
 * their context, a simulation's transport while it plays, a replay's while it walks the run trail, and a version
 * written into the file elsewhere while it waits to be accepted or discarded. Between faces it keeps its place and
 * eases its width.
 */
export function Composer() {
  const modeler = useModeler();
  const { mode, exitReplay } = useContext(ModeContext);
  const { openDialog } = useDialogs();
  const { openPalette } = usePalette();
  const selection = useSelection(modeler);
  const blank = useIsBlank(modeler);
  const problems = useProblems(modeler);
  const face = faceOf({ mode, blank, selected: selection.length });
  const views = useViews();
  const toggleSimulation = () => executeCommand(modeler, { type: 'ToggleSimulation' });

  // Esc lets the selection go everywhere it shows: the canvas, the pad, the inspector and the chip. It closes the innermost
  // thing first, so not from inside a dialog or a menu (which hold the focus while open), nor a field being typed in, nor
  // when something else took the key (a name editor, a gesture, the tools' flyout, a popover).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || modeler.canvas.selection.length === 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]')) return;
      modeler.canvas.select([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modeler]);

  const prompt = (text: string) => (
    <button type="button" className={s.prompt} onClick={() => openPalette()} aria-label="Open command palette" data-testid="composer-prompt">
      <i className={ICONS.search} aria-hidden="true" />
      <span className={s.promptText}>{text}</span>
      <span className={s.kbd}>{OPEN_PALETTE_SHORTCUT_LABEL}</span>
    </button>
  );

  return (
    <div
      className={`${s.root} ${s.width[face]} ${s.tint[face]}`}
      // Over the views' drawer while it is open.
      style={views.open && !views.maximized && mode === 'edit' ? { bottom: `calc(${DRAWER_HEIGHT} + 1rem)` } : undefined}
      data-covers="bottom"
      data-testid="composer"
      data-face={face}
    >
      <div key={face} className={s.face}>
        {face === 'home' && (
          <>
            {prompt('Find a command...')}
            <button type="button" className={s.start} onClick={() => openDialog('open')}>
              <i className={ICONS.folderOpen} aria-hidden="true" />
              Open file
            </button>
            <button type="button" className={s.start} onClick={() => openDialog('gallery')}>
              <i className={ICONS.examples} aria-hidden="true" />
              Templates
            </button>
          </>
        )}

        {(face === 'design' || face === 'selection') && (
          <>
            <Readiness issues={problems} />
            {face === 'selection' && <SelectionChip ids={selection} />}
            {prompt('Find a command...')}
            <button type="button" title="Views" aria-label="Views" aria-pressed={!!views.open} className={s.views} onClick={toggleViews}>
              <i className={ICONS.views} aria-hidden="true" />
            </button>
            <button type="button" title="Simulate the study" aria-label="Simulate" className={s.play} onClick={toggleSimulation}>
              <i className={ICONS.play} aria-hidden="true" />
            </button>
            <RunButton />
          </>
        )}

        {face === 'playback' && <Playback />}

        {face === 'replay' && <ReplayFace onClose={exitReplay} />}

        {face === 'review' && <ReviewFace />}
      </div>
      <RunQuestion />
    </div>
  );
}
