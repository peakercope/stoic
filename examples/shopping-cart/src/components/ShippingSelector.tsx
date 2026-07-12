import { cart, type ShippingMethod, setShippingMethod } from "../store";

const OPTIONS: { value: ShippingMethod; label: string; hint: string }[] = [
  { value: "pickup", label: "In-store pickup", hint: "Free" },
  { value: "standard", label: "Standard", hint: "$9.99 · free over $250" },
  { value: "express", label: "Express", hint: "$24.99" },
];

export function ShippingSelector() {
  const shippingMethod = cart.useStore((s) => s.shippingMethod);

  return (
    <fieldset className="shipping">
      <legend>Shipping</legend>
      {OPTIONS.map((option) => (
        <label key={option.value} className="shipping-option">
          <input
            type="radio"
            name="shipping"
            value={option.value}
            checked={shippingMethod === option.value}
            onChange={() => setShippingMethod(option.value)}
          />
          <span className="shipping-label">{option.label}</span>
          <span className="muted">{option.hint}</span>
        </label>
      ))}
    </fieldset>
  );
}
