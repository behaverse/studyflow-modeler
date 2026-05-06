import { SimulateButton } from './actions/Simulate';
import { RunButton } from './actions/Run';
import { navDividerCls } from '../styles';

/**
 * Right-side actions of the navbar (Simulate + Run).
 *
 * Hidden on small viewports — those commands stay accessible through the
 * burger / command palette on the left of the diagram name.
 */
export default function CommandMenu() {
  return (
    <div className="hidden md:flex items-center flex-shrink-0">
      <div className={navDividerCls} />
      <div className="flex items-center">
        <SimulateButton />
        <RunButton />
      </div>
    </div>
  );
}
