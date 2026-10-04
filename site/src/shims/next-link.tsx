import { forwardRef, type AnchorHTMLAttributes } from "react";
import { Link as RouterLink } from "react-router";

// next/link on top of react-router. The studio's links are app paths
// ("/dashboard"); the router adds the /troupe/app base. Anything with a
// scheme stays a plain link.
type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | { pathname?: string; search?: string; hash?: string };
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean | null;
};

const Link = forwardRef<HTMLAnchorElement, Props>(function Link({ href, replace, scroll, prefetch, ...rest }, ref) {
  const to = typeof href === "string" ? href : `${href.pathname ?? ""}${href.search ?? ""}${href.hash ?? ""}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(to)) return <a ref={ref} href={to} {...rest} />;
  return <RouterLink ref={ref} to={to} replace={replace} preventScrollReset={scroll === false} {...rest} />;
});

export default Link;
