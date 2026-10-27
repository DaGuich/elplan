import { Store } from "@tanstack/react-store";

export type AppState = {
  activeProjectId: number | null;
};

export const appStore = new Store<AppState>({
  activeProjectId: null,
});
