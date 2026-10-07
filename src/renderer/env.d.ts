import type { FvodApi } from '../shared/api';

declare global {
  interface Window {
    fvod: FvodApi;
  }
}

export {};
