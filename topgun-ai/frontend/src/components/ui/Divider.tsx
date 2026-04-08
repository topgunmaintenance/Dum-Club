export function Divider({ className = "" }: { className?: string }) {
  return <div className={`divider ${className}`} aria-hidden="true" />;
}
