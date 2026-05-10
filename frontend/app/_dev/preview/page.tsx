/**
 * /_dev/preview — internal preview surface for the design system.
 *
 * Renders every primitive in components/ui/* so a designer or dev
 * can eyeball the full token set without spinning through real
 * routes. The page hard-404s in production via notFound() so it
 * never ships to dum.club, even if Vercel inadvertently builds it.
 *
 * To extend: add a new <Card padding="lg"> block per primitive
 * variant. Don't add live data — this surface is intentionally
 * static so visual regressions are easy to spot in screenshots.
 */

import { notFound } from "next/navigation";
import { ArrowRight, Search, Lock } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  Container,
  Eyebrow,
  Heading,
  Input,
  Section,
} from "../../../components/ui";

export const metadata = {
  title: "Design System Preview | DUM Club (dev)",
  robots: { index: false, follow: false },
};

export default function DevPreviewPage() {
  // Hard-fail in production — this page is dev-only chrome and
  // should never be discoverable on dum.club. NODE_ENV is reliably
  // inlined by Next.js's DefinePlugin so this branch is dead-code-
  // eliminated from the production bundle.
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main className="bg-surface-page text-primary">
      <Section spacing="tight" bg="page">
        <Container size="lg">
          <Eyebrow tone="brand">Design System · v1</Eyebrow>
          <Heading level="display" className="mt-3">
            Primitives preview
          </Heading>
          <p className="mt-4 max-w-2xl text-base text-secondary">
            Internal surface. Renders every variant of every
            component in <code>components/ui/*</code>. 404s in
            production.
          </p>
        </Container>
      </Section>

      {/* ── Buttons ─────────────────────────────────────────── */}
      <Section spacing="tight" bg="page">
        <Container size="lg">
          <Eyebrow tone="muted">Button</Eyebrow>
          <Heading level="h2" className="mt-2 mb-6">
            Variants × sizes
          </Heading>

          <Card padding="lg" className="space-y-6">
            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
                Primary
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm">Small</Button>
                <Button size="md">Medium (44px)</Button>
                <Button size="lg">
                  Large
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button loading>Loading</Button>
                <Button disabled>Disabled</Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
                Secondary
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" size="sm">
                  Small
                </Button>
                <Button variant="secondary">Medium</Button>
                <Button variant="secondary" size="lg">
                  Large
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-secondary">
                Ghost · Danger · Link · As-anchor
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="ghost">Ghost</Button>
                <Button variant="danger">Delete</Button>
                <Button variant="link">Read more</Button>
                <Button href="/discover" variant="primary">
                  Anchor button
                </Button>
              </div>
            </div>
          </Card>
        </Container>
      </Section>

      {/* ── Cards ───────────────────────────────────────────── */}
      <Section spacing="tight" bg="page">
        <Container size="lg">
          <Eyebrow tone="muted">Card</Eyebrow>
          <Heading level="h2" className="mt-2 mb-6">
            Variants × interactive
          </Heading>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card variant="surface">
              <div className="text-sm font-semibold">surface</div>
              <p className="mt-1 text-[12px] text-secondary">
                Default white card with default border + shadow-sm.
              </p>
            </Card>
            <Card variant="elevated">
              <div className="text-sm font-semibold">elevated</div>
              <p className="mt-1 text-[12px] text-secondary">
                Surface + shadow-md, for raised panels.
              </p>
            </Card>
            <Card variant="inset">
              <div className="text-sm font-semibold">inset</div>
              <p className="mt-1 text-[12px] text-secondary">
                surface-muted bg, for nested panels.
              </p>
            </Card>
            <Card variant="accent">
              <div className="text-sm font-semibold">accent</div>
              <p className="mt-1 text-[12px] text-secondary">
                brand-teal-soft bg, for highlights.
              </p>
            </Card>

            <Card interactive>
              <div className="text-sm font-semibold">interactive</div>
              <p className="mt-1 text-[12px] text-secondary">
                Hover lifts and adds shadow-md.
              </p>
            </Card>
            <Card href="/discover">
              <div className="text-sm font-semibold">anchor card</div>
              <p className="mt-1 text-[12px] text-secondary">
                Whole card is a link target.
              </p>
            </Card>
          </div>
        </Container>
      </Section>

      {/* ── Heading + Eyebrow ───────────────────────────────── */}
      <Section spacing="tight" bg="page">
        <Container size="lg">
          <Eyebrow tone="muted">Heading + Eyebrow</Eyebrow>
          <Card padding="lg" className="mt-2 space-y-6">
            <div>
              <Eyebrow tone="brand">brand</Eyebrow>
              <Heading level="display" className="mt-2">
                Display headline
              </Heading>
            </div>
            <div>
              <Eyebrow tone="navy">navy</Eyebrow>
              <Heading level="h1" className="mt-2">
                H1 heading
              </Heading>
            </div>
            <div>
              <Eyebrow tone="muted">muted</Eyebrow>
              <Heading level="h2" className="mt-2">
                H2 heading
              </Heading>
            </div>
            <div>
              <Eyebrow tone="live">live</Eyebrow>
              <Heading level="h3" className="mt-2">
                H3 heading
              </Heading>
            </div>
          </Card>
        </Container>
      </Section>

      {/* ── Badges ──────────────────────────────────────────── */}
      <Section spacing="tight" bg="page">
        <Container size="lg">
          <Eyebrow tone="muted">Badge</Eyebrow>
          <Card padding="lg" className="mt-2 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="verified">verified</Badge>
              <Badge variant="verified" dot>
                verified · dot
              </Badge>
              <Badge variant="live" dot>
                live · dot
              </Badge>
              <Badge variant="muted">muted</Badge>
              <Badge variant="accent">accent</Badge>
              <Badge variant="navy">navy</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="verified" size="sm">
                sm
              </Badge>
              <Badge variant="verified" size="md">
                md
              </Badge>
            </div>
          </Card>
        </Container>
      </Section>

      {/* ── Inputs ──────────────────────────────────────────── */}
      <Section spacing="tight" bg="page">
        <Container size="lg">
          <Eyebrow tone="muted">Input</Eyebrow>
          <Card padding="lg" className="mt-2 max-w-md space-y-4">
            <Input label="Email" type="email" placeholder="you@business.com" />
            <Input
              label="Search"
              placeholder="Try 'pizza near me'"
              prefix={<Search className="h-4 w-4" />}
            />
            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              suffix={<Lock className="h-4 w-4" />}
              helper="At least 8 characters."
            />
            <Input
              label="Email"
              type="email"
              defaultValue="not-an-email"
              error="Enter a valid email address."
            />
            <Input label="Disabled field" defaultValue="Locked" disabled />
          </Card>
        </Container>
      </Section>

      {/* ── Section variants ────────────────────────────────── */}
      <Section spacing="tight" bg="muted">
        <Container size="lg">
          <Eyebrow tone="muted">Section bg=&quot;muted&quot;</Eyebrow>
          <p className="mt-2 text-secondary">
            Subtle interruption strip between page sections.
          </p>
        </Container>
      </Section>
      <Section spacing="tight" bg="gradient">
        <Container size="lg">
          <Eyebrow tone="brand">Section bg=&quot;gradient&quot;</Eyebrow>
          <p className="mt-2 text-secondary">
            CSS-only soft mesh of brand-teal + brand-navy radial
            gradients. Cards on top stay readable.
          </p>
        </Container>
      </Section>
      <Section spacing="tight" bg="inverse">
        <Container size="lg">
          <Eyebrow tone="brand">Section bg=&quot;inverse&quot;</Eyebrow>
          <p className="mt-2 text-white/80">
            Dark inverse-contrast surface for product preview blocks.
          </p>
        </Container>
      </Section>
    </main>
  );
}
