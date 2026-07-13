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

// Wraps the user's bundle with the teardown flags, so they live per store
// instance rather than per Provider render.
type Instance<T extends object, Full extends object, A> = Bundle<T, Full, A> & {
  pendingDestroy: boolean;
  destroyed: boolean;
};

// `init` is only optional when the factory can actually cope with not
// receiving one — otherwise omitting it would silently hand the factory
// `undefined`.
type ProviderProps<P> = { children?: ReactNode } & (undefined extends P
  ? { init?: P }
  : { init: P });

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

  function Provider(props: ProviderProps<P>) {
    // The conditional in ProviderProps can't be resolved for an unbound P, so
    // destructure through the widened shape.
    const { init, children } = props as { init?: P; children?: ReactNode };
    // `init` is read on first render only, like a defaultValue: the store owns
    // its state from then on, and rebuilding it on a prop change would discard
    // whatever the user has done since.
    //
    // React StrictMode double-invokes this initializer in development, so the
    // factory can build a store that is immediately discarded — after its
    // plugins ran onInit and with no destroy to follow (see the StoicPlugin
    // docs). React offers no per-instance slot that escapes this.
    const [instance, setInstance] = useState<Instance<T, Full, A>>(() => ({
      ...factory(init as P),
      pendingDestroy: false,
      destroyed: false,
    }));

    useEffect(() => {
      // A remount cancels a destroy scheduled by the preceding cleanup. React's
      // StrictMode runs effects mount → unmount → mount, so an inline destroy
      // in the cleanup would kill a store the remounted tree still uses; the
      // microtask defers it long enough for this re-run to call it off.
      instance.pendingDestroy = false;

      // Reached when the subtree was hidden (e.g. inside <Activity>) long
      // enough for the deferred destroy to fire, and is now revealed: cleanup
      // ran, the store was destroyed (flushing plugins), and handing it back
      // out would freeze the subtree. Build a fresh instance instead — hide is
      // a real teardown, reveal a fresh start; `persist` rehydrates it.
      if (instance.destroyed) {
        setInstance({ ...factory(init as P), pendingDestroy: false, destroyed: false });
        return;
      }

      return () => {
        instance.pendingDestroy = true;
        queueMicrotask(() => {
          if (instance.pendingDestroy) {
            instance.destroyed = true;
            instance.store.destroy();
          }
        });
      };
    }, [instance, init]);

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
