import { useStore } from "stoic-store/react";
import { shallow } from "stoic-store/tools";
import { cart } from "../store";
import { CartLineItem } from "./CartLineItem";
import { CartSummary } from "./CartSummary";
import { CouponInput } from "./CouponInput";
import { ShippingSelector } from "./ShippingSelector";

export function Cart() {
  const { items, totalItems } = useStore(
    cart,
    (s) => ({ items: s.items, totalItems: s.totalItems }),
    shallow,
  );

  return (
    <aside className="cart">
      <h2>
        Cart <span className="badge">{totalItems}</span>
      </h2>

      {items.length === 0 ? (
        <p className="muted">Your cart is empty. Add something from the catalog.</p>
      ) : (
        <>
          <ul className="line-items">
            {items.map((item) => (
              <CartLineItem key={item.id} item={item} />
            ))}
          </ul>
          <CouponInput />
          <ShippingSelector />
          <CartSummary />
        </>
      )}
    </aside>
  );
}
