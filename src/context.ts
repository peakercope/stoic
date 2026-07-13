import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import type { StoicStore } from "./stoic";

type Bundle<T extends object, Full extends object, A> = {
  store: StoicStore<T, Full>;
  actions: A;
};

// Wraps the user's bundle with the teardown flag, so the flag lives per store
// instance rather than per Provider render.
type Instance<T extends object, Full extends object, A> = Bundle<T, Full, A> & {
  pendingDestroy: boolean;
};

/**
 * Builds a React Context around a store factory, so each mounted `Provider`
 * owns an independent store instead of sharing a module-level singleton.
 *
 * Use it when a single JavaScript process serves several independent trees:
 * server rendering (one store per request — a module singleton would leak one
 * user's state into another's render), per-widget state, and test isolation.
 * For client-only apps, a module-level store remains simpler and is fine.
 *
 * The factory returns both the store and its actions, because action handles
 * close over the store they were created from; building them here binds them
 * to the instance once, keeping their identity — and their `useMeta` status —
 * stable across renders.
 */
export function createStoreContext<T extends object, Full extends object, A, P = void>(
  factory: (init: P) => Bundle<T, Full, A>,
) {
  const Ctx = createContext<Instance<T, Full, A> | null>(null);

  const useInstance = (hook: string): Instance<T, Full, A> => {
    const instance = useContext(Ctx);
    if (instance === null) {
      throw new Error(
        `stoic: ${hook} was called outside its Provider. Wrap the tree in the Provider ` +
          "returned by createStoreContext.",
      );
    }
    return instance;
  };

  function Provider({ init, children }: { init?: P; children?: ReactNode }) {
    // `init` is read on first render only, like a defaultValue: the store owns
    // its state from then on, and rebuilding it on a prop change would discard
    // whatever the user has done since.
    const [instance] = useState<Instance<T, Full, A>>(() => ({
      ...factory(init as P),
      pendingDestroy: false,
    }));

    useEffect(() => {
      // A remount cancels a destroy scheduled by the preceding cleanup. React's
      // StrictMode runs effects mount → unmount → mount, so an inline destroy
      // in the cleanup would kill a store the remounted tree still uses; the
      // microtask defers it long enough for this re-run to call it off.
      instance.pendingDestroy = false;

      return () => {
        instance.pendingDestroy = true;
        queueMicrotask(() => {
          if (instance.pendingDestroy) instance.store.destroy();
        });
      };
    }, [instance]);

    return createElement(Ctx.Provider, { value: instance }, children);
  }

  function useStore<U = Full>(
    selector?: (state: Full) => U,
    equality?: (a: U, b: U) => boolean,
  ): U {
    return useInstance("useStore").store.useStore(selector, equality);
  }

  const useActions = (): A => useInstance("useActions").actions;

  const useStoreApi = (): StoicStore<T, Full> => useInstance("useStoreApi").store;

  return { Provider, useStore, useActions, useStoreApi };
}
