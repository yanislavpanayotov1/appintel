'use client';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Revenue' },
  { href: '/categories', label: 'Categories' },
  { href: '/calibration', label: 'Calibration' },
  { href: '/methodology', label: 'Methodology' },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {LINKS.map((l) => {
        const active = l.href === '/' ? path === '/' || path.startsWith('/app/') : path.startsWith(l.href);
        return (
          <a key={l.href} href={l.href} aria-current={active ? 'page' : undefined}>
            {l.label}
          </a>
        );
      })}
    </nav>
  );
}
