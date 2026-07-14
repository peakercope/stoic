import type { ComponentProps } from "react";
import { describe, expectTypeOf, it } from "vitest";
import { createStoreContext, useActionMeta, useStore } from "./react";
import { type ActionMeta, createStore, type StoicPlugin, type StoicStore } from "./stoic";

describe("action return types", () => {
  const store = createStore({ state: { count: 0, title: "" } });

  it("a sync action's handle returns what the action returns", () => {
    const { createTask } = store.actions({
      createTask: ({ set }, title: string) => {
        const id = Math.random();
        set({ title });
        return id;
      },
    });

    expectTypeOf(createTask).parameters.toEqualTypeOf<[title: string]>();
    expectTypeOf(createTask("write review")).toEqualTypeOf<number>();
  });

  it("an async action's handle returns the promise the action returns", () => {
    const { load } = store.actions({
      load: async ({ set }, id: number) => {
        set({ count: id });
        return `user-${id}`;
      },
    });

    expectTypeOf(load).parameters.toEqualTypeOf<[id: number]>();
    expectTypeOf(load(1)).toEqualTypeOf<Promise<string>>();
  });

  it("a void action's handle returns void", () => {
    const { inc } = store.actions({
      inc: ({ set }) => {
        set((s) => ({ count: s.count + 1 }));
      },
    });

    expectTypeOf(inc()).toEqualTypeOf<void>();
  });
});

describe("store state and derived inference", () => {
  type State = { count: number; label: string };
  type Derived = { doubled: number };

  const plain = createStore({ state: { count: 0, label: "" } });
  const derived = createStore<State, Derived>({
    state: { count: 0, label: "" },
    derived: { doubled: (s) => s.count * 2 },
  });

  it("getState returns the state, including derived values", () => {
    expectTypeOf(plain.getState()).toEqualTypeOf<{ count: number; label: string }>();
    expectTypeOf(derived.getState()).toEqualTypeOf<State & Derived>();
  });

  it("derived functions receive state and derived values, and must return their declared type", () => {
    createStore<State, Derived>({
      state: { count: 0, label: "" },
      derived: {
        doubled: (s) => {
          expectTypeOf(s).toEqualTypeOf<State & Derived>();
          return s.count * 2;
        },
      },
    });

    createStore<State, Derived>({
      state: { count: 0, label: "" },
      // @ts-expect-error a derived fn must return its declared type
      derived: { doubled: (s) => s.label },
    });
  });

  it("setState accepts a partial of the raw state, not derived keys", () => {
    derived.setState({ count: 1 });
    derived.setState((s) => {
      expectTypeOf(s).toEqualTypeOf<State & Derived>();
      return { label: "x" };
    });
    // @ts-expect-error derived keys are computed, not settable
    derived.setState({ doubled: 2 });
    // @ts-expect-error unknown keys are rejected
    derived.setState({ missing: 1 });
  });

  it("useStore infers the selector result and equality argument from the store", () => {
    useStore(derived, (s) => {
      expectTypeOf(s).toEqualTypeOf<State & Derived>();
      return s;
    });
    expectTypeOf(useStore(derived, (s) => s.doubled)).toEqualTypeOf<number>();
    expectTypeOf(useStore(plain)).toEqualTypeOf<{ count: number; label: string }>();
    useStore(
      derived,
      (s) => ({ count: s.count }),
      (a, b) => {
        expectTypeOf(a).toEqualTypeOf<{ count: number }>();
        return a.count === b.count;
      },
    );
  });

  it("actions see the full state through get and only raw keys through set", () => {
    derived.actions({
      probe: ({ set, get }) => {
        expectTypeOf(get()).toEqualTypeOf<State & Derived>();
        set({ count: get().doubled });
        // @ts-expect-error derived keys are computed, not settable
        set({ doubled: 1 });
      },
    });
  });

  it("actions receive a typed AbortSignal", () => {
    plain.actions({
      probeSignal: ({ signal }) => {
        expectTypeOf(signal).toEqualTypeOf<AbortSignal>();
      },
    });
  });

  it("action meta is typed", () => {
    const { inc } = plain.actions({ inc: ({ set }) => set((s) => ({ count: s.count + 1 })) });
    expectTypeOf(inc.getMeta()).toEqualTypeOf<ActionMeta>();
    expectTypeOf(useActionMeta(inc)).toEqualTypeOf<ActionMeta>();
  });

  it("a plugin's afterSetState receives the full state and the acting action", () => {
    const plugin: StoicPlugin<State, State & Derived> = {
      afterSetState(state, actionName, actionArgs) {
        expectTypeOf(state).toEqualTypeOf<State & Derived>();
        expectTypeOf(actionName).toEqualTypeOf<string | undefined>();
        expectTypeOf(actionArgs).toEqualTypeOf<readonly unknown[] | undefined>();
      },
    };
    void plugin;
  });

  it("a store with derived state is assignable to StoicStore<T, Full>", () => {
    expectTypeOf(derived).toExtend<StoicStore<State, State & Derived>>();
  });
});

describe("Provider init prop", () => {
  const bundle = () => {
    const store = createStore({ state: { items: [] as string[] } });
    return { store, actions: {} };
  };

  it("is required when the factory requires its init argument", () => {
    const { Provider } = createStoreContext((init: string[]) => {
      void init;
      return bundle();
    });
    void Provider;
    type Props = ComponentProps<typeof Provider>;

    expectTypeOf<Props>().toHaveProperty("init").toEqualTypeOf<string[]>();
    // Omitting `init` must not satisfy the props.
    expectTypeOf<Record<never, never>>().not.toExtend<Props>();
  });

  it("is optional when the factory's init argument is optional", () => {
    const { Provider } = createStoreContext((init: string[] = []) => {
      void init;
      return bundle();
    });
    void Provider;
    type Props = ComponentProps<typeof Provider>;

    expectTypeOf<Record<never, never>>().toExtend<Props>();
  });

  it("is optional when the factory takes no init argument", () => {
    const { Provider } = createStoreContext(() => bundle());
    void Provider;
    type Props = ComponentProps<typeof Provider>;

    expectTypeOf<Record<never, never>>().toExtend<Props>();
  });
});
