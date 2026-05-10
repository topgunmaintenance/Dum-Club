/**
 * components/ui — DUM Club design-system primitives barrel.
 *
 * Import from this file rather than the individual primitives so
 * consumers stay decoupled from internal file layout:
 *
 *   import { Button, Card, Heading, Eyebrow, Badge, Input,
 *            Container, Section } from "@/components/ui";
 *
 * Tokens (color, typography, spacing, radius, shadow, motion,
 * zIndex) live in @/lib/design/tokens — kept separate so
 * non-React contexts can pull them without dragging the React
 * primitives along.
 */

export { Button, type ButtonProps } from "./Button";
export { Card, type CardProps } from "./Card";
export { Heading, type HeadingProps } from "./Heading";
export { Eyebrow, type EyebrowProps } from "./Eyebrow";
export { Badge, type BadgeProps } from "./Badge";
export { Input, type InputProps } from "./Input";
export { Container, type ContainerProps } from "./Container";
export { Section, type SectionProps } from "./Section";
