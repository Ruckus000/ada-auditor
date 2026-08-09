import { PortfolioRoute } from '../platform/components/screen-routes';

/**
 * The portfolio, and the product's front door.
 *
 * A Server Component with nothing to load yet: the screens still read
 * fixtures. This is the boundary the query lands at in the next slice, which
 * is why it exists now rather than being added later.
 */
export default function PortfolioPage() {
  return <PortfolioRoute />;
}
