// Replace assets or this mapping centrally when adopting a future approved brand pack.
export const brandAssets = {
  full: "/brand/aiveron-logo.svg",
  symbol: "/brand/aiveron-symbol.svg",
} as const;

export function BrandLogo({ variant = "full" }: { variant?: keyof typeof brandAssets }) {
  return <img className={`brand-logo ${variant}`} src={brandAssets[variant]} alt="AiVeron" width={variant === "full" ? 576 : 376} height={variant === "full" ? 212 : 376} />;
}
