import { useStore } from "stoic-store/react";
import { shallow } from "stoic-store/tools";
import { money } from "../format";
import { cart } from "../store";

export function CartSummary() {
  // One selector pulls the whole derived breakdown. `shallow` keeps the
  // component from rerendering unless one of these computed numbers changes.
  const { subtotal, discountAmount, discountedSubtotal, shippingCost, taxAmount, total } = useStore(
    cart,
    (s) => ({
      subtotal: s.subtotal,
      discountAmount: s.discountAmount,
      discountedSubtotal: s.discountedSubtotal,
      shippingCost: s.shippingCost,
      taxAmount: s.taxAmount,
      total: s.total,
    }),
    shallow,
  );

  return (
    <div className="summary">
      <Row label="Subtotal" value={money(subtotal)} />
      {discountAmount > 0 && (
        <Row label="Discount" value={`−${money(discountAmount)}`} accent="discount" />
      )}
      <Row label="Shipping" value={shippingCost === 0 ? "Free" : money(shippingCost)} />
      <Row label="Tax" value={money(taxAmount)} />
      <Row label="Total" value={money(total)} strong />
      <p className="muted summary-note">
        Every line above is derived state — the cart never stores these numbers. Taxable amount
        after discount: {money(discountedSubtotal)}.
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  accent,
}: {
  label: string;
  value: string;
  strong?: boolean;
  accent?: "discount";
}) {
  return (
    <div className={`summary-row${strong ? " summary-total" : ""}`}>
      <span>{label}</span>
      <span className={accent === "discount" ? "discount" : undefined}>{value}</span>
    </div>
  );
}
