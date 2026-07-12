import { catalog } from "../data";
import { ProductCard } from "./ProductCard";

export function ProductList() {
  return (
    <section>
      <h2>Catalog</h2>
      <div className="product-grid">
        {catalog.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}
