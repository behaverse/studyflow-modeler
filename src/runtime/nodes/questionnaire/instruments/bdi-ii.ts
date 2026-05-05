import type { InstrumentDefinition } from './index';

// BDI-II uses unique answer options per item. Each item is a category
// (sadness, pessimism, etc.) with four ordered statements scored 0-3.
// We ship a compact subset (selected items) — researchers using the full
// BDI-II should plug in the complete bank via a custom instrument id.

export const bdi2: InstrumentDefinition = {
  id: 'bdi-ii',
  title: 'Beck Depression Inventory-II (BDI-II) — short form',
  preamble:
    'For each item, pick the statement that best describes how you have been feeling over the past two weeks, including today.',
  items: [
    {
      id: 'bdi2_sadness',
      prompt: 'Sadness',
      scale: [
        { value: 0, label: 'I do not feel sad.' },
        { value: 1, label: 'I feel sad much of the time.' },
        { value: 2, label: 'I am sad all the time.' },
        { value: 3, label: 'I am so sad or unhappy that I can’t stand it.' },
      ],
    },
    {
      id: 'bdi2_pessimism',
      prompt: 'Pessimism',
      scale: [
        { value: 0, label: 'I am not discouraged about my future.' },
        { value: 1, label: 'I feel more discouraged about my future than I used to.' },
        { value: 2, label: 'I do not expect things to work out for me.' },
        { value: 3, label: 'I feel my future is hopeless and will only get worse.' },
      ],
    },
    {
      id: 'bdi2_failure',
      prompt: 'Past failure',
      scale: [
        { value: 0, label: 'I do not feel like a failure.' },
        { value: 1, label: 'I have failed more than I should have.' },
        { value: 2, label: 'As I look back, I see a lot of failures.' },
        { value: 3, label: 'I feel I am a total failure as a person.' },
      ],
    },
    {
      id: 'bdi2_loss_pleasure',
      prompt: 'Loss of pleasure',
      scale: [
        { value: 0, label: 'I get as much pleasure as I ever did from things I enjoy.' },
        { value: 1, label: 'I don’t enjoy things as much as I used to.' },
        { value: 2, label: 'I get very little pleasure from the things I used to enjoy.' },
        { value: 3, label: 'I can’t get any pleasure from the things I used to enjoy.' },
      ],
    },
  ],
};
