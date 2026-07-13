import type {} from "@redux-devtools/extension";
import { isDevEnv } from "../env";
import type { StoicPlugin, StoicStore } from "../stoic";

export interface DevtoolsOptions {
  /** Instance name in the DevTools dropdown; defaults to an auto-generated per-store name. */
  name?: string;
  /**
   * Whether to connect at all; defaults to `true` outside production builds
   * (decided by `process.env.NODE_ENV`, which bundlers replace statically).
   */
  enabled?: boolean;
  /** Label for `setState` calls made outside an action; defaults to `"anonymous"`. */
  anonymousActionType?: string;
}

type DevtoolsMessage = {
  type: string;
  state?: string;
  payload?: {
    type: string;
    nextLiftedState?: { computedStates?: { state?: unknown }[] };
  };
};

// The published @redux-devtools/extension types omit `subscribe`/`unsubscribe`
// from the connect() return value even though the extension provides them at
// runtime (https://github.com/reduxjs/redux-devtools/issues/1097).
type Connection = {
  init: (state: unknown) => void;
  send: (action: { type: string; args?: readonly unknown[] }, state: unknown) => void;
  subscribe: (listener: (message: DevtoolsMessage) => void) => (() => void) | undefined;
  unsubscribe: () => void;
};

// Distinguishes stores that don't pass an explicit `name`: the extension
// falls back to `document.title` for every unnamed connection.
let anonymousStoreCount = 0;

/**
 * Connects a store to the Redux DevTools browser extension: every action
 * shows up with its name and arguments, and time-travel is applied back to
 * the store. A no-op when the extension isn't installed.
 */
export function devtools<T extends object, Full extends object = T>(
  options: DevtoolsOptions = {},
): StoicPlugin<T, Full> {
  const anonymousActionType = options.anonymousActionType ?? "anonymous";
  const name = options.name ?? `stoic-store-#${++anonymousStoreCount}`;

  const enabled = options.enabled ?? isDevEnv();

  let store: StoicStore<T, Full> | undefined;
  let connection: Connection | undefined;
  let initialState: Full | undefined;
  let isRecording = true;
  let derivedKeys: readonly string[] = [];

  const setStateFromDevtools = (state: Full) => {
    if (!store) return;
    // Serialized devtools payloads include derived values; they are computed
    // from raw state, so strip them before writing back.
    const next = { ...state } as Record<string, unknown>;
    for (const key of derivedKeys) delete next[key];
    const wasRecording = isRecording;
    isRecording = false;
    store.setState(next as Partial<T>);
    // Restore rather than force `true`: a jump while recording is paused
    // must not silently re-enable recording.
    isRecording = wasRecording;
  };

  return {
    onInit(s) {
      store = s;
      initialState = s.getState();
      // Derived values are getter properties on snapshots (core invariant);
      // raw keys are plain data properties.
      derivedKeys = Object.keys(initialState).filter(
        (key) => Object.getOwnPropertyDescriptor(initialState, key)?.get !== undefined,
      );

      if (!enabled) return;
      const extension =
        typeof window !== "undefined" ? window.__REDUX_DEVTOOLS_EXTENSION__ : undefined;
      if (!extension) return;

      const conn = extension.connect({ name }) as unknown as Connection;
      connection = conn;
      conn.init(initialState);

      conn.subscribe((message) => {
        if (message.type !== "DISPATCH" || !store) return;

        switch (message.payload?.type) {
          case "JUMP_TO_STATE":
          case "JUMP_TO_ACTION": {
            if (!message.state) return;
            setStateFromDevtools(JSON.parse(message.state) as Full);
            return;
          }
          case "RESET": {
            setStateFromDevtools(initialState as Full);
            connection?.init(initialState);
            return;
          }
          case "COMMIT": {
            connection?.init(store.getState());
            return;
          }
          case "ROLLBACK": {
            if (!message.state) return;
            setStateFromDevtools(JSON.parse(message.state) as Full);
            connection?.init(store.getState());
            return;
          }
          case "IMPORT_STATE": {
            const computedStates = message.payload.nextLiftedState?.computedStates;
            const lastComputedState = computedStates?.slice(-1)[0]?.state;
            if (!lastComputedState) return;
            setStateFromDevtools(lastComputedState as Full);
            connection?.init(store.getState());
            return;
          }
          case "PAUSE_RECORDING": {
            isRecording = !isRecording;
            return;
          }
          default:
            return;
        }
      });
    },
    afterSetState(state, actionName, actionArgs) {
      if (!isRecording || !connection) return;
      const type = actionName ?? anonymousActionType;
      // Args are sent by reference (like Redux): the extension serializes them
      // on receipt. `args` is absent — not empty — for a direct `store.setState`,
      // which has no action and therefore no arguments.
      connection.send(actionArgs ? { type, args: [...actionArgs] } : { type }, state);
    },
    onDestroy() {
      connection?.unsubscribe();
      connection = undefined;
    },
  };
}
