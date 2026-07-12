export type Product = {
  id: string;
  title: string;
  description: string;
  price: number;
};

/**
 * A small hardware-store catalog. In a real app this would come from an API;
 * the cart store below doesn't care where products originate.
 */
export const catalog: Product[] = [
  {
    id: "kbd-mx",
    title: "Mechanical Keyboard",
    description: "Hot-swappable, tactile brown switches",
    price: 129,
  },
  {
    id: "mouse-erg",
    title: "Ergonomic Mouse",
    description: "Vertical grip, 6 programmable buttons",
    price: 59,
  },
  {
    id: "mon-27",
    title: '27" 4K Monitor',
    description: "IPS panel, USB-C power delivery",
    price: 349,
  },
  {
    id: "dock-tb",
    title: "Thunderbolt Dock",
    description: "Dual display, 90W passthrough charging",
    price: 219,
  },
  {
    id: "cam-hd",
    title: "1080p Webcam",
    description: "Auto light correction, dual mics",
    price: 79,
  },
  {
    id: "hp-anc",
    title: "Noise-cancelling Headphones",
    description: "40h battery, low-latency mode",
    price: 189,
  },
];

export type Coupon = {
  code: string;
  /** Fraction off the subtotal, e.g. 0.1 = 10%. */
  rate: number;
  label: string;
};

/** Coupons the checkout accepts, keyed by their (case-insensitive) code. */
export const coupons: Record<string, Coupon> = {
  welcome10: { code: "WELCOME10", rate: 0.1, label: "10% welcome discount" },
  save20: { code: "SAVE20", rate: 0.2, label: "20% off everything" },
};
