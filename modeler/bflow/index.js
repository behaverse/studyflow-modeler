import BFlowContextPad from './ContextPad';
import BFlowPalette from './Palette';
import BFlowRenderer from './Renderer';

const BFlowModule = {
  __init__: ['bFlowContextPad', 'bFlowPalette', 'bFlowRenderer'],
  bFlowContextPad: ['type', BFlowContextPad],
  bFlowPalette: ['type', BFlowPalette],
  bFlowRenderer: ['type', BFlowRenderer]
};

export default BFlowModule;
