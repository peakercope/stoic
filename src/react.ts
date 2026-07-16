import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ActionMeta, StoicStore } from "./stoic";

const UNSET = Symbol("stoic.unset");

/** The part of a store `useStore` reads; any `StoicStore` satisfies it. */
type ReadableStore<Full> = {
  getState: () => Full;
  subscribe: (listener: (state: Full) => void) => () => void;
};

/**
 * React hook: subscribes the component to `store`. Without a selector it
 * returns the full state (re-rendering on every change); with a `selector`
 * only changes to the selected value re-render, compared by `equality`
 * (default `Object.is` — pass `shallow` from `stoic-store/tools` for
 * object-literal selectors).
 */
export function useStore<Full extends object, U = Full>(
  store: ReadableStore<Full>,
  selector: (state: Full) => U = (s) => s as unknown as U,
  equality: (a: U, b: U) => boolean = Object.is,
): U {
  // Sentinel-gated so the selector doesn't run on every render just to
  // produce a discarded useRef initializer.
  const selectedRef = useRef<U | typeof UNSET>(UNSET);
  if (selectedRef.current === UNSET) selectedRef.current = selector(store.getState());

  // React calls the snapshot functions repeatedly and compares the results with
  // `Object.is`, so an object-literal selector must return the *same* reference
  // until the selection actually changes. This applies to the server snapshot
  // too: returning a fresh object there makes React bail out with "The result of
  // getServerSnapshot should be cached to avoid an infinite loop" on hydration.
  const read = () => {
    const next = selector(store.getState());

    if (!equality(selectedRef.current as U, next)) {
      selectedRef.current = next;
    }

    return selectedRef.current as U;
  };

  return useSyncExternalStore(store.subscribe, read, read);
}

/**
 * React hook: subscribes the component to an action handle's {@link ActionMeta}
 * status — `useActionMeta(loadUser).status` is `"pending"` while the newest
 * call is in flight.
 */
export function useActionMeta(action: {
  getMeta: () => ActionMeta;
  subscribeMeta: (listener: (meta: ActionMeta) => void) => () => void;
}): ActionMeta {
  return useSyncExternalStore(action.subscribeMeta, action.getMeta, action.getMeta);
}

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
 * to the instance once, keeping their identity — and their `useActionMeta`
 * status — stable across renders.
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

    // Pinned to the first render's value (like the store itself), so an
    // unstable inline `init` prop doesn't re-run the teardown effect on every
    // render just to build the same store on a post-hide reveal.
    const initRef = useRef(init);

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
        setInstance({ ...factory(initRef.current as P), pendingDestroy: false, destroyed: false });
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
    }, [instance]);

    return createElement(Ctx.Provider, { value: instance }, children);
  }

  function useContextStore<U = Full>(
    selector?: (state: Full) => U,
    equality?: (a: U, b: U) => boolean,
  ): U {
    return useStore(useInstance("useStore").store, selector, equality);
  }

  const useActions = (): A => useInstance("useActions").actions;

  const useStoreApi = (): StoicStore<T, Full> => useInstance("useStoreApi").store;

  return { Provider, useStore: useContextStore, useActions, useStoreApi };
}
