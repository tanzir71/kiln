import type { KilnAPI } from '../../ui/src/types';

declare global {
  interface Window {
    kiln?: KilnAPI;
  }
}

export {};
