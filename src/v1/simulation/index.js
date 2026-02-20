import TokenSimulation from './TokenSimulation';

export { TOGGLE_SIMULATION_EVENT } from './TokenSimulation';

export default {
  __init__: [
    'tokenSimulation',
  ],
  tokenSimulation: ['type', TokenSimulation],
};
