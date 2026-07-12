import type { Product } from "../data";
import { money } from "../format";
import { addItem } from "../store";

export function ProductCard({ product }: { product: Product }) {
  return (
    <article className="product">
      <div>
        <h3>{product.title}</h3>
        <p className="muted">{product.description}</p>
      </div>
      <div className="product-actions">
        <span className="price">{money(product.price)}</span>
        <button type="button" onClick={() => addItem(product)}>
          Add to cart
        </button>
      </div>
    </article>
  );
}
