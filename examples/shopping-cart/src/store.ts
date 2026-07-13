import { createStore } from "stoic-store";
import { persist } from "stoic-store/plugins";
import type { Coupon, Product } from "./data";

export type CartItem = {
  id: string;
  title: string;
  price: number;
  quantity: number;
};

export type ShippingMethod = "pickup" | "standard" | "express";

type CartState = {
  items: CartItem[];
  coupon: Coupon | null;
  shippingMethod: ShippingMethod;
  /** Sales tax as a fraction, e.g. 0.0825 = 8.25%. */
  taxRate: number;
};

type CartDerived = {
  totalItems: number;
  subtotal: number;
  discountAmount: number;
  discountedSubtotal: number;
  shippingCost: number;
  taxAmount: number;
  total: number;
};

/** Orders above this (after discount) ship standard for free. */
const FREE_SHIPPING_THRESHOLD = 250;
const SHIPPING_RATES: Record<ShippingMethod, number> = {
  pickup: 0,
  standard: 9.99,
  express: 24.99,
};

export const cart = createStore<CartState, CartDerived>({
  state: {
    items: [],
    coupon: null,
    shippingMethod: "standard",
    taxRate: 0.0825,
  },

  // A derived value can read any other derived value regardless of where it
  // is declared — reads resolve recursively through the dependency graph.
  // Stoic tracks which fields each function touches and only recomputes the
  // values downstream of a change.
  derived: {
    totalItems: ({ items }) => items.reduce((n, item) => n + item.quantity, 0),

    subtotal: ({ items }) => items.reduce((sum, item) => sum + item.price * item.quantity, 0),

    // Depends on the derived `subtotal` above and on raw `coupon`.
    discountAmount: ({ subtotal, coupon }) => (coupon ? subtotal * coupon.rate : 0),

    discountedSubtotal: ({ subtotal, discountAmount }) => subtotal - discountAmount,

    // Free pickup is always $0; standard is free over the threshold; express is flat.
    shippingCost: ({ totalItems, discountedSubtotal, shippingMethod }) => {
      if (totalItems === 0) return 0;
      if (shippingMethod === "standard" && discountedSubtotal >= FREE_SHIPPING_THRESHOLD) {
        return 0;
      }
      return SHIPPING_RATES[shippingMethod];
    },

    // Tax is applied to the discounted goods total, not to shipping.
    taxAmount: ({ discountedSubtotal, taxRate }) => discountedSubtotal * taxRate,

    total: ({ discountedSubtotal, shippingCost, taxAmount }) =>
      discountedSubtotal + shippingCost + taxAmount,
  },

  plugins: [
    persist<CartState>({
      key: "stoic-cart",
      debounceMs: 200,
    }),
  ],
});

export const { addItem, removeItem, setQuantity, applyCoupon, removeCoupon, setShippingMethod } =
  cart.actions({
    addItem: ({ set }, product: Product) => {
      set((s) => {
        const existing = s.items.find((item) => item.id === product.id);
        if (existing) {
          return {
            items: s.items.map((item) =>
              item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
            ),
          };
        }
        return { items: [...s.items, { ...product, quantity: 1 }] };
      });
    },

    removeItem: ({ set }, id: string) => {
      set((s) => ({ items: s.items.filter((item) => item.id !== id) }));
    },

    setQuantity: ({ set }, id: string, quantity: number) => {
      set((s) => ({
        items:
          quantity <= 0
            ? s.items.filter((item) => item.id !== id)
            : s.items.map((item) => (item.id === id ? { ...item, quantity } : item)),
      }));
    },

    applyCoupon: ({ set }, coupon: Coupon) => set({ coupon }),

    removeCoupon: ({ set }) => set({ coupon: null }),

    setShippingMethod: ({ set }, shippingMethod: ShippingMethod) => set({ shippingMethod }),
  });
