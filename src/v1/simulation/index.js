import TokenSimulator from './TokenSimulator';

export { TOGGLE_SIMULATION_EVENT } from './TokenSimulator';

export default {
  __init__: [
    'tokenSimulator',
  ],
  tokenSimulator: ['type', TokenSimulator],
};
