import type {} from "@redux-devtools/extension";
import type { ActionContext, StoicPlugin, StoicStore } from "../stoic";

export interface DevtoolsOptions {
  name?: string;
  enabled?: boolean;
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
  send: (action: { type: string }, state: unknown) => void;
  subscribe: (listener: (message: DevtoolsMessage) => void) => (() => void) | undefined;
  unsubscribe: () => void;
};

// Distinguishes stores that don't pass an explicit `name`: the extension
// falls back to `document.title` for every unnamed connection.
let anonymousStoreCount = 0;

export function devtools<T extends object, Full extends object = T>(
  options: DevtoolsOptions = {},
): StoicPlugin<T, Full> {
  const anonymousActionType = options.anonymousActionType ?? "anonymous";
  const name = options.name ?? `stoic-store-#${++anonymousStoreCount}`;

  const enabled = (() => {
    if (options.enabled !== undefined) return options.enabled;
    const nodeProcess = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
    return nodeProcess?.env?.NODE_ENV !== "production";
  })();

  let store: StoicStore<T, Full> | undefined;
  let connection: Connection | undefined;
  let initialState: Full | undefined;
  let isRecording = true;
  let pendingActionName: string | undefined;

  const setStateFromDevtools = (state: Full) => {
    if (!store) return;
    isRecording = false;
    store.setState(state);
    isRecording = true;
  };

  return {
    onInit(s) {
      store = s;
      initialState = s.getState();

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
    beforeAction(ctx: ActionContext<Full>) {
      pendingActionName = ctx.name;
    },
    afterAction() {
      pendingActionName = undefined;
    },
    afterSetState(state) {
      if (!isRecording || !connection) return;
      connection.send({ type: pendingActionName ?? anonymousActionType }, state);
    },
    onDestroy() {
      connection?.unsubscribe();
      connection = undefined;
    },
  };
}
